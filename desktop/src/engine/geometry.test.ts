import { describe, expect, it } from "vitest";
import {
  FACE_LANDMARKS_FACE_OVAL,
  FACE_LANDMARKS_LEFT_EYE,
  FACE_LANDMARKS_LEFT_EYEBROW,
  FACE_LANDMARKS_LEFT_IRIS,
  FACE_LANDMARKS_RIGHT_EYE,
  FACE_LANDMARKS_RIGHT_EYEBROW,
  FACE_LANDMARKS_RIGHT_IRIS,
  FACE_LANDMARKS_TESSELATION,
} from "./faceConnections";
import {
  PoseSmoother,
  computeFaceHeadMetrics,
  type Point3D,
  type SmoothingConfig,
} from "./geometry";

function createNeutralLandmarks(visibility = 0.95): Point3D[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: 0.5 + (i % 5) * 0.02,
    y: 0.1 + Math.floor(i / 5) * 0.08,
    z: 0,
    visibility,
  }));
}

function createNeutralFace478(): Point3D[] {
  const face: Point3D[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  face[1] = { x: 0.5, y: 0.52, z: -0.05 }; // noseTip
  face[10] = { x: 0.5, y: 0.3, z: 0 }; // forehead
  face[152] = { x: 0.5, y: 0.7, z: 0 }; // chin
  face[234] = { x: 0.35, y: 0.5, z: 0 }; // leftCheek
  face[454] = { x: 0.65, y: 0.5, z: 0 }; // rightCheek
  face[33] = { x: 0.4, y: 0.45, z: 0 }; // rightEyeOuter
  face[133] = { x: 0.46, y: 0.45, z: 0 }; // rightEyeInner
  face[159] = { x: 0.43, y: 0.435, z: 0 }; // rightEyeTop
  face[145] = { x: 0.43, y: 0.465, z: 0 }; // rightEyeBottom
  face[263] = { x: 0.6, y: 0.45, z: 0 }; // leftEyeOuter
  face[362] = { x: 0.54, y: 0.45, z: 0 }; // leftEyeInner
  face[386] = { x: 0.57, y: 0.435, z: 0 }; // leftEyeTop
  face[374] = { x: 0.57, y: 0.465, z: 0 }; // leftEyeBottom
  face[13] = { x: 0.5, y: 0.6, z: 0 }; // upperLip
  face[14] = { x: 0.5, y: 0.62, z: 0 }; // lowerLip
  face[61] = { x: 0.45, y: 0.61, z: 0 }; // mouthLeft
  face[291] = { x: 0.55, y: 0.61, z: 0 }; // mouthRight
  return face;
}

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function variance(values: readonly number[]): number {
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

function rmse(actual: readonly number[], truth: readonly number[]): number {
  const mse = mean(actual.map((v, i) => (v - truth[i]!) ** 2));
  return Math.sqrt(mse);
}

function diffs(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i]! - values[i - 1]!);
  }
  return out;
}

