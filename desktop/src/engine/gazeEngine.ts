import { computeFaceHeadMetrics } from "./geometry";
import type {
  AffineGazeCalibration,
  EyeBlendshapes,
  EyeIrisGeometry,
  GazeCalibrationSample,
  GazeEstimate,
  GazeSettings,
  GazeTrailPoint,
  GazeZone,
  Point3D,
  SmoothingConfig,
} from "./types";

export type {
  AffineGazeCalibration,
  EyeBlendshapes,
  EyeIrisGeometry,
  GazeCalibrationSample,
  GazeEstimate,
  GazeSettings,
  GazeTrailPoint,
  GazeZone,
} from "./types";

export const DEFAULT_GAZE_SETTINGS: GazeSettings = {
  sensitivityX: 2.2,
  sensitivityY: 2.4,
  headCompensation: 0.4,
  showGazeRays: true,
  showZoneGrid: true,
  showTrail: true,
  showHeatmap: true,
  showFaceMesh: false,
  showEyeMagnifier: true,
};

export const CALIBRATION_TARGETS: readonly {
  id: string;
  label: string;
  x: number;
  y: number;
}[] = [
  { id: "center", label: "Center", x: 0.5, y: 0.5 },
  { id: "top-left", label: "Top-Left", x: 0.14, y: 0.16 },
  { id: "top-right", label: "Top-Right", x: 0.86, y: 0.16 },
  { id: "bottom-right", label: "Bottom-Right", x: 0.86, y: 0.84 },
  { id: "bottom-left", label: "Bottom-Left", x: 0.14, y: 0.84 },
];

function isFinitePt(p: Point3D | undefined | null): p is Point3D {
  return (
    Boolean(p) &&
    Number.isFinite(p!.x) &&
    Number.isFinite(p!.y) &&
    Number.isFinite(p!.z)
  );
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

export function extractEyeBlendshapes(
  categories:
    | ReadonlyArray<{ categoryName: string; score: number }>
    | undefined
    | null,
): EyeBlendshapes | null {
  if (!categories || categories.length === 0) {
    return null;
  }
  const map = new Map<string, number>();
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (c && Number.isFinite(c.score)) {
      map.set(c.categoryName, clamp(c.score, 0, 1));
    }
  }
  if (!map.has("eyeLookInLeft") && !map.has("eyeBlinkLeft")) {
    return null;
  }
  return {
    eyeLookInLeft: map.get("eyeLookInLeft") ?? 0,
    eyeLookOutLeft: map.get("eyeLookOutLeft") ?? 0,
    eyeLookUpLeft: map.get("eyeLookUpLeft") ?? 0,
    eyeLookDownLeft: map.get("eyeLookDownLeft") ?? 0,
    eyeLookInRight: map.get("eyeLookInRight") ?? 0,
    eyeLookOutRight: map.get("eyeLookOutRight") ?? 0,
    eyeLookUpRight: map.get("eyeLookUpRight") ?? 0,
    eyeLookDownRight: map.get("eyeLookDownRight") ?? 0,
    eyeBlinkLeft: map.get("eyeBlinkLeft") ?? 0,
    eyeBlinkRight: map.get("eyeBlinkRight") ?? 0,
  };
}

/**
 * Computes rotation-invariant normalized iris position inside the eye socket
 * using 2D projection onto the eye-corner axis (outer -> inner) and its normal.
 */
