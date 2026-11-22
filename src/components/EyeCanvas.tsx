import { FaceLandmarker } from "@mediapipe/tasks-vision";
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { AppStatus, Point3D, ViewMode } from "../engine/geometry";
import {
  DEFAULT_GAZE_SETTINGS,
  type EyeIrisGeometry,
  type GazeEstimate,
  type GazeSettings,
  type GazeTrailPoint,
  type GazeZone,
} from "../engine/gazeEngine";

export interface CalibrationOverlayState {
  x: number;
  y: number;
  label: string;
  progress: number;
  stepIndex: number;
  totalSteps: number;
  capturing: boolean;
}

export interface DrawEyeFrameParams {
  faceLandmarks: readonly Point3D[] | null;
  gaze: GazeEstimate | null;
  gazeSettings?: GazeSettings;
  gazeTrail?: readonly GazeTrailPoint[];
  gazeHeatmap?: readonly number[];
  heatmapCols?: number;
  heatmapRows?: number;
  viewMode: ViewMode;
  mirrored: boolean;
}

export interface EyeCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  faceLandmarks: readonly Point3D[] | null;
  gaze: GazeEstimate | null;
  gazeSettings?: GazeSettings;
  gazeTrail?: readonly GazeTrailPoint[];
  gazeHeatmap?: readonly number[];
  heatmapCols?: number;
  heatmapRows?: number;
  viewMode: ViewMode;
  mirrored: boolean;
  status: AppStatus;
  statusMessage?: string;
  onRetry?: () => void;
  videoAspectRatio?: number;
  calibrationOverlay?: CalibrationOverlayState | null;
  onCalibrationCapture?: () => void;
  onCalibrationCancel?: () => void;
}

const DEFAULT_ASPECT_RATIO = 4 / 3;
const COLOR_LEFT = "#22d3ee";
const COLOR_RIGHT = "#f472b6";
const BLACKOUT_BG = "#05080f";

const GAZE_ZONE_GRID: readonly (readonly [GazeZone, number, number])[] = [
  ["UP-LEFT", 0, 0],
  ["UP", 1, 0],
  ["UP-RIGHT", 2, 0],
  ["LEFT", 0, 1],
  ["CENTER", 1, 1],
  ["RIGHT", 2, 1],
  ["DOWN-LEFT", 0, 2],
  ["DOWN", 1, 2],
  ["DOWN-RIGHT", 2, 2],
];

interface StageDimensions {
  width: number;
  height: number;
}

function isValidPoint2D(p: Point3D | undefined | null): p is Point3D {
  return Boolean(p) && Number.isFinite(p!.x) && Number.isFinite(p!.y);
}

function drawBlackoutBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = BLACKOUT_BG;
  ctx.fillRect(0, 0, width, height);

  const minorStep = 24;
  const majorStep = 96;

  ctx.strokeStyle = "rgba(34, 211, 238, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = minorStep; x < width; x += minorStep) {
    if (x % majorStep === 0) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = minorStep; y < height; y += minorStep) {
    if (y % majorStep === 0) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(34, 211, 238, 0.14)";
  ctx.beginPath();
  for (let x = majorStep; x < width; x += majorStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = majorStep; y < height; y += majorStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawConnectionList(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly Point3D[],
  connections: readonly { start: number; end: number }[],
  projectX: (nx: number) => number,
  projectY: (ny: number) => number,
  strokeStyle: string,
  lineWidth: number,
  alpha: number,
  shadowBlur = 0,
): void {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.shadowBlur = shadowBlur;
  if (shadowBlur > 0) {
    ctx.shadowColor = strokeStyle;
  }
  ctx.beginPath();
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    if (!conn) continue;
    const a = landmarks[conn.start];
    const b = landmarks[conn.end];
    if (!isValidPoint2D(a) || !isValidPoint2D(b)) continue;
    ctx.moveTo(projectX(a.x), projectY(a.y));
    ctx.lineTo(projectX(b.x), projectY(b.y));
  }
  ctx.stroke();
  ctx.restore();
}

function drawIrisAndPupil(
  ctx: CanvasRenderingContext2D,
  faceLandmarks: readonly Point3D[],
  centerIndex: number,
  ringIndices: readonly [number, number, number, number],
  projectX: (nx: number) => number,
  projectY: (ny: number) => number,
  color: string,
  isBlackout: boolean,
): void {
  const centerPt = faceLandmarks[centerIndex];
  if (!isValidPoint2D(centerPt)) return;

  const cx = projectX(centerPt.x);
  const cy = projectY(centerPt.y);

  let radiusSum = 0;
  let validCount = 0;
  for (const idx of ringIndices) {
    const rPt = faceLandmarks[idx];
    if (isValidPoint2D(rPt)) {
      radiusSum += Math.hypot(projectX(rPt.x) - cx, projectY(rPt.y) - cy);
      validCount += 1;
    }
  }
  const irisRadius = Math.max(
    2.6,
    validCount > 0 ? radiusSum / validCount : 4.5,
  );

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = isBlackout
    ? "rgba(34, 211, 238, 0.22)"
    : "rgba(34, 211, 238, 0.14)";
  ctx.lineWidth = 1.8;
  ctx.shadowColor = color;
  ctx.shadowBlur = isBlackout ? 12 : 7;
  ctx.globalAlpha = 0.96;
  ctx.beginPath();
  ctx.arc(cx, cy, irisRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner bright pupil lock core
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#f8fafc";
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.4, irisRadius * 0.38), 0, Math.PI * 2);
  ctx.fill();

  // Precision crosshair over iris
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.6;
  const tick = irisRadius + 3;
  ctx.beginPath();
  ctx.moveTo(cx - tick, cy);
  ctx.lineTo(cx + tick, cy);
  ctx.moveTo(cx, cy - tick);
  ctx.lineTo(cx, cy + tick);
  ctx.stroke();
  ctx.restore();
}

function drawEyeLandmarksLayer(
  ctx: CanvasRenderingContext2D,
  faceLandmarks: readonly Point3D[],
  projectX: (nx: number) => number,
  projectY: (ny: number) => number,
  isBlackout: boolean,
  showFaceMesh: boolean,
): void {
  if (faceLandmarks.length < 468) return;

  // Optional 3D Face Tesselation Wireframe
  if (showFaceMesh && FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
    drawConnectionList(
      ctx,
      faceLandmarks,
      FaceLandmarker.FACE_LANDMARKS_TESSELATION,
      projectX,
      projectY,
      "#38bdf8",
      0.55,
      isBlackout ? 0.2 : 0.12,
      0,
    );
  }

  // Subtle face oval in Blackout mode so head orientation is visually clear
  if (isBlackout && FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    drawConnectionList(
      ctx,
      faceLandmarks,
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
      projectX,
      projectY,
      "#38bdf8",
      1.3,
      0.42,
      4,
    );
  }

  // Eyebrows (subtle orientation cue)
  if (FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW) {
    drawConnectionList(
      ctx,
      faceLandmarks,
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
      projectX,
      projectY,
      COLOR_LEFT,
      1.3,
      0.55,
      0,
    );
  }
  if (FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW) {
    drawConnectionList(
      ctx,
      faceLandmarks,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
      projectX,
      projectY,
      COLOR_RIGHT,
      1.3,
      0.55,
      0,
    );
  }

  // Upper & Lower Eyelid Contours
  if (FaceLandmarker.FACE_LANDMARKS_LEFT_EYE) {
    drawConnectionList(
      ctx,
      faceLandmarks,
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      projectX,
      projectY,
      COLOR_LEFT,
      1.9,
      0.95,
      isBlackout ? 10 : 5,
    );
  }
  if (FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE) {
    drawConnectionList(
      ctx,
      faceLandmarks,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
      projectX,
      projectY,
      COLOR_RIGHT,
      1.9,
      0.95,
      isBlackout ? 10 : 5,
    );
  }

  // Irises & Pupils (landmarks 468..477)
  if (faceLandmarks.length >= 478) {
    drawIrisAndPupil(
      ctx,
      faceLandmarks,
      468,
      [469, 470, 471, 472],
      projectX,
      projectY,
      COLOR_RIGHT,
      isBlackout,
    );
    drawIrisAndPupil(
      ctx,
      faceLandmarks,
      473,
      [474, 475, 476, 477],
      projectX,
      projectY,
      COLOR_LEFT,
      isBlackout,
    );
  }
}

