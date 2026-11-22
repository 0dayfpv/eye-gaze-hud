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
import { EyeEngine, isEyeEngineCancelledError } from "./engine/eyeEngine";
import {
  CALIBRATION_TARGETS,
  DEFAULT_GAZE_SETTINGS,
  GazeTrackerState,
  computeEyeGaze,
  fitGazeCalibration,
  type AffineGazeCalibration,
  type EyeBlendshapes,
  type GazeCalibrationSample,
  type GazeEstimate,
  type GazeSettings,
  type GazeTrailPoint,
} from "./engine/gazeEngine";
import {
  PoseSmoother,
  type AppStatus,
  type DelegateType,
  type Point3D,
  type SmoothingConfig,
  type ViewMode,
} from "./engine/geometry";

const DEFAULT_SMOOTHING: SmoothingConfig = {
  enabled: true,
  strength: 0.55,
};

const CALIBRATION_FRAMES_PER_TARGET = 10;

function classifyCameraError(error: unknown): {
  status: AppStatus;
  message: string;
} {
  const errName =
    error instanceof Error ||
    (typeof error === "object" && error !== null && "name" in error)
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const errMsg =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "";

  if (
    errName === "NotAllowedError" ||
    errName === "PermissionDeniedError" ||
    errName === "SecurityError"
  ) {
    return {
      status: "permission-denied",
      message:
        errMsg ||
        "Camera permission was denied. Please allow camera access in your browser settings and click Retry.",
    };
  }

  if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
    return {
      status: "no-camera",
      message:
        errMsg ||
        "No camera device was found. Please connect a webcam and click Retry.",
    };
  }

  if (errName === "NotReadableError" || errName === "TrackStartError") {
    return {
      status: "error",
      message:
        errMsg ||
        "Camera device is currently in use or unreadable. Close other applications using the camera and click Retry.",
    };
  }

  return {
    status: "error",
    message:
      errMsg ||
      "Unable to initialize camera stream in this environment. Check device permissions and click Retry.",
  };
}

async function waitForVideoMetadata(
  videoEl: HTMLVideoElement,
  isCancelled: () => boolean,
  maxWaitMs = 1500,
): Promise<void> {
  if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
    return;
  }

  if (
    typeof navigator !== "undefined" &&
    /jsdom/i.test(navigator.userAgent ?? "")
  ) {
    return;
  }

  await new Promise<void>((resolve) => {
    const startMs = Date.now();
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      videoEl.removeEventListener("loadeddata", onReady);
      videoEl.removeEventListener("loadedmetadata", onReady);
      videoEl.removeEventListener("canplay", onReady);
      clearInterval(pollId);
      resolve();
    };

    const onReady = (): void => {
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        finish();
      }
    };

    videoEl.addEventListener("loadeddata", onReady);
    videoEl.addEventListener("loadedmetadata", onReady);
    videoEl.addEventListener("canplay", onReady);

    const pollId = setInterval(() => {
      if (
        isCancelled() ||
        (videoEl.readyState >= 2 && videoEl.videoWidth > 0) ||
        Date.now() - startMs >= maxWaitMs
      ) {
        finish();
      }
    }, 25);
  });
}