function measureSingleEye(
  face: readonly Point3D[],
  leftMostCornerIdx: number,
  rightMostCornerIdx: number,
  topLidIdx: number,
  bottomLidIdx: number,
  irisCenterIdx: number,
  irisRingIndices: readonly [number, number, number, number],
  blendshapeBlink?: number,
): EyeIrisGeometry | null {
  const cLeft = face[leftMostCornerIdx];
  const cRight = face[rightMostCornerIdx];
  const topLid = face[topLidIdx];
  const botLid = face[bottomLidIdx];
  const iris = face[irisCenterIdx];

  if (
    !isFinitePt(cLeft) ||
    !isFinitePt(cRight) ||
    !isFinitePt(topLid) ||
    !isFinitePt(botLid) ||
    !isFinitePt(iris)
  ) {
    return null;
  }

  const dx = cRight.x - cLeft.x;
  const dy = cRight.y - cLeft.y;
  const eyeWidth = Math.hypot(dx, dy);
  if (eyeWidth < 1e-5) {
    return null;
  }

  // Unit vector along eye width (leftMost -> rightMost in image space)
  const ux = dx / eyeWidth;
  const uy = dy / eyeWidth;
  // Perpendicular downward unit vector in image space (y increases downward)
  const vx = -uy;
  const vy = ux;

  // Horizontal iris ratio [0..1] along (cLeft -> cRight)
  const relX = iris.x - cLeft.x;
  const relY = iris.y - cLeft.y;
  const hx = clamp((relX * ux + relY * uy) / eyeWidth, 0, 1);

  // Vertical eyelid span & iris vertical ratio [0..1] (0 = top lid, 1 = bottom lid)
  const lidDx = botLid.x - topLid.x;
  const lidDy = botLid.y - topLid.y;
  const eyeHeight = Math.max(1e-5, Math.abs(lidDx * vx + lidDy * vy));
  const ear = eyeHeight / eyeWidth;

  const lidMidX = (topLid.x + botLid.x) * 0.5;
  const lidMidY = (topLid.y + botLid.y) * 0.5;
  // Use a stable reference height (~0.28 * eyeWidth) so blinking doesn't explode vertical ratio
  const refHeight = Math.max(eyeHeight, eyeWidth * 0.28);
  const vertOffset =
    ((iris.x - lidMidX) * vx + (iris.y - lidMidY) * vy) / refHeight;
  const hy = clamp(0.5 + vertOffset, 0, 1);

  // Measure iris radius from perimeter points
  let rSum = 0;
  let rCount = 0;
  for (const idx of irisRingIndices) {
    const rp = face[idx];
    if (isFinitePt(rp)) {
      rSum += Math.hypot(rp.x - iris.x, rp.y - iris.y);
      rCount += 1;
    }
  }
  const radius = rCount > 0 ? rSum / rCount : eyeWidth * 0.18;

  const earOpenness = clamp(((ear - 0.08) / 0.24) * 100, 0, 100);
  const openness =
    blendshapeBlink !== undefined
      ? Math.round(
          clamp(earOpenness * 0.55 + (1 - blendshapeBlink) * 100 * 0.45, 0, 100),
        )
      : Math.round(earOpenness);

  const isBlinking =
    (blendshapeBlink !== undefined && blendshapeBlink > 0.52) ||
    earOpenness < 22;

  return {
    hx: Math.round(hx * 1000) / 1000,
    hy: Math.round(hy * 1000) / 1000,
    center: { x: iris.x, y: iris.y, z: iris.z },
    radius,
    openness,
    isBlinking,
  };
}

export function classifyGazeZone(
  screenX: number,
  screenY: number,
  deadzoneX = 0.16,
  deadzoneY = 0.16,
): GazeZone {
  const dx = screenX - 0.5;
  const dy = screenY - 0.5;

  const horiz = dx < -deadzoneX ? "LEFT" : dx > deadzoneX ? "RIGHT" : "";
  const vert = dy < -deadzoneY ? "UP" : dy > deadzoneY ? "DOWN" : "";

  if (!horiz && !vert) return "CENTER";
  if (vert && horiz) return `${vert}-${horiz}` as GazeZone;
  return (vert || horiz) as GazeZone;
}

/**
 * Solves 3x3 linear system A * w = b using Gaussian elimination with partial pivoting.
 * Returns null if matrix is singular/ill-conditioned.
 */
function solve3x3(
  A: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  b: readonly [number, number, number],
): [number, number, number] | null {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];

  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < 3; r++) {
      const val = Math.abs(M[r]![col]!);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-8) {
      return null;
    }
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }
    const pivot = M[col]![col]!;
    for (let r = col + 1; r < 3; r++) {
      const factor = M[r]![col]! / pivot;
      for (let c = col; c < 4; c++) {
        M[r]![c] = M[r]![c]! - factor * M[col]![c]!;
      }
    }
  }

  const x: [number, number, number] = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let sum = M[r]![3]!;
    for (let c = r + 1; c < 3; c++) {
      sum -= M[r]![c]! * x[c]!;
    }
    const val = sum / M[r]![r]!;
    if (!Number.isFinite(val)) return null;
    x[r] = val;
  }
  return x;
}

/**
 * Fits a 2D affine mapping (rawGazeX, rawGazeY) -> (screenX, screenY)
 * from 3+ calibration samples using ordinary least squares.
 */