function drawGazeHeatmap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  heatmap: readonly number[],
  cols: number,
  rows: number,
): void {
  if (heatmap.length === 0 || cols <= 0 || rows <= 0) return;
  let maxVal = 0;
  for (let i = 0; i < heatmap.length; i++) {
    const v = heatmap[i] ?? 0;
    if (v > maxVal) maxVal = v;
  }
  if (maxVal <= 0) return;

  const cellW = width / cols;
  const cellH = height / rows;

  ctx.save();
  ctx.shadowBlur = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = heatmap[r * cols + c] ?? 0;
      if (val <= 0) continue;
      const intensity = Math.min(1, val / maxVal);
      if (intensity < 0.04) continue;

      let fill: string;
      if (intensity < 0.35) {
        fill = `rgba(34, 211, 238, ${(intensity * 0.42).toFixed(3)})`;
      } else if (intensity < 0.7) {
        fill = `rgba(250, 204, 21, ${(0.14 + intensity * 0.28).toFixed(3)})`;
      } else {
        fill = `rgba(244, 63, 94, ${(0.2 + intensity * 0.34).toFixed(3)})`;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
  ctx.restore();
}

function drawGazeZoneGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  activeZone: GazeZone | null,
  isBlinking: boolean,
): void {
  const cellW = width / 3;
  const cellH = height / 3;

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.16)";
  ctx.lineWidth = 1;
  if (typeof ctx.setLineDash === "function") {
    ctx.setLineDash([4, 4]);
  }
  ctx.beginPath();
  ctx.moveTo(cellW, 0);
  ctx.lineTo(cellW, height);
  ctx.moveTo(cellW * 2, 0);
  ctx.lineTo(cellW * 2, height);
  ctx.moveTo(0, cellH);
  ctx.lineTo(width, cellH);
  ctx.moveTo(0, cellH * 2);
  ctx.lineTo(width, cellH * 2);
  ctx.stroke();

  if (typeof ctx.setLineDash === "function") {
    ctx.setLineDash([]);
  }

  ctx.font =
    "600 9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  for (const [zone, col, row] of GAZE_ZONE_GRID) {
    const x = col * cellW;
    const y = row * cellH;
    const isActive = activeZone === zone;

    if (isActive) {
      const accent = isBlinking ? "#f59e0b" : "#22d3ee";
      ctx.fillStyle = isBlinking
        ? "rgba(245, 158, 11, 0.10)"
        : "rgba(34, 211, 238, 0.09)";
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);

      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.72;
      ctx.strokeRect(x + 2, y + 2, cellW - 4, cellH - 4);
      ctx.globalAlpha = 1;

      ctx.fillStyle = accent;
      ctx.fillText(zone, x + 7, y + 6);
    } else {
      ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
      ctx.fillText(zone, x + 7, y + 6);
    }
  }
  ctx.restore();
}

