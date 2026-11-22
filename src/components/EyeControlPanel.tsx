import {
  Camera,
  ChevronRight,
  Cpu,
  Crosshair,
  Download,
  Eye,
  FlipHorizontal,
  Grid,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ReactElement } from "react";
import type {
  DelegateType,
  SmoothingConfig,
  ViewMode,
} from "../engine/geometry";
import {
  DEFAULT_GAZE_SETTINGS,
  type GazeEstimate,
  type GazeSettings,
} from "../engine/gazeEngine";

export interface EyeTelemetryMetrics {
  fps: number;
  inferenceMs: number;
  delegate: DelegateType | null;
  irisLocked: boolean;
}

export interface EyeControlPanelProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  telemetry: EyeTelemetryMetrics;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  mirrored: boolean;
  onMirroredChange: (mirrored: boolean) => void;
  smoothing: SmoothingConfig;
  onSmoothingChange: (config: SmoothingConfig) => void;
  gaze: GazeEstimate | null;
  gazeSettings?: GazeSettings;
  onGazeSettingsChange: (settings: GazeSettings) => void;
  blinkCount: number;
  fixationSec: number;
  isCalibrating: boolean;
  isCalibrated: boolean;
  onStartCalibration: () => void;
  onResetCalibration: () => void;
  onClearHeatmap: () => void;
  onExportSnapshot: () => void;
}

function clampSmoothingStrength(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
}