export function fitGazeCalibration(
  samples: readonly GazeCalibrationSample[],
): AffineGazeCalibration | null {
  if (samples.length < 3) {
    return null;
  }

  let s1 = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let btx0 = 0;
  let btx1 = 0;
  let btx2 = 0;
  let bty0 = 0;
  let bty1 = 0;
  let bty2 = 0;

  for (const s of samples) {
    if (
      !Number.isFinite(s.rawGazeX) ||
      !Number.isFinite(s.rawGazeY) ||
      !Number.isFinite(s.targetX) ||
      !Number.isFinite(s.targetY)
    ) {
      continue;
    }
    s1 += 1;
    sx += s.rawGazeX;
    sy += s.rawGazeY;
    sxx += s.rawGazeX * s.rawGazeX;
    sxy += s.rawGazeX * s.rawGazeY;
    syy += s.rawGazeY * s.rawGazeY;

    btx0 += s.targetX;
    btx1 += s.targetX * s.rawGazeX;
    btx2 += s.targetX * s.rawGazeY;

    bty0 += s.targetY;
    bty1 += s.targetY * s.rawGazeX;
    bty2 += s.targetY * s.rawGazeY;
  }

  if (s1 < 3) {
    return null;
  }

  // Tiny ridge regularization (1e-4) keeps fit numerically stable even if samples are collinear
  const reg = 1e-4;
  const A: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ] = [
    [s1, sx, sy],
    [sx, sxx + reg, sxy],
    [sy, sxy, syy + reg],
  ];

  const wx = solve3x3(A, [btx0, btx1, btx2]);
  const wy = solve3x3(A, [bty0, bty1, bty2]);
  if (!wx || !wy) {
    return null;
  }

  return {
    ax0: wx[0],
    ax1: wx[1],
    ax2: wx[2],
    ay0: wy[0],
    ay1: wy[1],
    ay2: wy[2],
    sampleCount: s1,
  };
}

/**
 * Estimates eye gaze direction, 2D screen coordinates, and 9-zone classification
 * from 478 MediaPipe FaceLandmarker points + optional neural EyeBlendshapes.
 */