describe("PoseSmoother", () => {
  it("preserves raw coordinates bit-for-bit when disabled even with prior filter state", () => {
    const smoother = new PoseSmoother();
    const enabledCfg: SmoothingConfig = { enabled: true, strength: 0.9 };
    for (let i = 0; i < 5; i++) {
      const frame = createNeutralLandmarks(0.8);
      frame[0] = { x: 0.2 + i * 0.01, y: 0.3, z: -0.1, visibility: 0.8 };
      smoother.filter(frame, i * 33, enabledCfg);
    }

    const raw = createNeutralLandmarks(0.85);
    raw[0] = {
      x: 0.1234567890123456,
      y: -0.9876543210987654,
      z: 0.000123456789,
      visibility: 0.73,
    };

    const out = smoother.filter(raw, 200, { enabled: false, strength: 0.9 });
    expect(out).toEqual(raw);
    expect(out[0]).not.toBe(raw[0]);
    expect(out[0]?.x).toBe(raw[0].x);
    expect(out[0]?.y).toBe(raw[0].y);
    expect(out[0]?.z).toBe(raw[0].z);
    expect(out[0]?.visibility).toBe(raw[0].visibility);
  });

  it("measurably reduces variance and RMSE on constant + deterministic jitter streams", () => {
    const smoother = new PoseSmoother();
    const cfg: SmoothingConfig = { enabled: true, strength: 0.6 };
    const dt = 1000 / 30;
    const rawX: number[] = [];
    const rawY: number[] = [];
    const rawZ: number[] = [];
    const smoothX: number[] = [];
    const smoothY: number[] = [];
    const smoothZ: number[] = [];

    for (let i = 0; i < 60; i++) {
      const jx = 0.04 * (i % 2 === 0 ? 1 : -1) + 0.015 * Math.sin(i * 2.3);
      const jy = 0.03 * (i % 2 === 0 ? -1 : 1) + 0.012 * Math.cos(i * 1.7);
      const jz = 0.025 * Math.sin(i * 2.7);
      const frame = createNeutralLandmarks(0.95);
      frame[0] = {
        x: 0.5 + jx,
        y: 0.4 + jy,
        z: -0.1 + jz,
        visibility: 0.95,
      };
      const out = smoother.filter(frame, i * dt, cfg);

      if (i >= 5) {
        rawX.push(frame[0].x);
        rawY.push(frame[0].y);
        rawZ.push(frame[0].z);
        smoothX.push(out[0]!.x);
        smoothY.push(out[0]!.y);
        smoothZ.push(out[0]!.z);
      }
    }

    const truthX = rawX.map(() => 0.5);
    expect(variance(smoothX)).toBeLessThan(variance(rawX) * 0.5);
    expect(variance(smoothY)).toBeLessThan(variance(rawY) * 0.5);
    expect(variance(smoothZ)).toBeLessThan(variance(rawZ) * 0.5);
    expect(rmse(smoothX, truthX)).toBeLessThan(rmse(rawX, truthX));
  });

  it("measurably reduces RMSE and frame-to-frame jitter on a moving sine wave", () => {
    const smoother = new PoseSmoother();
    const cfg: SmoothingConfig = { enabled: true, strength: 0.5 };
    const dt = 1000 / 30;
    const truthX: number[] = [];
    const rawX: number[] = [];
    const smoothX: number[] = [];

    for (let i = 0; i < 90; i++) {
      const tMs = i * dt;
      const tSec = tMs / 1000;
      const tx = 0.5 + 0.2 * Math.sin(2 * Math.PI * 0.5 * tSec);
      const rx =
        tx + 0.03 * ((i % 2 === 0 ? 1 : -1) * 0.7 + Math.cos(i * 1.9) * 0.3);
      const frame = createNeutralLandmarks(0.9);
      frame[0] = { x: rx, y: 0.5, z: 0, visibility: 0.9 };
      const out = smoother.filter(frame, tMs, cfg);

      if (i >= 10) {
        truthX.push(tx);
        rawX.push(rx);
        smoothX.push(out[0]!.x);
      }
    }

    expect(rmse(smoothX, truthX)).toBeLessThan(rmse(rawX, truthX));
    expect(variance(diffs(smoothX))).toBeLessThan(variance(diffs(rawX)) * 0.5);
  });

  it("applies stronger smoothing at higher strength and passes visibility through raw", () => {
    const lowSmoother = new PoseSmoother();
    const highSmoother = new PoseSmoother();
    const dt = 1000 / 30;
    const rawX: number[] = [];
    const lowX: number[] = [];
    const highX: number[] = [];

    for (let i = 0; i < 60; i++) {
      const jx = 0.04 * (i % 2 === 0 ? 1 : -1) + 0.015 * Math.sin(i * 2.3);
      const frame = createNeutralLandmarks(0.67);
      frame[0] = { x: 0.5 + jx, y: 0.5, z: 0, visibility: 0.67 };
      const outLow = lowSmoother.filter(frame, i * dt, {
        enabled: true,
        strength: 0.1,
      });
      const outHigh = highSmoother.filter(frame, i * dt, {
        enabled: true,
        strength: 0.9,
      });

      expect(outLow[0]?.visibility).toBe(0.67);
      expect(outHigh[0]?.visibility).toBe(0.67);

      if (i >= 5) {
        rawX.push(frame[0].x);
        lowX.push(outLow[0]!.x);
        highX.push(outHigh[0]!.x);
      }
    }

    expect(variance(lowX)).toBeLessThan(variance(rawX));
    expect(variance(highX)).toBeLessThan(variance(lowX));
  });

  it("clears prior filter history on reset() and handles non-positive or large dt safely", () => {
    const smoother = new PoseSmoother();
    const cfg: SmoothingConfig = { enabled: true, strength: 0.8 };

    for (let i = 0; i < 10; i++) {
      const frame = createNeutralLandmarks(0.9);
      frame[0] = { x: 0.1, y: 0.1, z: 0, visibility: 0.9 };
      smoother.filter(frame, i * 33.3, cfg);
    }

    const stepFrame = createNeutralLandmarks(0.9);
    stepFrame[0] = { x: 0.9, y: 0.9, z: 0, visibility: 0.9 };
    const damped = smoother.filter(stepFrame, 333, cfg);
    expect(damped[0]?.x).toBeLessThan(0.85);

    smoother.reset();
    const afterReset = smoother.filter(stepFrame, 366, cfg);
    expect(afterReset[0]?.x).toBeCloseTo(0.9, 10);

    const dup = smoother.filter(stepFrame, 366, cfg);
    expect(Number.isFinite(dup[0]?.x)).toBe(true);

    const largeGap = smoother.filter(stepFrame, 5000, cfg);
    expect(Number.isFinite(largeGap[0]?.x)).toBe(true);
    expect(largeGap[0]?.x).toBeCloseTo(0.9, 10);
  });
});

