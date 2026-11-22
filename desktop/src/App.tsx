import {
  Activity,
  Cpu,
  Crosshair,
  Eye,
  Gauge,
  PanelRightClose,
  PanelRightOpen,
  Timer,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import EyeCanvas, {
  drawEyeFrame,
  type CalibrationOverlayState,
} from "./components/EyeCanvas";
import EyeControlPanel, {
  type EyeTelemetryMetrics,
} from "./components/EyeControlPanel";
import {
  CALIBRATION_TARGETS,
  DEFAULT_GAZE_SETTINGS,
  GazeTrackerState,
  computeEyeGaze,
  fitGazeCalibration,
} from "./engine/gazeEngine";
import { PoseSmoother } from "./engine/geometry";
import { NativeStreamClient } from "./engine/streamClient";
import type {
  AffineGazeCalibration,
  AppStatus,
  DecodedFramePacket,
  DelegateType,
  GazeCalibrationSample,
  GazeEstimate,
  GazeSettings,
  GazeTrailPoint,
  Point3D,
  SmoothingConfig,
  ViewMode,
} from "./engine/types";

const DEFAULT_SMOOTHING: SmoothingConfig = {
  enabled: true,
  strength: 0.55,
};

const CALIBRATION_FRAMES_PER_TARGET = 10;

async function resolveBackendWsUrl(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get("wsUrl")?.trim();
    if (paramUrl) {
      return paramUrl;
    }
    if (window.electronAPI?.getBackendConfig) {
      try {
        const cfg = await window.electronAPI.getBackendConfig();
        if (cfg?.wsUrl) {
          return cfg.wsUrl;
        }
      } catch {
        /* fallback below */
      }
    }
  }
  return null;
}