export function EyeControlPanel({
  isOpen,
  onToggleOpen,
  telemetry,
  viewMode,
  onViewModeChange,
  mirrored,
  onMirroredChange,
  smoothing,
  onSmoothingChange,
  gaze,
  gazeSettings = DEFAULT_GAZE_SETTINGS,
  onGazeSettingsChange,
  blinkCount,
  fixationSec,
  isCalibrating,
  isCalibrated,
  onStartCalibration,
  onResetCalibration,
  onClearHeatmap,
  onExportSnapshot,
}: EyeControlPanelProps): ReactElement {
  const safeStrength = clampSmoothingStrength(smoothing.strength, 0.55);
  const activeDelegate = telemetry.delegate ?? "GPU";

  return (
    <aside
      data-testid="control-panel"
      aria-label="Eye Gaze Controls and Telemetry"
      className={
        isOpen
          ? "flex max-h-[45dvh] w-full shrink-0 flex-col overflow-y-auto border-t border-cyan-500/20 bg-slate-950/95 p-3 text-slate-100 shadow-[0_0_30px_rgba(6,182,212,0.08)] lg:h-full lg:max-h-none lg:w-84 lg:border-t-0 lg:border-l xl:w-92"
          : "hidden"
      }
    >
      {/* Panel Header */}
      <div className="mb-3 flex items-center justify-between border-b border-slate-800/90 pb-2.5">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          <h2 className="font-mono text-xs font-semibold tracking-wider text-cyan-300 uppercase">
            Eye Gaze Lab
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
            <Cpu className="h-3 w-3" aria-hidden="true" />
            {activeDelegate}
          </span>
          <button
            type="button"
            onClick={onToggleOpen}
            aria-label="Collapse control panel"
            className="rounded border border-slate-700/80 bg-slate-900/80 p-1 text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-300"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-3.5">
        {/* Live 2D Gaze Radar + 5-Point Calibration */}
        <section
          data-testid="gaze-lab-section"
          className="rounded-lg border border-cyan-400/35 bg-gradient-to-b from-cyan-950/35 to-slate-900/80 p-2.5 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider text-cyan-200 uppercase">
              <Eye className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
              Live Gaze Radar
            </span>
            <span
              data-testid="gaze-zone-badge"
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                gaze?.isBlinking
                  ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
                  : gaze
                    ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                    : "border-slate-700 bg-slate-950/80 text-slate-500"
              }`}
            >
              {gaze ? (gaze.isBlinking ? "BLINK" : gaze.zone) : "NO LOCK"}
            </span>
          </div>

          <div className="relative mb-2.5 h-28 w-full overflow-hidden rounded-md border border-cyan-500/30 bg-slate-950/90">
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {[
                "UP-LEFT",
                "UP",
                "UP-RIGHT",
                "LEFT",
                "CENTER",
                "RIGHT",
                "DOWN-LEFT",
                "DOWN",
                "DOWN-RIGHT",
              ].map((z) => {
                const active = gaze && !gaze.isBlinking && gaze.zone === z;
                return (
                  <div
                    key={z}
                    className={`flex items-center justify-center border border-cyan-500/10 font-mono text-[8px] ${
                      active
                        ? "bg-cyan-500/20 font-bold text-cyan-200"
                        : "text-slate-600"
                    }`}
                  >
                    {z === "CENTER" ? "CTR" : z.replace("-", "")}
                  </div>
                );
              })}
            </div>
            {gaze && (
              <div
                data-testid="gaze-radar-dot"
                style={{
                  left: `${Math.max(4, Math.min(96, gaze.screenX * 100))}%`,
                  top: `${Math.max(8, Math.min(92, gaze.screenY * 100))}%`,
                }}
                className={`pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-[0_0_12px_rgba(34,211,238,0.85)] transition-[left,top] duration-75 ${
                  gaze.isBlinking
                    ? "border-amber-300 bg-amber-400"
                    : isCalibrated
                      ? "border-emerald-200 bg-emerald-400"
                      : "border-white bg-cyan-400"
                }`}
              />
            )}
          </div>

          {/* 5-Point Calibration & Heatmap Actions */}
          <div className="mb-2.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="start-calibration-button"
              onClick={onStartCalibration}
              className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 font-mono text-[10px] font-semibold uppercase transition ${
                isCalibrating
                  ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-200"
                  : "border-cyan-400/60 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
              }`}
            >
              <Crosshair className="h-3 w-3" aria-hidden="true" />
              {isCalibrating
                ? "Calibrating..."
                : isCalibrated
                  ? "Recalibrate 5-Pt"
                  : "5-Pt Calibrate"}
            </button>

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                data-testid="reset-calibration-button"
                disabled={!isCalibrated}
                onClick={onResetCalibration}
                title="Reset gaze calibration"
                className="flex items-center justify-center gap-1 rounded border border-slate-700/80 bg-slate-950/70 px-1.5 py-1.5 font-mono text-[10px] font-semibold text-slate-300 uppercase transition hover:border-amber-400/50 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset
              </button>
              <button
                type="button"
                data-testid="clear-heatmap-button"
                onClick={onClearHeatmap}
                title="Clear gaze heatmap and trail"
                className="flex items-center justify-center gap-1 rounded border border-slate-700/80 bg-slate-950/70 px-1.5 py-1.5 font-mono text-[10px] font-semibold text-slate-300 uppercase transition hover:border-rose-400/50 hover:text-rose-200"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>

          {/* Ocular Biometrics Readout */}
          <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
            <div className="rounded border border-slate-800/90 bg-slate-950/70 px-2 py-1">
              <div className="text-[9px] text-cyan-300">LEFT IRIS (hx, hy)</div>
              <div className="font-semibold text-slate-100">
                {gaze?.leftEye
                  ? `${gaze.leftEye.hx.toFixed(2)}, ${gaze.leftEye.hy.toFixed(2)} • ${gaze.leftEye.openness}%`
                  : "-- , --"}
              </div>
            </div>
            <div className="rounded border border-slate-800/90 bg-slate-950/70 px-2 py-1">
              <div className="text-[9px] text-pink-300">RIGHT IRIS (hx, hy)</div>
              <div className="font-semibold text-slate-100">
                {gaze?.rightEye
                  ? `${gaze.rightEye.hx.toFixed(2)}, ${gaze.rightEye.hy.toFixed(2)} • ${gaze.rightEye.openness}%`
                  : "-- , --"}
              </div>
            </div>
            <div className="rounded border border-slate-800/90 bg-slate-950/70 px-2 py-1">
              <div className="text-[9px] text-slate-400">BLINKS / FIXATION</div>
              <div className="font-semibold text-emerald-300">
                {blinkCount} blinks • {fixationSec.toFixed(1)}s
              </div>
            </div>
            <div className="rounded border border-slate-800/90 bg-slate-950/70 px-2 py-1">
              <div className="text-[9px] text-slate-400">GAZE COORD (X, Y)</div>
              <div className="font-semibold text-cyan-200">
                {gaze
                  ? `${Math.round(gaze.screenX * 100)}%, ${Math.round(gaze.screenY * 100)}%`
                  : "--%, --%"}
              </div>
            </div>
            <div className="col-span-2 rounded border border-slate-800/90 bg-slate-950/70 px-2 py-1">
              <div className="text-[9px] text-slate-400">
                HEAD POSE (YAW / PITCH / ROLL)
              </div>
              <div className="font-semibold text-slate-200">
                {gaze?.headMetrics
                  ? `${gaze.headMetrics.headYawDeg.toFixed(1)}° / ${gaze.headMetrics.headPitchDeg.toFixed(1)}° / ${gaze.headMetrics.headRollDeg.toFixed(1)}°`
                  : "--° / --° / --°"}
              </div>
            </div>
          </div>
        </section>

        {/* Gaze Sensitivity & Head-Pose Assist */}
        <section className="rounded-lg border border-slate-800/90 bg-slate-900/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
              Gaze Sensitivity
            </span>
            <span className="font-mono text-[10px] text-cyan-400">
              {isCalibrated ? "CALIBRATED" : "MANUAL"}
            </span>
          </div>

          <div className="space-y-2.5">
            <div>
              <div className="mb-0.5 flex justify-between font-mono text-[10px]">
                <label htmlFor="gaze-sens-x" className="text-slate-300">
                  Horizontal Gain (X)
                </label>
                <span className="text-cyan-300">
                  {gazeSettings.sensitivityX.toFixed(1)}x
                </span>
              </div>
              <input
                id="gaze-sens-x"
                data-testid="gaze-sensitivity-x"
                type="range"
                min={0.8}
                max={4.0}
                step={0.1}
                value={gazeSettings.sensitivityX}
                onChange={(e) =>
                  onGazeSettingsChange({
                    ...gazeSettings,
                    sensitivityX: Number.parseFloat(e.target.value),
                  })
                }
                className="h-1.5 w-full cursor-pointer accent-cyan-400"
              />
            </div>

            <div>
              <div className="mb-0.5 flex justify-between font-mono text-[10px]">
                <label htmlFor="gaze-sens-y" className="text-slate-300">
                  Vertical Gain (Y)
                </label>
                <span className="text-cyan-300">
                  {gazeSettings.sensitivityY.toFixed(1)}x
                </span>
              </div>
              <input
                id="gaze-sens-y"
                data-testid="gaze-sensitivity-y"
                type="range"
                min={0.8}
                max={4.0}
                step={0.1}
                value={gazeSettings.sensitivityY}
                onChange={(e) =>
                  onGazeSettingsChange({
                    ...gazeSettings,
                    sensitivityY: Number.parseFloat(e.target.value),
                  })
                }
                className="h-1.5 w-full cursor-pointer accent-cyan-400"
              />
            </div>

            <div>
              <div className="mb-0.5 flex justify-between font-mono text-[10px]">
                <label htmlFor="gaze-head-comp" className="text-slate-300">
                  Head-Pose Assist
                </label>
                <span className="text-cyan-300">
                  {Math.round(gazeSettings.headCompensation * 100)}%
                </span>
              </div>
              <input
                id="gaze-head-comp"
                data-testid="gaze-head-comp"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={gazeSettings.headCompensation}
                onChange={(e) =>
                  onGazeSettingsChange({
                    ...gazeSettings,
                    headCompensation: Number.parseFloat(e.target.value),
                  })
                }
                className="h-1.5 w-full cursor-pointer accent-cyan-400"
              />
            </div>
          </div>
        </section>

        {/* Visualization Layers */}
        <section className="rounded-lg border border-slate-800/90 bg-slate-900/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
              HUD Visual Layers
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
            {(
              [
                ["showGazeRays", "Rays & Reticle"],
                ["showZoneGrid", "3x3 Zone Grid"],
                ["showHeatmap", "Heatmap"],
                ["showTrail", "Saccade Trail"],
                ["showEyeMagnifier", "Ocular Scope"],
                ["showFaceMesh", "Face Mesh"],
              ] as const
            ).map(([key, label]) => {
              const active = gazeSettings[key];
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`toggle-${key}`}
                  aria-pressed={active}
                  onClick={() =>
                    onGazeSettingsChange({
                      ...gazeSettings,
                      [key]: !active,
                    })
                  }
                  className={`rounded border px-2 py-1.5 text-left transition ${
                    active
                      ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                      : "border-slate-800 bg-slate-950/70 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {active ? "● " : "○ "}
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Display Mode & Mirror */}
        <section className="rounded-lg border border-slate-800/90 bg-slate-900/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
              Display Mode
            </span>
            <span className="font-mono text-[10px] text-cyan-400 uppercase">
              {viewMode}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="mode-overlay"
              aria-pressed={viewMode === "overlay"}
              onClick={() => onViewModeChange("overlay")}
              className={`flex items-center justify-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-xs font-medium transition ${
                viewMode === "overlay"
                  ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.18)]"
                  : "border-slate-700/80 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Overlay
            </button>

            <button
              type="button"
              data-testid="mode-blackout"
              aria-pressed={viewMode === "blackout"}
              onClick={() => onViewModeChange("blackout")}
              className={`flex items-center justify-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-xs font-medium transition ${
                viewMode === "blackout"
                  ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.18)]"
                  : "border-slate-700/80 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              <Grid className="h-3.5 w-3.5" aria-hidden="true" />
              Blackout
            </button>
          </div>

          <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span className="flex items-center gap-1.5 font-mono text-xs text-slate-300">
              <FlipHorizontal
                className="h-3.5 w-3.5 text-cyan-400"
                aria-hidden="true"
              />
              Mirror Mode
            </span>
            <button
              type="button"
              data-testid="mirror-toggle"
              aria-pressed={mirrored}
              onClick={() => onMirroredChange(!mirrored)}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider uppercase transition ${
                mirrored
                  ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-700 bg-slate-950/80 text-slate-400 hover:text-slate-200"
              }`}
            >
              {mirrored ? "ON" : "OFF"}
            </button>
          </div>
        </section>

        {/* One-Euro Gaze Smoothing */}
        <section className="rounded-lg border border-slate-800/90 bg-slate-900/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
              Gaze Smoothing
            </span>
            <button
              type="button"
              data-testid="smoothing-toggle"
              aria-pressed={smoothing.enabled}
              onClick={() =>
                onSmoothingChange({
                  ...smoothing,
                  enabled: !smoothing.enabled,
                })
              }
              className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase transition ${
                smoothing.enabled
                  ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-700 bg-slate-950/80 text-slate-400"
              }`}
            >
              {smoothing.enabled ? "ON" : "OFF"}
            </button>
          </div>

          <div>
            <div className="mb-0.5 flex justify-between font-mono text-[10px]">
              <label htmlFor="smoothing-strength" className="text-slate-300">
                One-Euro Filter Strength
              </label>
              <span className="text-cyan-300">
                {Math.round(safeStrength * 100)}%
              </span>
            </div>
            <input
              id="smoothing-strength"
              data-testid="smoothing-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={!smoothing.enabled}
              value={safeStrength}
              onChange={(e) =>
                onSmoothingChange({
                  ...smoothing,
                  strength: Number.parseFloat(e.target.value),
                })
              }
              className="h-1.5 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
        </section>

        {/* Export Snapshot */}
        <button
          type="button"
          data-testid="export-snapshot"
          onClick={onExportSnapshot}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 font-mono text-xs font-semibold tracking-wider text-cyan-200 uppercase transition hover:border-cyan-400 hover:bg-cyan-500/25"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export Gaze Snapshot (JSON)
        </button>

        {/* Panel Copyright */}
        <div className="border-t border-slate-800/80 pt-2 text-center font-mono text-[10px] text-slate-500">
          © 2025–{Math.max(2026, new Date().getFullYear())}{" "}
          <a
            href="https://hamzafpv.com.tr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400/90 hover:text-cyan-300 hover:underline"
          >
            hamzafpv.com.tr
          </a>{" "}
          • All rights reserved.
        </div>
      </div>
    </aside>
  );
}

export default EyeControlPanel;