describe("computeFaceHeadMetrics", () => {
  it("computes 3D head orientation (Yaw, Pitch, Roll) and eye/mouth openness from 478 face landmarks", () => {
    expect(computeFaceHeadMetrics(null)).toBeNull();
    expect(computeFaceHeadMetrics([{ x: 0, y: 0, z: 0 }])).toBeNull();

    const face = createNeutralFace478();
    const head = computeFaceHeadMetrics(face);
    expect(head).not.toBeNull();
    expect(head?.headRollDeg).toBe(0);
    expect(head?.headYawDeg).toBe(0);
    expect(head?.leftEyeOpenness).toBeGreaterThan(50);
    expect(head?.rightEyeOpenness).toBeGreaterThan(50);
  });

  it("detects tilted roll, turned yaw, nodded pitch, closed eyes, open mouth, and rejects non-finite points", () => {
    const rolled = createNeutralFace478();
    rolled[33] = { x: 0.4, y: 0.42, z: 0 };
    rolled[263] = { x: 0.6, y: 0.48, z: 0 };
    const rollMetrics = computeFaceHeadMetrics(rolled);
    expect(rollMetrics).not.toBeNull();
    expect(rollMetrics!.headRollDeg).toBeGreaterThan(10);

    const yawed = createNeutralFace478();
    yawed[1] = { x: 0.56, y: 0.52, z: -0.05 };
    const yawMetrics = computeFaceHeadMetrics(yawed);
    expect(yawMetrics!.headYawDeg).toBeGreaterThan(10);

    const nodded = createNeutralFace478();
    nodded[1] = { x: 0.5, y: 0.59, z: -0.05 };
    const pitchMetrics = computeFaceHeadMetrics(nodded);
    expect(pitchMetrics!.headPitchDeg).toBeGreaterThan(5);

    const closedAndOpenMouth = createNeutralFace478();
    closedAndOpenMouth[159] = { x: 0.43, y: 0.45, z: 0 };
    closedAndOpenMouth[145] = { x: 0.43, y: 0.45, z: 0 };
    closedAndOpenMouth[386] = { x: 0.57, y: 0.45, z: 0 };
    closedAndOpenMouth[374] = { x: 0.57, y: 0.45, z: 0 };
    closedAndOpenMouth[13] = { x: 0.5, y: 0.58, z: 0 };
    closedAndOpenMouth[14] = { x: 0.5, y: 0.64, z: 0 };
    const closedMetrics = computeFaceHeadMetrics(closedAndOpenMouth);
    expect(closedMetrics!.leftEyeOpenness).toBe(0);
    expect(closedMetrics!.rightEyeOpenness).toBe(0);
    expect(closedMetrics!.mouthOpenness).toBeGreaterThan(80);

    const nonFinite = createNeutralFace478();
    nonFinite[1] = { x: Number.NaN, y: 0.5, z: 0 };
    expect(computeFaceHeadMetrics(nonFinite)).toBeNull();
  });
});

describe("faceConnections static edge lists", () => {
  it("matches exact MediaPipe FaceLandmarker connection counts and valid 0..477 indices", () => {
    expect(FACE_LANDMARKS_TESSELATION).toHaveLength(2556);
    expect(FACE_LANDMARKS_FACE_OVAL).toHaveLength(36);
    expect(FACE_LANDMARKS_LEFT_EYE).toHaveLength(16);
    expect(FACE_LANDMARKS_RIGHT_EYE).toHaveLength(16);
    expect(FACE_LANDMARKS_LEFT_EYEBROW).toHaveLength(8);
    expect(FACE_LANDMARKS_RIGHT_EYEBROW).toHaveLength(8);
    expect(FACE_LANDMARKS_LEFT_IRIS).toHaveLength(4);
    expect(FACE_LANDMARKS_RIGHT_IRIS).toHaveLength(4);

    const allLists = [
      FACE_LANDMARKS_TESSELATION,
      FACE_LANDMARKS_FACE_OVAL,
      FACE_LANDMARKS_LEFT_EYE,
      FACE_LANDMARKS_RIGHT_EYE,
      FACE_LANDMARKS_LEFT_EYEBROW,
      FACE_LANDMARKS_RIGHT_EYEBROW,
      FACE_LANDMARKS_LEFT_IRIS,
      FACE_LANDMARKS_RIGHT_IRIS,
    ];

    for (const list of allLists) {
      for (const edge of list) {
        expect(Number.isInteger(edge.start)).toBe(true);
        expect(Number.isInteger(edge.end)).toBe(true);
        expect(edge.start).toBeGreaterThanOrEqual(0);
        expect(edge.start).toBeLessThanOrEqual(477);
        expect(edge.end).toBeGreaterThanOrEqual(0);
        expect(edge.end).toBeLessThanOrEqual(477);
      }
    }
  });
});