export function computeEyeGaze(params: {
  faceLandmarks: readonly Point3D[] | null;
  blendshapes?: EyeBlendshapes | null;
  mirrored: boolean;
  settings?: GazeSettings;
  calibration?: AffineGazeCalibration | null;
}): GazeEstimate | null {
  const {
    faceLandmarks,
    blendshapes = null,
    mirrored,
    settings = DEFAULT_GAZE_SETTINGS,
    calibration = null,
  } = params;

  if (!faceLandmarks || faceLandmarks.length < 478) {
    return null;
  }

  // Right eye (anatomical right, viewer's left in unmirrored camera): 33 (outer) -> 133 (inner), iris 468
  const rightEye = measureSingleEye(
    faceLandmarks,
    33,
    133,
    159,
    145,
    468,
    [469, 470, 471, 472],
    blendshapes?.eyeBlinkRight,
  );

  // Left eye (anatomical left, viewer's right in unmirrored camera): 362 (inner) -> 263 (outer), iris 473
  const leftEye = measureSingleEye(
    faceLandmarks,
    362,
    263,
    386,
    374,
    473,
    [474, 475, 476, 477],
    blendshapes?.eyeBlinkLeft,
  );

  if (!rightEye && !leftEye) {
    return null;
  }

  const headMetrics = computeFaceHeadMetrics(faceLandmarks);

  // Average geometric iris offsets from center (0.5, 0.5)
  let geoX = 0;
  let geoY = 0;
  let eyeCount = 0;
  if (rightEye) {
    geoX += (rightEye.hx - 0.5) * 2.0; // [-1, 1] in image space
    geoY += (rightEye.hy - 0.5) * 2.2;
    eyeCount += 1;
  }
  if (leftEye) {
    geoX += (leftEye.hx - 0.5) * 2.0;
    geoY += (leftEye.hy - 0.5) * 2.2;
    eyeCount += 1;
  }
  geoX /= eyeCount;
  geoY /= eyeCount;

  // In mirrored view, image-space +x flips to screen-space -x
  let fusedX = mirrored ? -geoX : geoX;
  let fusedY = geoY;

  // Fuse MediaPipe neural eyeLook* blendshapes if available (dramatically improves vertical & diagonal accuracy)
  if (blendshapes) {
    // Looking toward user's physical left: left eye looks Out, right eye looks In
    const lookUserLeft =
      (blendshapes.eyeLookOutLeft + blendshapes.eyeLookInRight) * 0.5;
    const lookUserRight =
      (blendshapes.eyeLookInLeft + blendshapes.eyeLookOutRight) * 0.5;
    const lookUp =
      (blendshapes.eyeLookUpLeft + blendshapes.eyeLookUpRight) * 0.5;
    const lookDown =
      (blendshapes.eyeLookDownLeft + blendshapes.eyeLookDownRight) * 0.5;

    // In mirrored view (selfie mirror), user's physical right = screen right (+x)
    const bsXRaw = lookUserRight - lookUserLeft;
    const bsX = mirrored ? bsXRaw : -bsXRaw;
    const bsY = lookDown - lookUp;

    fusedX = fusedX * 0.55 + bsX * 0.45;
    fusedY = fusedY * 0.52 + bsY * 0.48;
  }

  // Head-pose compensation: slight head yaw/pitch naturally steers gaze
  if (headMetrics && settings.headCompensation > 0) {
    const comp = clamp(settings.headCompensation, 0, 1);
    const yawNorm = clamp(headMetrics.headYawDeg / 45, -1, 1);
    const pitchNorm = clamp(headMetrics.headPitchDeg / 35, -1, 1);
    const yawScreen = mirrored ? -yawNorm : yawNorm;
    fusedX += yawScreen * comp * 0.65;
    fusedY += pitchNorm * comp * 0.6;
  }

  const rawGazeX = clamp(fusedX, -1, 1);
  const rawGazeY = clamp(fusedY, -1, 1);

  let screenX: number;
  let screenY: number;
  let calibrated = false;

  if (calibration) {
    screenX = clamp(
      calibration.ax0 + calibration.ax1 * rawGazeX + calibration.ax2 * rawGazeY,
      0.01,
      0.99,
    );
    screenY = clamp(
      calibration.ay0 + calibration.ay1 * rawGazeX + calibration.ay2 * rawGazeY,
      0.01,
      0.99,
    );
    calibrated = true;
  } else {
    const sensX = clamp(settings.sensitivityX, 0.5, 5.0);
    const sensY = clamp(settings.sensitivityY, 0.5, 5.0);
    screenX = clamp(0.5 + rawGazeX * 0.48 * sensX, 0.01, 0.99);
    screenY = clamp(0.5 + rawGazeY * 0.48 * sensY, 0.01, 0.99);
  }

  const isBlinking = Boolean(
    (leftEye?.isBlinking ?? false) && (rightEye?.isBlinking ?? false),
  );

  const avgOpenness =
    ((leftEye?.openness ?? 100) + (rightEye?.openness ?? 100)) * 0.5;
  const confidence = clamp(
    (eyeCount / 2) * (isBlinking ? 0.25 : 0.6 + (avgOpenness / 100) * 0.4),
    0,
    1,
  );

  return {
    rawGazeX: Math.round(rawGazeX * 1000) / 1000,
    rawGazeY: Math.round(rawGazeY * 1000) / 1000,
    screenX: Math.round(screenX * 1000) / 1000,
    screenY: Math.round(screenY * 1000) / 1000,
    zone: classifyGazeZone(screenX, screenY),
    leftEye,
    rightEye,
    isBlinking,
    confidence: Math.round(confidence * 100) / 100,
    calibrated,
    headMetrics,
  };
}

/**
 * 2D One-Euro Gaze Smoother + Blink Freeze + Blink Counter + Fixation & Heatmap Tracker.
 */
export class GazeTrackerState {
  private lastTsMs: number | null = null;
  private xHat = 0.5;
  private yHat = 0.5;
  private dxHat = 0;
  private dyHat = 0;
  private wasBlinking = false;
  private blinkCount = 0;
  private currentZone: GazeZone = "CENTER";
  private zoneStartMs: number | null = null;
  private trail: GazeTrailPoint[] = [];
  public readonly heatmapCols = 12;
  public readonly heatmapRows = 9;
  private heatmap: number[] = new Array<number>(12 * 9).fill(0);