export default function App(): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<EyeEngine | null>(null);
  const faceSmootherRef = useRef<PoseSmoother>(new PoseSmoother());
  const gazeTrackerRef = useRef<GazeTrackerState>(new GazeTrackerState());
  const streamRef = useRef<MediaStream | null>(null);
  const sessionTokenRef = useRef<number>(0);

  const [status, setStatus] = useState<AppStatus>("requesting-camera");
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

  // Live refs for the requestAnimationFrame loop
  const statusRef = useRef<AppStatus>(status);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const mirroredRef = useRef<boolean>(mirrored);
  const smoothingRef = useRef<SmoothingConfig>(smoothing);
  const gazeSettingsRef = useRef<GazeSettings>(gazeSettings);
  const calibrationRef = useRef<AffineGazeCalibration | null>(calibration);

  const latestFaceLandmarksRef = useRef<readonly Point3D[] | null>(null);
  const latestFaceBlendshapesRef = useRef<EyeBlendshapes | null>(null);
  const latestGazeRef = useRef<GazeEstimate | null>(null);

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

  const stopActiveStream = useCallback((): void => {
    const activeStream = streamRef.current;
    streamRef.current = null;
    if (activeStream) {
      for (const track of activeStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore track stop errors */
        }
      }
    }
    const videoEl = videoRef.current;
    if (videoEl) {
      try {
        videoEl.srcObject = null;
      } catch {
        /* ignore srcObject clear errors */
      }
    }
  }, []);

  const getOrCreateEngine = useCallback((): EyeEngine => {
    if (!engineRef.current) {
      engineRef.current = new EyeEngine();
    }
    return engineRef.current;
  }, []);

  const startSession = useCallback(async (): Promise<void> => {
    const token = ++sessionTokenRef.current;
    const isCancelled = (): boolean => token !== sessionTokenRef.current;

    stopActiveStream();
    faceSmootherRef.current.reset();
    gazeTrackerRef.current.reset();
    latestFaceLandmarksRef.current = null;
    latestFaceBlendshapesRef.current = null;
    latestGazeRef.current = null;
    setFaceLandmarks(null);
    setGaze(null);
    setGazeTrail([]);
    setStatus("requesting-camera");
    setStatusMessage(undefined);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      if (!isCancelled()) {
        setStatus("error");
        setStatusMessage(
          "MediaDevices camera API is not available in this browser or context.",
        );
      }
      return;
    }

    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (cameraError) {
      if (isCancelled()) return;
      const classified = classifyCameraError(cameraError);
      setStatus(classified.status);
      setStatusMessage(classified.message);
      return;
    }

    if (isCancelled()) {
      for (const track of mediaStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    streamRef.current = mediaStream;
    const videoEl = videoRef.current;
    if (videoEl) {
      try {
        videoEl.srcObject = mediaStream;
        const playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
          await playPromise.catch(() => undefined);
        }
      } catch {
        /* ignore synthetic play errors */
      }
    }

    if (isCancelled()) {
      stopActiveStream();
      return;
    }

    setStatus("loading-model");
    setStatusMessage(undefined);

    const engine = getOrCreateEngine();
    let activeDelegate: DelegateType;
    try {
      activeDelegate = await engine.init({
        minFaceDetectionConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
    } catch (modelError) {
      if (isCancelled() || isEyeEngineCancelledError(modelError)) {
        return;
      }
      setStatus("error");
      setStatusMessage(
        modelError instanceof Error && modelError.message.trim().length > 0
          ? `Failed to load MediaPipe Eye/Face model: ${modelError.message}`
          : "Failed to download or initialize MediaPipe Eye/Face model. Check your connection and click Retry.",
      );
      return;
    }

    if (isCancelled()) return;

    if (videoEl) {
      await waitForVideoMetadata(videoEl, isCancelled);
    }

    if (isCancelled()) return;

    setTelemetry((prev) => ({
      ...prev,
      delegate: activeDelegate,
    }));
    statusRef.current = "ready";
    setStatus("ready");
    setStatusMessage(undefined);
  }, [getOrCreateEngine, stopActiveStream]);

  useEffect(() => {
    const initTimer = window.setTimeout(() => {
      void startSession();
    }, 0);
    return () => {
      window.clearTimeout(initTimer);
      sessionTokenRef.current += 1;
      stopActiveStream();
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, [startSession, stopActiveStream]);

  // High-FPS synchronized requestAnimationFrame loop
  useEffect(() => {
    let rafId: number | null = null;
    let lastFrameMs: number | null = null;
    let smoothedFps = 30;
    let lastHudCommitMs = 0;
    let lastVideoTime = -1;
    let lastInferenceEndMs = 0;
    let latestInferenceMs = 0;

    const handleVisibilityChange = (): void => {
      lastFrameMs = null;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const tick = (timestampMs: number): void => {
      const nowMs =
        Number.isFinite(timestampMs) && timestampMs > 0
          ? timestampMs
          : performance.now();

      if (lastFrameMs !== null) {
        const dtMs = nowMs - lastFrameMs;
        if (dtMs > 1 && dtMs < 1000) {
          const instantFps = 1000 / dtMs;
          smoothedFps = smoothedFps * 0.85 + instantFps * 0.15;
        }
      }
      lastFrameMs = nowMs;

      let frameDelegate: DelegateType | null =
        engineRef.current?.getActiveDelegate() ?? "GPU";

      const videoEl = videoRef.current;
      const engine = engineRef.current;

      const minGapMs = Math.min(180, Math.max(14, latestInferenceMs * 1.15));
      const canRunInference =
        statusRef.current === "ready" &&
        videoEl !== null &&
        engine !== null &&
        engine.isReady() &&
        videoEl.readyState >= 2 &&
        videoEl.videoWidth > 0 &&
        videoEl.videoHeight > 0 &&
        (videoEl.currentTime !== lastVideoTime || lastVideoTime < 0) &&
        performance.now() - lastInferenceEndMs >= minGapMs;

      if (canRunInference && videoEl && engine) {
        lastVideoTime = videoEl.currentTime;
        const result = engine.detectFrame(videoEl, nowMs);
        lastInferenceEndMs = performance.now();
        latestInferenceMs = Number.isFinite(result.inferenceMs)
          ? Math.max(0, result.inferenceMs)
          : 0;
        frameDelegate = result.delegate;

        const smoothedFace = result.faceLandmarks
          ? faceSmootherRef.current.filter(
              result.faceLandmarks,
              nowMs,
              smoothingRef.current,
            )
          : null;

        latestFaceLandmarksRef.current = smoothedFace;
        latestFaceBlendshapesRef.current = result.faceBlendshapes;

        if (smoothedFace && smoothedFace.length >= 478) {
          const rawGaze = computeEyeGaze({
            faceLandmarks: smoothedFace,
            blendshapes: latestFaceBlendshapesRef.current,
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
                    const fitted = fitGazeCalibration(
                      calState.collectedSamples,
                    );
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
      }

      // Synchronized canvas draw
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const cssWidth = rect.width > 0 ? rect.width : canvas.clientWidth;
        const cssHeight = rect.height > 0 ? rect.height : canvas.clientHeight;
        if (cssWidth > 0 && cssHeight > 0) {
          const dpr =
            Number.isFinite(window.devicePixelRatio) &&
            window.devicePixelRatio > 0
              ? window.devicePixelRatio
              : 1;
          const backingW = Math.max(1, Math.round(cssWidth * dpr));
          const backingH = Math.max(1, Math.round(cssHeight * dpr));
          if (canvas.width !== backingW || canvas.height !== backingH) {
            canvas.width = backingW;
            canvas.height = backingH;
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
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
          }
        }
      }

      // Commit React HUD / telemetry state at ~10 Hz when ready
      if (statusRef.current === "ready" && nowMs - lastHudCommitMs >= 100) {
        lastHudCommitMs = nowMs;
        const safeFps = Number.isFinite(smoothedFps)
          ? Math.max(1, Math.min(240, Math.round(smoothedFps)))
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
          inferenceMs: latestInferenceMs,
          delegate: frameDelegate,
          irisLocked: currentGaze !== null,
        });
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

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
  }, []);

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
    const payload = {
      app: "eye-gaze-hud",
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
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `eye-gaze-snapshot-${nowMs}.json`;
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
            videoRef={videoRef}
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
            onRetry={() => {
              void startSession();
            }}
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
