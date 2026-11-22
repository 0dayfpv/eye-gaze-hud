import type {
  FaceHeadMetrics,
  Point3D,
  SmoothingConfig,
} from "./types";

export type {
  AppStatus,
  DelegateType,
  FaceHeadMetrics,
  Point3D,
  SmoothingConfig,
  ViewMode,
} from "./types";

function isFinitePoint(p: Point3D | undefined | null): p is Point3D {
  return (
    Boolean(p) &&
    Number.isFinite(p!.x) &&
    Number.isFinite(p!.y) &&
    Number.isFinite(p!.z)
  );
}

function clonePoint(lm: Point3D): Point3D {
  return {
    x: lm.x,
    y: lm.y,
    z: lm.z,
    ...(lm.visibility !== undefined ? { visibility: lm.visibility } : {}),
    ...(lm.presence !== undefined ? { presence: lm.presence } : {}),
  };
}

function distance3D(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Computes 3D head orientation (Roll, Yaw, Pitch) and eye/mouth openness
 * percentages from MediaPipe FaceLandmarker's 478 landmarks.
 */
export function computeFaceHeadMetrics(
  faceLandmarks: readonly Point3D[] | null,
): FaceHeadMetrics | null {
  if (!faceLandmarks || faceLandmarks.length < 468) {
    return null;
  }

  const noseTip = faceLandmarks[1];
  const forehead = faceLandmarks[10];
  const chin = faceLandmarks[152];
  const leftCheek = faceLandmarks[234];
  const rightCheek = faceLandmarks[454];
  const rightEyeOuter = faceLandmarks[33];
  const rightEyeInner = faceLandmarks[133];
  const rightEyeTop = faceLandmarks[159];
  const rightEyeBottom = faceLandmarks[145];
  const leftEyeOuter = faceLandmarks[263];
  const leftEyeInner = faceLandmarks[362];
  const leftEyeTop = faceLandmarks[386];
  const leftEyeBottom = faceLandmarks[374];
  const upperLip = faceLandmarks[13];
  const lowerLip = faceLandmarks[14];
  const mouthLeft = faceLandmarks[61];
  const mouthRight = faceLandmarks[291];

  if (
    !isFinitePoint(noseTip) ||
    !isFinitePoint(forehead) ||
    !isFinitePoint(chin) ||
    !isFinitePoint(leftCheek) ||
    !isFinitePoint(rightCheek) ||
    !isFinitePoint(rightEyeOuter) ||
    !isFinitePoint(leftEyeOuter)
  ) {
    return null;
  }

  // Head Roll (tilt): angle of the inter-ocular line (33 -> 263)
  const eyeDx = leftEyeOuter.x - rightEyeOuter.x;
  const eyeDy = leftEyeOuter.y - rightEyeOuter.y;
  const rawRoll =
    (Math.atan2(eyeDy, Math.max(1e-6, Math.abs(eyeDx))) * 180) / Math.PI;
  const headRollDeg =
    Math.round(Math.max(-90, Math.min(90, rawRoll)) * 10) / 10;

  // Head Yaw (left/right turn): horizontal asymmetry of nose tip between cheeks
  const faceWidth = Math.max(1e-5, distance3D(leftCheek, rightCheek));
  const midCheekX = (leftCheek.x + rightCheek.x) * 0.5;
  const rawYaw = ((noseTip.x - midCheekX) / (faceWidth * 0.5)) * 45;
  const headYawDeg = Math.round(Math.max(-75, Math.min(75, rawYaw)) * 10) / 10;

  // Head Pitch (nod up/down): vertical position of nose tip relative to forehead-chin midpoint
  const faceHeight = Math.max(1e-5, distance3D(forehead, chin));
  const midFaceY = (forehead.y + chin.y) * 0.5;
  const rawPitch = ((noseTip.y - midFaceY) / (faceHeight * 0.5) - 0.12) * 60;
  const headPitchDeg =
    Math.round(Math.max(-60, Math.min(60, rawPitch)) * 10) / 10;

  // Eye Aspect Ratio (EAR) -> Openness [0..100%]
  let rightEyeOpenness = 100;
  if (
    isFinitePoint(rightEyeInner) &&
    isFinitePoint(rightEyeTop) &&
    isFinitePoint(rightEyeBottom)
  ) {
    const horiz = Math.max(1e-5, distance3D(rightEyeOuter, rightEyeInner));
    const vert = distance3D(rightEyeTop, rightEyeBottom);
    const ear = vert / horiz;
    rightEyeOpenness = Math.round(
      Math.max(0, Math.min(100, ((ear - 0.08) / 0.24) * 100)),
    );
  }

  let leftEyeOpenness = 100;
  if (
    isFinitePoint(leftEyeInner) &&
    isFinitePoint(leftEyeTop) &&
    isFinitePoint(leftEyeBottom)
  ) {
    const horiz = Math.max(1e-5, distance3D(leftEyeOuter, leftEyeInner));
    const vert = distance3D(leftEyeTop, leftEyeBottom);
    const ear = vert / horiz;
    leftEyeOpenness = Math.round(
      Math.max(0, Math.min(100, ((ear - 0.08) / 0.24) * 100)),
    );
  }

  let mouthOpenness = 0;
  if (
    isFinitePoint(upperLip) &&
    isFinitePoint(lowerLip) &&
    isFinitePoint(mouthLeft) &&
    isFinitePoint(mouthRight)
  ) {
    const mouthW = Math.max(1e-5, distance3D(mouthLeft, mouthRight));
    const mouthH = distance3D(upperLip, lowerLip);
    const mar = mouthH / mouthW;
    mouthOpenness = Math.round(
      Math.max(0, Math.min(100, ((mar - 0.02) / 0.55) * 100)),
    );
  }

  return {
    headRollDeg: headRollDeg === 0 ? 0 : headRollDeg,
    headYawDeg: headYawDeg === 0 ? 0 : headYawDeg,
    headPitchDeg: headPitchDeg === 0 ? 0 : headPitchDeg,
    leftEyeOpenness,
    rightEyeOpenness,
    mouthOpenness,
  };
}

interface LandmarkFilterState {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

function alphaFor(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

function stepAxis(
  rawVal: number,
  prevVal: number,
  prevDeriv: number,
  dtSec: number,
  alphaD: number,
  fMin: number,
  beta: number,
): { value: number; deriv: number } {
  if (!Number.isFinite(rawVal)) {
    return { value: prevVal, deriv: prevDeriv };
  }
  const rawDeriv = (rawVal - prevVal) / dtSec;
  const dHat = alphaD * rawDeriv + (1 - alphaD) * prevDeriv;
  const cutoff = fMin + beta * Math.abs(dHat);
  const alpha = alphaFor(cutoff, dtSec);
  const xHat = alpha * rawVal + (1 - alpha) * prevVal;
  return { value: xHat, deriv: dHat };
}

export class PoseSmoother {
  private lastTimestampMs: number | null = null;
  private states: Map<number, LandmarkFilterState> = new Map();

  reset(): void {
    this.states.clear();
    this.lastTimestampMs = null;
  }

  filter(
    landmarks: readonly Point3D[],
    timestampMs: number,
    config: SmoothingConfig,
  ): Point3D[] {
    if (!config.enabled) {
      this.reset();
      return landmarks.map(clonePoint);
    }

    const s = Number.isFinite(config.strength)
      ? Math.max(0, Math.min(1, config.strength))
      : 0.5;
    const fMin = 4.0 * Math.pow(0.08, s);
    const beta = 10.0 * (1 - 0.7 * s);
    const dCutoff = 0.8;

    const dtSec =
      this.lastTimestampMs === null
        ? Number.NaN
        : (timestampMs - this.lastTimestampMs) / 1000;

    if (
      this.lastTimestampMs === null ||
      !Number.isFinite(dtSec) ||
      dtSec <= 0 ||
      dtSec > 1.0
    ) {
      this.states.clear();
      this.lastTimestampMs = Number.isFinite(timestampMs) ? timestampMs : null;

      return landmarks.map((lm, i) => {
        if (isFinitePoint(lm)) {
          this.states.set(i, {
            x: lm.x,
            y: lm.y,
            z: lm.z,
            dx: 0,
            dy: 0,
            dz: 0,
          });
        }
        return clonePoint(lm);
      });
    }

    this.lastTimestampMs = timestampMs;
    const alphaD = alphaFor(dCutoff, dtSec);

    return landmarks.map((lm, i) => {
      const prev = this.states.get(i);
      if (!prev) {
        if (isFinitePoint(lm)) {
          this.states.set(i, {
            x: lm.x,
            y: lm.y,
            z: lm.z,
            dx: 0,
            dy: 0,
            dz: 0,
          });
        }
        return clonePoint(lm);
      }

      const nextX = stepAxis(lm.x, prev.x, prev.dx, dtSec, alphaD, fMin, beta);
      const nextY = stepAxis(lm.y, prev.y, prev.dy, dtSec, alphaD, fMin, beta);
      const nextZ = stepAxis(lm.z, prev.z, prev.dz, dtSec, alphaD, fMin, beta);

      this.states.set(i, {
        x: nextX.value,
        y: nextY.value,
        z: nextZ.value,
        dx: nextX.deriv,
        dy: nextY.deriv,
        dz: nextZ.deriv,
      });

      return {
        x: nextX.value,
        y: nextY.value,
        z: nextZ.value,
        ...(lm.visibility !== undefined ? { visibility: lm.visibility } : {}),
        ...(lm.presence !== undefined ? { presence: lm.presence } : {}),
      };
    });
  }
}