  reset(): void {
    this.lastTsMs = null;
    this.xHat = 0.5;
    this.yHat = 0.5;
    this.dxHat = 0;
    this.dyHat = 0;
    this.wasBlinking = false;
    this.currentZone = "CENTER";
    this.zoneStartMs = null;
    this.trail = [];
  }

  clearHeatmap(): void {
    this.heatmap.fill(0);
    this.trail = [];
  }

  getBlinkCount(): number {
    return this.blinkCount;
  }

  getTrail(): readonly GazeTrailPoint[] {
    return this.trail;
  }

  getHeatmap(): readonly number[] {
    return this.heatmap;
  }

  getFixationSec(nowMs: number): number {
    if (this.zoneStartMs === null || !Number.isFinite(nowMs)) return 0;
    return Math.max(
      0,
      Math.round(((nowMs - this.zoneStartMs) / 1000) * 10) / 10,
    );
  }

  step(
    estimate: GazeEstimate,
    timestampMs: number,
    smoothing: SmoothingConfig,
  ): GazeEstimate {
    // Blink edge detection (count rising edge of blink)
    if (estimate.isBlinking && !this.wasBlinking) {
      this.blinkCount += 1;
    }
    this.wasBlinking = estimate.isBlinking;

    // Blink-freeze: hold previous stable gaze coordinates during blink so eyelid closure doesn't cause downward jump
    if (estimate.isBlinking && this.lastTsMs !== null) {
      return {
        ...estimate,
        screenX: Math.round(this.xHat * 1000) / 1000,
        screenY: Math.round(this.yHat * 1000) / 1000,
        zone: this.currentZone,
      };
    }

    let nextX = estimate.screenX;
    let nextY = estimate.screenY;

    if (smoothing.enabled && this.lastTsMs !== null) {
      const dtSec = (timestampMs - this.lastTsMs) / 1000;
      if (Number.isFinite(dtSec) && dtSec > 0 && dtSec <= 1.0) {
        const s = clamp(smoothing.strength, 0, 1);
        const fMin = 2.8 * Math.pow(0.09, s);
        const beta = 12.0 * (1 - 0.65 * s);
        const alphaD = 1 / (1 + 1 / (2 * Math.PI * 1.0 * dtSec));

        const rawDx = (nextX - this.xHat) / dtSec;
        const rawDy = (nextY - this.yHat) / dtSec;
        this.dxHat = alphaD * rawDx + (1 - alphaD) * this.dxHat;
        this.dyHat = alphaD * rawDy + (1 - alphaD) * this.dyHat;

        const cutoffX = fMin + beta * Math.abs(this.dxHat);
        const cutoffY = fMin + beta * Math.abs(this.dyHat);
        const alphaX = 1 / (1 + 1 / (2 * Math.PI * cutoffX * dtSec));
        const alphaY = 1 / (1 + 1 / (2 * Math.PI * cutoffY * dtSec));

        nextX = alphaX * nextX + (1 - alphaX) * this.xHat;
        nextY = alphaY * nextY + (1 - alphaY) * this.yHat;
      }
    } else {
      this.dxHat = 0;
      this.dyHat = 0;
    }

    this.xHat = clamp(nextX, 0.01, 0.99);
    this.yHat = clamp(nextY, 0.01, 0.99);
    this.lastTsMs = timestampMs;

    const nextZone = classifyGazeZone(this.xHat, this.yHat);
    if (nextZone !== this.currentZone || this.zoneStartMs === null) {
      this.currentZone = nextZone;
      this.zoneStartMs = timestampMs;
    }

    // Update saccade trail (last 28 points)
    this.trail.push({ x: this.xHat, y: this.yHat, timestampMs });
    if (this.trail.length > 28) {
      this.trail.shift();
    }

    // Accumulate gaze heatmap cell
    const col = Math.min(
      this.heatmapCols - 1,
      Math.max(0, Math.floor(this.xHat * this.heatmapCols)),
    );
    const row = Math.min(
      this.heatmapRows - 1,
      Math.max(0, Math.floor(this.yHat * this.heatmapRows)),
    );
    const cellIdx = row * this.heatmapCols + col;
    this.heatmap[cellIdx] = (this.heatmap[cellIdx] ?? 0) + 1;

    return {
      ...estimate,
      screenX: Math.round(this.xHat * 1000) / 1000,
      screenY: Math.round(this.yHat * 1000) / 1000,
      zone: nextZone,
    };
  }
}