function drawGazeTrail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  trail: readonly GazeTrailPoint[],
): void {
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;

  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const curr = trail[i];
    if (!prev || !curr) continue;
    const ratio = i / (trail.length - 1);
    ctx.strokeStyle = `rgba(34, 211, 238, ${(0.08 + ratio * 0.62).toFixed(3)})`;
    ctx.lineWidth = 1.2 + ratio * 2.4;
    ctx.beginPath();
    ctx.moveTo(prev.x * width, prev.y * height);
    ctx.lineTo(curr.x * width, curr.y * height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGazeRaysAndReticle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gaze: GazeEstimate,
  projectX: (nx: number) => number,
  projectY: (ny: number) => number,
  isBlackout: boolean,
): void {
  const gx = gaze.screenX * width;
  const gy = gaze.screenY * height;
  const accent = gaze.isBlinking
    ? "#f59e0b"
    : gaze.calibrated
      ? "#10b981"
      : "#22d3ee";

  ctx.save();

  // Dual 3D Pupil Gaze Rays from Left & Right Irises to Target Reticle
  const eyes: Array<{ eye: EyeIrisGeometry | null; color: string }> = [
    { eye: gaze.leftEye, color: COLOR_LEFT },
    { eye: gaze.rightEye, color: COLOR_RIGHT },
  ];

  for (const { eye, color } of eyes) {
    if (!eye || !isValidPoint2D(eye.center)) continue;
    const ex = projectX(eye.center.x);
    const ey = projectY(eye.center.y);

    ctx.save();
    ctx.strokeStyle = gaze.isBlinking ? "#f59e0b" : color;
    ctx.shadowColor = gaze.isBlinking ? "#f59e0b" : color;
    ctx.shadowBlur = isBlackout ? 10 : 6;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = gaze.isBlinking ? 0.3 : 0.72;
    if (typeof ctx.setLineDash === "function") {
      ctx.setLineDash([6, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(gx, gy);
    ctx.stroke();
    ctx.restore();
  }

  // Live Gaze Target Reticle
  const outerR = gaze.isBlinking ? 16 : 22;
  const innerR = 6;

  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = isBlackout ? 16 : 10;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(gx, gy, outerR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(gx - outerR - 7, gy);
  ctx.lineTo(gx - innerR - 3, gy);
  ctx.moveTo(gx + innerR + 3, gy);
  ctx.lineTo(gx + outerR + 7, gy);
  ctx.moveTo(gx, gy - outerR - 7);
  ctx.lineTo(gx, gy - innerR - 3);
  ctx.moveTo(gx, gy + innerR + 3);
  ctx.lineTo(gx, gy + outerR + 7);
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.arc(gx, gy, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // Upright Gaze Zone Pill
  const label = gaze.isBlinking
    ? "BLINK"
    : `${gaze.zone}${gaze.calibrated ? " • CAL" : ""}`;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.font =
    "700 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const pillW = Math.max(54, label.length * 6.5 + 14);
  const pillH = 19;
  const pillX = Math.max(6, Math.min(width - pillW - 6, gx - pillW * 0.5));
  const pillY =
    gy - outerR - pillH - 8 >= 6
      ? gy - outerR - pillH - 8
      : Math.min(height - pillH - 6, gy + outerR + 8);

  ctx.fillStyle = "rgba(5, 8, 15, 0.9)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 5);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.strokeRect(pillX, pillY, pillW, pillH);
  }

  ctx.fillStyle = accent;
  ctx.fillText(label, pillX + pillW * 0.5, pillY + pillH * 0.5 + 0.5);
  ctx.restore();
}

function drawSingleEyeScope(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  eye: EyeIrisGeometry | null,
  label: string,
  accent: string,
  mirrored: boolean,
): void {
  ctx.save();
  ctx.shadowBlur = 0;

  const openRatio = eye ? Math.max(0.15, eye.openness / 100) : 0.6;
  const effRy = Math.max(3, ry * openRatio);

  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.strokeStyle = eye?.isBlinking ? "#f59e0b" : accent;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (typeof ctx.ellipse === "function") {
    ctx.ellipse(cx, cy, rx, effRy, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy, Math.min(rx, effRy), 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - rx + 3, cy);
  ctx.lineTo(cx + rx - 3, cy);
  ctx.moveTo(cx, cy - ry + 2);
  ctx.lineTo(cx, cy + ry - 2);
  ctx.stroke();

  if (eye && !eye.isBlinking) {
    const normX = mirrored ? 1 - eye.hx : eye.hx;
    const normY = eye.hy;
    const ix = cx + (normX - 0.5) * (rx * 1.45);
    const iy = cy + (normY - 0.5) * (effRy * 1.4);
    const irisR = Math.max(4, Math.min(rx * 0.36, effRy * 0.78));

    ctx.fillStyle = `${accent}33`;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ix, iy, irisR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(ix, iy, Math.max(1.8, irisR * 0.42), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font =
    "600 9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(eye ? `${label} ${eye.openness}%` : `${label} --`, cx, cy + ry + 5);
  ctx.restore();
}

function drawEyeMagnifierHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gaze: GazeEstimate,
  mirrored: boolean,
): void {
  if (width < 280 || height < 200) return;

  const boxW = 192;
  const boxH = 74;
  const boxX = 12;
  const boxY = height - boxH - 12;

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(5, 8, 15, 0.86)";
  ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
  ctx.lineWidth = 1;

  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX, boxY, boxW, boxH);
  }

  ctx.font =
    "700 9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#22d3ee";
  ctx.fillText("OCULAR SCOPE • IRIS LOCK", boxX + 9, boxY + 6);

  const leftSideEye = mirrored ? gaze.leftEye : gaze.rightEye;
  const rightSideEye = mirrored ? gaze.rightEye : gaze.leftEye;
  const leftSideLabel = mirrored ? "L-EYE" : "R-EYE";
  const rightSideLabel = mirrored ? "R-EYE" : "L-EYE";
  const leftSideColor = mirrored ? COLOR_LEFT : COLOR_RIGHT;
  const rightSideColor = mirrored ? COLOR_RIGHT : COLOR_LEFT;

  drawSingleEyeScope(
    ctx,
    boxX + 52,
    boxY + 37,
    30,
    13,
    leftSideEye,
    leftSideLabel,
    leftSideColor,
    mirrored,
  );
  drawSingleEyeScope(
    ctx,
    boxX + 140,
    boxY + 37,
    30,
    13,
    rightSideEye,
    rightSideLabel,
    rightSideColor,
    mirrored,
  );
  ctx.restore();
}

export function drawEyeFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: DrawEyeFrameParams,
): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return;
  }

  const {
    faceLandmarks,
    gaze,
    gazeSettings = DEFAULT_GAZE_SETTINGS,
    gazeTrail = [],
    gazeHeatmap = [],
    heatmapCols = 12,
    heatmapRows = 9,
    viewMode,
    mirrored,
  } = params;
  const isBlackout = viewMode === "blackout";

  if (isBlackout) {
    drawBlackoutBackdrop(ctx, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  const projectX = (nx: number): number => (mirrored ? 1 - nx : nx) * width;
  const projectY = (ny: number): number => ny * height;

  if (gazeSettings.showHeatmap && gazeHeatmap.length > 0) {
    drawGazeHeatmap(ctx, width, height, gazeHeatmap, heatmapCols, heatmapRows);
  }
  if (gazeSettings.showZoneGrid && gaze) {
    drawGazeZoneGrid(ctx, width, height, gaze.zone, gaze.isBlinking);
  }
  if (faceLandmarks && faceLandmarks.length >= 468) {
    drawEyeLandmarksLayer(
      ctx,
      faceLandmarks,
      projectX,
      projectY,
      isBlackout,
      gazeSettings.showFaceMesh,
    );
  }
  if (gazeSettings.showTrail && gazeTrail.length > 1) {
    drawGazeTrail(ctx, width, height, gazeTrail);
  }
  if (gaze && gazeSettings.showGazeRays) {
    drawGazeRaysAndReticle(
      ctx,
      width,
      height,
      gaze,
      projectX,
      projectY,
      isBlackout,
    );
  }
  if (
    gaze &&
    gazeSettings.showEyeMagnifier &&
    (gaze.leftEye !== null || gaze.rightEye !== null)
  ) {
    drawEyeMagnifierHud(ctx, width, height, gaze, mirrored);
  }
}

function computeContainBox(
  outerSize: StageDimensions | null,
  aspectRatio: number,
): StageDimensions | null {
  if (
    !outerSize ||
    outerSize.width <= 0 ||
    outerSize.height <= 0 ||
    !Number.isFinite(aspectRatio) ||
    aspectRatio <= 0
  ) {
    return null;
  }

  if (outerSize.width / outerSize.height > aspectRatio) {
    const height = Math.floor(outerSize.height);
    const width = Math.floor(outerSize.height * aspectRatio);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const width = Math.floor(outerSize.width);
  const height = Math.floor(outerSize.width / aspectRatio);
  return width > 0 && height > 0 ? { width, height } : null;
}

interface StatusDisplayMeta {
  title: string;
  defaultDetail: string;
  isError: boolean;
  showRetry: boolean;
}

function getStatusMeta(status: AppStatus): StatusDisplayMeta {
  switch (status) {
    case "requesting-camera":
      return {
        title: "Requesting Camera Access",
        defaultDetail:
          "Waiting for browser camera permission to start live eye & pupil tracking.",
        isError: false,
        showRetry: false,
      };
    case "loading-model":
      return {
        title: "Initializing Eye & Iris Engine",
        defaultDetail:
          "Loading MediaPipe Face & Iris Landmarker (478 pts + Eye Blendshapes)...",
        isError: false,
        showRetry: false,
      };
    case "permission-denied":
      return {
        title: "Camera Permission Denied",
        defaultDetail:
          "Camera access was blocked. Enable camera permission in browser settings and retry.",
        isError: true,
        showRetry: true,
      };
    case "no-camera":
      return {
        title: "No Camera Detected",
        defaultDetail:
          "No video input device was found. Connect a webcam and try again.",
        isError: true,
        showRetry: true,
      };
    case "error":
      return {
        title: "Eye Tracking Pipeline Error",
        defaultDetail:
          "Unable to initialize camera stream or eye gaze inference engine.",
        isError: true,
        showRetry: true,
      };
    case "ready":
      return {
        title: "",
        defaultDetail: "",
        isError: false,
        showRetry: false,
      };
  }
}

function renderStatusIcon(status: AppStatus): ReactElement | null {
  switch (status) {
    case "requesting-camera":
      return <Camera className="h-7 w-7 text-cyan-300" aria-hidden="true" />;
    case "loading-model":
      return (
        <Loader2
          className="h-7 w-7 animate-spin text-cyan-300"
          aria-hidden="true"
        />
      );
    case "permission-denied":
      return (
        <ShieldAlert className="h-7 w-7 text-rose-400" aria-hidden="true" />
      );
    case "no-camera":
      return (
        <CameraOff className="h-7 w-7 text-amber-400" aria-hidden="true" />
      );
    case "error":
      return (
        <AlertTriangle className="h-7 w-7 text-rose-400" aria-hidden="true" />
      );
    case "ready":
      return null;
  }
}

export function EyeCanvas({
  videoRef,
  canvasRef,
  faceLandmarks,
  gaze,
  gazeSettings = DEFAULT_GAZE_SETTINGS,
  gazeTrail = [],
  gazeHeatmap = [],
  heatmapCols = 12,
  heatmapRows = 9,
  viewMode,
  mirrored,
  status,
  statusMessage,
  onRetry,
  videoAspectRatio,
  calibrationOverlay = null,
  onCalibrationCapture,
  onCalibrationCancel,
}: EyeCanvasProps): ReactElement {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const latestDrawParamsRef = useRef<DrawEyeFrameParams>({
    faceLandmarks,
    gaze,
    gazeSettings,
    gazeTrail,
    gazeHeatmap,
    heatmapCols,
    heatmapRows,
    viewMode,
    mirrored,
  });

  const [outerSize, setOuterSize] = useState<StageDimensions | null>(null);
  const [detectedAspectRatio, setDetectedAspectRatio] = useState<number | null>(
    null,
  );

  const normalizedPropAspect =
    videoAspectRatio !== undefined &&
    Number.isFinite(videoAspectRatio) &&
    videoAspectRatio > 0
      ? videoAspectRatio
      : null;

  const effectiveAspectRatio =
    detectedAspectRatio ?? normalizedPropAspect ?? DEFAULT_ASPECT_RATIO;

  const stageBox = computeContainBox(outerSize, effectiveAspectRatio);

  const handleVideoDimensions = (
    event: SyntheticEvent<HTMLVideoElement>,
  ): void => {
    const videoEl = event.currentTarget;
    if (
      videoEl.videoWidth > 0 &&
      videoEl.videoHeight > 0 &&
      Number.isFinite(videoEl.videoWidth) &&
      Number.isFinite(videoEl.videoHeight)
    ) {
      setDetectedAspectRatio(videoEl.videoWidth / videoEl.videoHeight);
    }
  };

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const rect = outer.getBoundingClientRect();
      const width =
        rect.width > 0 ? rect.width : (entry?.contentRect.width ?? 0);
      const height =
        rect.height > 0 ? rect.height : (entry?.contentRect.height ?? 0);
      if (width > 0 && height > 0) {
        setOuterSize((prev) =>
          prev &&
          Math.abs(prev.width - width) < 0.5 &&
          Math.abs(prev.height - height) < 0.5
            ? prev
            : { width, height },
        );
      }
    });

    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncCanvasResolution = (
      fallbackWidth?: number,
      fallbackHeight?: number,
    ): void => {
      const rect = canvas.getBoundingClientRect();
      const cssWidth =
        rect.width > 0
          ? rect.width
          : canvas.clientWidth > 0
            ? canvas.clientWidth
            : (fallbackWidth ?? 0);
      const cssHeight =
        rect.height > 0
          ? rect.height
          : canvas.clientHeight > 0
            ? canvas.clientHeight
            : (fallbackHeight ?? 0);

      if (
        !Number.isFinite(cssWidth) ||
        !Number.isFinite(cssHeight) ||
        cssWidth <= 0 ||
        cssHeight <= 0
      ) {
        return;
      }

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
      drawEyeFrame(ctx, cssWidth, cssHeight, latestDrawParamsRef.current);
    };

    syncCanvasResolution();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        syncCanvasResolution(
          entry?.contentRect.width,
          entry?.contentRect.height,
        );
      });
      observer.observe(canvas);
    }

    const handleWindowResize = (): void => {
      syncCanvasResolution();
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [canvasRef]);

  useEffect(() => {
    latestDrawParamsRef.current = {
      faceLandmarks,
      gaze,
      gazeSettings,
      gazeTrail,
      gazeHeatmap,
      heatmapCols,
      heatmapRows,
      viewMode,
      mirrored,
    };

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : canvas.clientWidth;
    const cssHeight = rect.height > 0 ? rect.height : canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawEyeFrame(ctx, cssWidth, cssHeight, latestDrawParamsRef.current);
  }, [
    canvasRef,
    faceLandmarks,
    gaze,
    gazeSettings,
    gazeTrail,
    gazeHeatmap,
    heatmapCols,
    heatmapRows,
    viewMode,
    mirrored,
  ]);

  const videoClassName = [
    "block h-full w-full object-fill transition-opacity duration-200",
    mirrored ? "[transform:scaleX(-1)]" : "",
    viewMode === "blackout"
      ? "pointer-events-none opacity-0"
      : "opacity-100",
  ]
    .filter(Boolean)
    .join(" ");

  const statusMeta = getStatusMeta(status);
  const customDetail = statusMessage?.trim();
  const detailText =
    customDetail && customDetail.length > 0
      ? customDetail
      : statusMeta.defaultDetail;

  return (
    <div
      ref={outerRef}
      className="relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[#05080f]"
    >
      <div
        data-testid="eye-stage"
        className="relative overflow-hidden rounded-lg border border-cyan-500/20 bg-[#05080f] shadow-[0_0_40px_rgba(6,182,212,0.08)]"
        style={{
          aspectRatio: String(effectiveAspectRatio),
          ...(stageBox
            ? { width: `${stageBox.width}px`, height: `${stageBox.height}px` }
            : { width: "100%", maxWidth: "100%", maxHeight: "100%" }),
        }}
      >
        <video
          ref={videoRef}
          data-testid="eye-video"
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleVideoDimensions}
          onResize={handleVideoDimensions}
          className={videoClassName}
        />
        <canvas
          ref={canvasRef}
          data-testid="eye-canvas"
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        {calibrationOverlay && status === "ready" && (
          <div
            data-testid="calibration-overlay"
            className="absolute inset-0 z-10 bg-slate-950/45 backdrop-blur-[1px]"
          >
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-cyan-400/40 bg-slate-950/90 px-4 py-2 text-center shadow-[0_0_24px_rgba(34,211,238,0.2)]">
              <p className="font-mono text-[11px] font-semibold tracking-wider text-cyan-200 uppercase">
                5-Point Gaze Calibration ({calibrationOverlay.stepIndex + 1}/
                {calibrationOverlay.totalSteps}) — {calibrationOverlay.label}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-300">
                {calibrationOverlay.capturing
                  ? "Gözünüzü hedefte sabit tutun..."
                  : "Hedefe bakın ve tıklayın (veya SPACE tuşuna basın)"}
              </p>
            </div>

            <button
              type="button"
              data-testid="calibration-target-button"
              onClick={() => onCalibrationCapture?.()}
              disabled={calibrationOverlay.capturing}
              style={{
                left: `${calibrationOverlay.x * 100}%`,
                top: `${calibrationOverlay.y * 100}%`,
              }}
              aria-label={`Calibrate ${calibrationOverlay.label}`}
              className="group absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-cyan-300 bg-cyan-500/20 shadow-[0_0_28px_rgba(34,211,238,0.65)] transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <span className="h-9 w-9 animate-ping rounded-full border border-cyan-300/60" />
              <span className="absolute h-3.5 w-3.5 rounded-full bg-white shadow-[0_0_12px_#ffffff]" />
              {calibrationOverlay.capturing && (
                <span className="absolute -bottom-6 rounded bg-slate-950/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                  {Math.round(calibrationOverlay.progress * 100)}%
                </span>
              )}
            </button>

            <button
              type="button"
              data-testid="calibration-cancel-button"
              onClick={() => onCalibrationCancel?.()}
              className="absolute right-3 bottom-3 rounded-md border border-slate-600/80 bg-slate-950/90 px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-200 uppercase transition hover:border-rose-400/60 hover:text-rose-200"
            >
              Cancel (ESC)
            </button>
          </div>
        )}
      </div>

      {status !== "ready" && (
        <div
          data-testid="status-overlay"
          role={statusMeta.isError ? "alert" : "status"}
          aria-live={statusMeta.isError ? "assertive" : "polite"}
          className="absolute inset-0 z-20 flex items-center justify-center bg-[#05080f]/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-xl border border-cyan-500/30 bg-slate-950/90 p-6 text-center shadow-[0_0_32px_rgba(34,211,238,0.12)]">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/90">
              {renderStatusIcon(status)}
            </div>
            <h2 className="font-mono text-base font-semibold tracking-wider text-slate-100 uppercase">
              {statusMeta.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {detailText}
            </p>
            {statusMeta.showRetry && (
              <button
                type="button"
                data-testid="retry-button"
                onClick={() => onRetry?.()}
                className="mt-5 inline-flex items-center gap-2 rounded-md border border-cyan-400/50 bg-cyan-500/15 px-4 py-2 font-mono text-xs font-semibold tracking-wider text-cyan-200 uppercase transition hover:border-cyan-300 hover:bg-cyan-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default EyeCanvas;