export default function App(): ReactElement {
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clientRef = useRef<NativeStreamClient | null>(null);
  const faceSmootherRef = useRef<PoseSmoother>(new PoseSmoother());
  const gazeTrackerRef = useRef<GazeTrackerState>(new GazeTrackerState());

  const [status, setStatus] = useState<AppStatus>("loading-model");
  const [statusMessage, setStatusMessage] = useState<string | undefined>(
    undefined,
  );
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<ViewMode>("overlay");
  const [mirrored, setMirrored] = useState<boolean>(true);
  const [smoothing, setSmoothing] =
    useState<SmoothingConfig>(DEFAULT_SMOOTHING);
  const [gazeSettings, setGazeSettings] = useState<GazeSettings>(
    DEFAULT_GAZE_SETTINGS,
  );
  const [videoAspectRatio, setVideoAspectRatio] = useState<number>(16 / 9);

  const [faceLandmarks, setFaceLandmarks] = useState<readonly Point3D[] | null>(
    null,
  );
  const [gaze, setGaze] = useState<GazeEstimate | null>(null);
  const [gazeTrail, setGazeTrail] = useState<readonly GazeTrailPoint[]>([]);
  const [gazeHeatmap, setGazeHeatmap] = useState<readonly number[]>([]);
  const [blinkCount, setBlinkCount] = useState<number>(0);
  const [fixationSec, setFixationSec] = useState<number>(0);
  const [calibration, setCalibration] = useState<AffineGazeCalibration | null>(
    null,
  );
  const [calibrationStep, setCalibrationStep] = useState<number | null>(null);
  const [calibrationCapturing, setCalibrationCapturing] =
    useState<boolean>(false);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);

  const [telemetry, setTelemetry] = useState<EyeTelemetryMetrics>({
    fps: 0,
    inferenceMs: 0,
    delegate: "GPU",
    irisLocked: false,
  });

  // Live refs for zero-lag canvas rendering & WS packet handling
  const statusRef = useRef<AppStatus>(status);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const mirroredRef = useRef<boolean>(mirrored);
  const smoothingRef = useRef<SmoothingConfig>(smoothing);
  const gazeSettingsRef = useRef<GazeSettings>(gazeSettings);
  const calibrationRef = useRef<AffineGazeCalibration | null>(calibration);

  const latestBitmapRef = useRef<ImageBitmap | null>(null);
  const decodingFrameRef = useRef<boolean>(false);
  const latestFaceLandmarksRef = useRef<readonly Point3D[] | null>(null);
  const latestGazeRef = useRef<GazeEstimate | null>(null);
  const latestInferenceMsRef = useRef<number>(0);
  const latestDelegateRef = useRef<DelegateType>("GPU");
  const smoothedFpsRef = useRef<number>(30);
  const lastPacketMsRef = useRef<number | null>(null);
  const lastHudCommitMsRef = useRef<number>(0);

  const calibrationCaptureRef = useRef<{
    stepIndex: number | null;
    capturing: boolean;
    targetBuffer: Array<{ rawGazeX: number; rawGazeY: number }>;
    collectedSamples: GazeCalibrationSample[];
  }>({
    stepIndex: null,
    capturing: false,
    targetBuffer: [],
    collectedSamples: [],
  });

  useEffect(() => {
    statusRef.current = status;
    viewModeRef.current = viewMode;
    mirroredRef.current = mirrored;
    smoothingRef.current = smoothing;
    gazeSettingsRef.current = gazeSettings;
    calibrationRef.current = calibration;
  }, [status, viewMode, mirrored, smoothing, gazeSettings, calibration]);

  const drawCurrentFrameToCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : canvas.clientWidth;
    const cssHeight = rect.height > 0 ? rect.height : canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const dpr =
      Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    const backingW = Math.max(1, Math.round(cssWidth * dpr));
    const backingH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEyeFrame(ctx, cssWidth, cssHeight, {
      faceLandmarks: latestFaceLandmarksRef.current,
      gaze: latestGazeRef.current,
      gazeSettings: gazeSettingsRef.current,
      gazeTrail: gazeTrackerRef.current.getTrail(),
      gazeHeatmap: gazeTrackerRef.current.getHeatmap(),
      heatmapCols: 12,
      heatmapRows: 9,
      viewMode: viewModeRef.current,
      mirrored: mirroredRef.current,
    });
  }, []);

  const handlePacket = useCallback(
    (packet: DecodedFramePacket): void => {
      const nowMs = performance.now();
      if (lastPacketMsRef.current !== null) {
        const dt = nowMs - lastPacketMsRef.current;
        if (dt > 1 && dt < 1000) {
          const instFps = 1000 / dt;
          smoothedFpsRef.current =
            smoothedFpsRef.current * 0.85 + instFps * 0.15;
        }
      }
      lastPacketMsRef.current = nowMs;

      if (packet.header.width > 0 && packet.header.height > 0) {
        const nextAspect = packet.header.width / packet.header.height;
        setVideoAspectRatio((prev) =>
          Math.abs(prev - nextAspect) > 0.01 ? nextAspect : prev,
        );
      }

      latestInferenceMsRef.current = packet.header.inferenceMs;
      latestDelegateRef.current = packet.header.delegate;

      if (statusRef.current !== "ready") {
        statusRef.current = "ready";
        setStatus("ready");
        setStatusMessage(undefined);
      }

      // Decode JPEG frame asynchronously without building decode backlog
      if (
        packet.jpegBytes.byteLength > 0 &&
        !decodingFrameRef.current &&
        typeof createImageBitmap === "function"
      ) {
        decodingFrameRef.current = true;
        const copy = new Uint8Array(packet.jpegBytes.byteLength);
        copy.set(packet.jpegBytes);
        const blob = new Blob([copy], { type: "image/jpeg" });
        void createImageBitmap(blob)
          .then((bitmap) => {
            const prev = latestBitmapRef.current;
            latestBitmapRef.current = bitmap;
            prev?.close();
            const vCanvas = videoCanvasRef.current;
            if (vCanvas) {
              if (
                vCanvas.width !== bitmap.width ||
                vCanvas.height !== bitmap.height
              ) {
                vCanvas.width = bitmap.width;
                vCanvas.height = bitmap.height;
              }
              const vCtx = vCanvas.getContext("2d");
              vCtx?.drawImage(bitmap, 0, 0);
            }
            decodingFrameRef.current = false;
            drawCurrentFrameToCanvas();
          })
          .catch(() => {
            decodingFrameRef.current = false;
          });
      }

      const smoothedFace = packet.faceLandmarks
        ? faceSmootherRef.current.filter(
            packet.faceLandmarks,
            nowMs,
            smoothingRef.current,
          )
        : null;
      latestFaceLandmarksRef.current = smoothedFace;

      if (smoothedFace && smoothedFace.length >= 478) {
        const rawGaze = computeEyeGaze({
          faceLandmarks: smoothedFace,
          blendshapes: packet.faceBlendshapes,
          mirrored: mirroredRef.current,
          settings: gazeSettingsRef.current,
          calibration: calibrationRef.current,
        });
        if (rawGaze) {
          latestGazeRef.current = gazeTrackerRef.current.step(
            rawGaze,
            nowMs,
            smoothingRef.current,
          );

          // 5-Point Calibration frame capture
          const calState = calibrationCaptureRef.current;
          if (
            calState.stepIndex !== null &&
            calState.capturing &&
            !rawGaze.isBlinking
          ) {
            const target = CALIBRATION_TARGETS[calState.stepIndex];
            if (target) {
              calState.targetBuffer.push({
                rawGazeX: rawGaze.rawGazeX,
                rawGazeY: rawGaze.rawGazeY,
              });
              const count = calState.targetBuffer.length;
              setCalibrationProgress(count / CALIBRATION_FRAMES_PER_TARGET);

              if (count >= CALIBRATION_FRAMES_PER_TARGET) {
                const avgX =
                  calState.targetBuffer.reduce(
                    (acc, s) => acc + s.rawGazeX,
                    0,
                  ) / count;
                const avgY =
                  calState.targetBuffer.reduce(
                    (acc, s) => acc + s.rawGazeY,
                    0,
                  ) / count;
                calState.collectedSamples.push({
                  targetX: target.x,
                  targetY: target.y,
                  rawGazeX: avgX,
                  rawGazeY: avgY,
                });
                calState.targetBuffer = [];
                calState.capturing = false;
                setCalibrationCapturing(false);
                setCalibrationProgress(0);

                const nextStep = calState.stepIndex + 1;
                if (nextStep < CALIBRATION_TARGETS.length) {
                  calState.stepIndex = nextStep;
                  setCalibrationStep(nextStep);
                } else {
                  const fitted = fitGazeCalibration(calState.collectedSamples);
                  if (fitted) {
                    calibrationRef.current = fitted;
                    setCalibration(fitted);
                    gazeTrackerRef.current.clearHeatmap();
                  }
                  calState.stepIndex = null;
                  calState.collectedSamples = [];
                  setCalibrationStep(null);
                }
              }
            }
          }
        } else {
          latestGazeRef.current = null;
        }
      } else {
        latestGazeRef.current = null;
      }

      drawCurrentFrameToCanvas();

      // Commit React HUD / telemetry at ~10 Hz
      if (nowMs - lastHudCommitMsRef.current >= 100) {
        lastHudCommitMsRef.current = nowMs;
        const safeFps = Number.isFinite(smoothedFpsRef.current)
          ? Math.max(1, Math.min(240, Math.round(smoothedFpsRef.current)))
          : 30;
        const currentGaze = latestGazeRef.current;

        setFaceLandmarks(latestFaceLandmarksRef.current);
        setGaze(currentGaze);
        setGazeTrail([...gazeTrackerRef.current.getTrail()]);
        setGazeHeatmap([...gazeTrackerRef.current.getHeatmap()]);
        setBlinkCount(gazeTrackerRef.current.getBlinkCount());
        setFixationSec(gazeTrackerRef.current.getFixationSec(nowMs));
        setTelemetry({
          fps: safeFps,
          inferenceMs: latestInferenceMsRef.current,
          delegate: latestDelegateRef.current,
          irisLocked: currentGaze !== null,
        });
      }
    },
    [drawCurrentFrameToCanvas],
  );

  const connectToBackend = useCallback(async (): Promise<void> => {
    clientRef.current?.disconnect();
    clientRef.current = null;

    setStatus("loading-model");
    setStatusMessage("Connecting to native Eye Gaze inference backend...");

    const wsUrl = await resolveBackendWsUrl();
    if (!wsUrl) {
      setStatus("error");
      setStatusMessage(
        "Native backend URL not provided. Launch via the Eye Gaze HUD desktop app or pass ?wsUrl=ws://127.0.0.1:<port>/ws.",
      );
      return;
    }

    const client = new NativeStreamClient({
      wsUrl,
      onFrame: handlePacket,
      onStatus: (msg) => {
        statusRef.current = msg.status;
        setStatus(msg.status);
        setStatusMessage(msg.message);
        if (msg.delegate) {
          latestDelegateRef.current = msg.delegate;
          setTelemetry((prev) => ({ ...prev, delegate: msg.delegate ?? prev.delegate }));
        }
      },
      onError: () => {
        if (statusRef.current !== "ready") {
          setStatus("error");
          setStatusMessage(
            "Unable to connect to the native Eye Gaze backend. Click Retry to reconnect.",
          );
        }
      },
      onClose: (ev) => {
        if (ev.code !== 1000) {
          setStatus("error");
          setStatusMessage(
            "Native backend stream disconnected unexpectedly. Click Retry to reconnect.",
          );
        }
      },
    });

    clientRef.current = client;
    client.connect();
  }, [handlePacket]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void connectToBackend();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      clientRef.current?.disconnect();
      clientRef.current = null;
      latestBitmapRef.current?.close();
      latestBitmapRef.current = null;
    };
  }, [connectToBackend]);

  const handleRetry = useCallback((): void => {
    if (clientRef.current?.isConnected()) {
      setStatus("requesting-camera");
      setStatusMessage("Retrying webcam connection...");
      clientRef.current.retryCamera();
    } else {
      void connectToBackend();
    }
  }, [connectToBackend]);

  const handleSmoothingChange = useCallback(
    (nextConfig: SmoothingConfig): void => {
      const safeStrength = Number.isFinite(nextConfig.strength)
        ? Math.max(
            0,
            Math.min(1, Math.round(nextConfig.strength * 100) / 100),
          )
        : smoothingRef.current.strength;
      const normalized: SmoothingConfig = {
        enabled: Boolean(nextConfig.enabled),
        strength: safeStrength === 0 ? 0 : safeStrength,
      };
      setSmoothing(normalized);
      smoothingRef.current = normalized;
      if (!normalized.enabled) {
        faceSmootherRef.current.reset();
        gazeTrackerRef.current.reset();
      }
    },
    [],
  );

  const handleStartCalibration = useCallback((): void => {
    calibrationCaptureRef.current = {
      stepIndex: 0,
      capturing: false,
      targetBuffer: [],
      collectedSamples: [],
    };
    setCalibrationStep(0);
    setCalibrationCapturing(false);
    setCalibrationProgress(0);
  }, []);

  const handleCalibrationCapture = useCallback((): void => {
    const cal = calibrationCaptureRef.current;
    if (cal.stepIndex === null || cal.capturing) return;
    cal.targetBuffer = [];
    cal.capturing = true;
    setCalibrationCapturing(true);
    setCalibrationProgress(0);
  }, []);

  const handleCalibrationCancel = useCallback((): void => {
    calibrationCaptureRef.current = {
      stepIndex: null,
      capturing: false,
      targetBuffer: [],
      collectedSamples: [],
    };
    setCalibrationStep(null);
    setCalibrationCapturing(false);
    setCalibrationProgress(0);
  }, []);

  const handleResetCalibration = useCallback((): void => {
    calibrationRef.current = null;
    setCalibration(null);
    gazeTrackerRef.current.clearHeatmap();
    setGazeTrail([]);
    setGazeHeatmap([]);
  }, []);

  const handleClearHeatmap = useCallback((): void => {
    gazeTrackerRef.current.clearHeatmap();
    setGazeTrail([]);
    setGazeHeatmap([]);
    drawCurrentFrameToCanvas();
  }, [drawCurrentFrameToCanvas]);

  useEffect(() => {
    if (calibrationStep === null) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === "Space") {
        e.preventDefault();
        handleCalibrationCapture();
      } else if (e.code === "Escape") {
        e.preventDefault();
        handleCalibrationCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [calibrationStep, handleCalibrationCapture, handleCalibrationCancel]);

  const handleExportSnapshot = useCallback((): void => {
    const nowMs = Date.now();
    const filename = `eye-gaze-snapshot-${nowMs}.json`;
    const payload = {
      app: "eye-gaze-hud-desktop",
      version: "2.1.0",
      timestampMs: nowMs,
      mirrored: mirroredRef.current,
      smoothing: smoothingRef.current,
      gazeSettings: gazeSettingsRef.current,
      calibrated: calibrationRef.current !== null,
      calibration: calibrationRef.current,
      blinkCount: gazeTrackerRef.current.getBlinkCount(),
      gaze: latestGazeRef.current,
      trail: gazeTrackerRef.current.getTrail(),
    };

    const jsonText = JSON.stringify(payload, null, 2);

    if (window.electronAPI?.saveSnapshot) {
      void window.electronAPI.saveSnapshot(filename, jsonText);
      return;
    }

    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 5000);
  }, []);

  const safeFps = Number.isFinite(telemetry.fps)
    ? Math.max(0, Math.round(telemetry.fps))
    : 0;
  const safeInferenceMs = Number.isFinite(telemetry.inferenceMs)
    ? Math.max(0, telemetry.inferenceMs)
    : 0;
  const activeDelegate = telemetry.delegate ?? "GPU";

  const activeCalTarget =
    calibrationStep !== null
      ? (CALIBRATION_TARGETS[calibrationStep] ?? null)
      : null;
  const calibrationOverlay: CalibrationOverlayState | null = activeCalTarget
    ? {
        x: activeCalTarget.x,
        y: activeCalTarget.y,
        label: activeCalTarget.label,
        progress: calibrationProgress,
        stepIndex: calibrationStep ?? 0,
        totalSteps: CALIBRATION_TARGETS.length,
        capturing: calibrationCapturing,
      }
    : null;

  return (
    <div className="flex h-dvh w-full max-w-full flex-col overflow-hidden bg-[#05080f] text-slate-100 select-none">
      {/* Persistent Top Eye Gaze HUD Header */}
      <header className="z-30 flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-cyan-500/20 bg-slate-950/95 px-2.5 py-1.5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded border border-cyan-400/40 bg-cyan-500/10">
            <Eye className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
          </div>
          <h1 className="font-mono text-xs font-bold tracking-wider text-cyan-300 uppercase sm:text-sm">
            Eye Gaze HUD <span className="text-pink-400">V2.1</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Live Gaze Zone Badge */}
          <div
            data-testid="hud-gaze-zone"
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${
              gaze?.isBlinking
                ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                : gaze
                  ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-800 bg-slate-900/90 text-slate-400"
            }`}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            <span>
              {gaze ? (gaze.isBlinking ? "BLINK" : gaze.zone) : "NO LOCK"}
            </span>
          </div>

          {/* Blink Counter */}
          <div className="hidden items-center gap-1 rounded border border-slate-800 bg-slate-900/90 px-2 py-0.5 font-mono text-[11px] sm:inline-flex">
            <Activity className="h-3 w-3 text-emerald-400" aria-hidden="true" />
            <span
              data-testid="hud-blink-count"
              className="font-semibold text-emerald-300"
            >
              {blinkCount} BLINKS
            </span>
          </div>

          {/* Calibration Status */}
          {calibration && (
            <div
              data-testid="hud-calibrated-badge"
              className="hidden items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 sm:inline-flex"
            >
              <Crosshair className="h-3 w-3" aria-hidden="true" />
              5-PT CAL
            </div>
          )}

          {/* FPS Readout */}
          <div className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900/90 px-2 py-0.5 font-mono text-[11px]">
            <Gauge className="h-3 w-3 text-cyan-400" aria-hidden="true" />
            <span className="text-slate-400">FPS</span>
            <span
              data-testid="hud-fps"
              className="font-semibold text-cyan-300"
            >
              {safeFps}
            </span>
          </div>

          {/* Inference Latency */}
          <div className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900/90 px-2 py-0.5 font-mono text-[11px]">
            <Timer className="h-3 w-3 text-pink-400" aria-hidden="true" />
            <span
              data-testid="hud-inference-ms"
              className="font-semibold text-pink-300"
            >
              {safeInferenceMs.toFixed(1)} ms
            </span>
          </div>

          {/* Delegate Badge */}
          <div
            data-testid="hud-delegate"
            className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300"
          >
            <Cpu className="h-3 w-3" aria-hidden="true" />
            <span>{activeDelegate}</span>
          </div>

          {/* Panel Toggle */}
          <button
            type="button"
            data-testid="panel-toggle"
            aria-expanded={isPanelOpen}
            aria-label={
              isPanelOpen ? "Collapse control panel" : "Expand control panel"
            }
            onClick={() => setIsPanelOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {isPanelOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {isPanelOpen ? "Hide Panel" : "Controls"}
            </span>
          </button>
        </div>
      </header>

      {/* Main Responsive Stage + Collapsible Eye Gaze Control Panel */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="relative flex min-h-[220px] min-w-0 flex-1 items-center justify-center overflow-hidden p-2">
          <EyeCanvas
            videoRef={videoCanvasRef}
            canvasRef={canvasRef}
            faceLandmarks={faceLandmarks}
            gaze={gaze}
            gazeSettings={gazeSettings}
            gazeTrail={gazeTrail}
            gazeHeatmap={gazeHeatmap}
            heatmapCols={12}
            heatmapRows={9}
            viewMode={viewMode}
            mirrored={mirrored}
            status={status}
            statusMessage={statusMessage}
            onRetry={handleRetry}
            videoAspectRatio={videoAspectRatio}
            calibrationOverlay={calibrationOverlay}
            onCalibrationCapture={handleCalibrationCapture}
            onCalibrationCancel={handleCalibrationCancel}
          />
        </div>

        <EyeControlPanel
          isOpen={isPanelOpen}
          onToggleOpen={() => setIsPanelOpen((prev) => !prev)}
          telemetry={telemetry}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          mirrored={mirrored}
          onMirroredChange={setMirrored}
          smoothing={smoothing}
          onSmoothingChange={handleSmoothingChange}
          gaze={gaze}
          gazeSettings={gazeSettings}
          onGazeSettingsChange={setGazeSettings}
          blinkCount={blinkCount}
          fixationSec={fixationSec}
          isCalibrating={calibrationStep !== null}
          isCalibrated={calibration !== null}
          onStartCalibration={handleStartCalibration}
          onResetCalibration={handleResetCalibration}
          onClearHeatmap={handleClearHeatmap}
          onExportSnapshot={handleExportSnapshot}
        />
      </main>

      {/* Persistent Cybernetic Copyright Footer */}
      <footer
        data-testid="app-copyright-footer"
        className="z-20 shrink-0 border-t border-cyan-500/15 bg-slate-950/95 px-3 py-1 text-center font-mono text-[10px] text-slate-400"
      >
        © 2025–{Math.max(2026, new Date().getFullYear())}{" "}
        <a
          href="https://hamzafpv.com.tr"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-cyan-400 transition hover:text-cyan-300 hover:underline"
        >
          hamzafpv.com.tr
        </a>
        {" • "}
        <span>All rights reserved.</span>
      </footer>
    </div>
  );
}
