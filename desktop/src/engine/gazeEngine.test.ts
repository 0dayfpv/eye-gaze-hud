import { describe, expect, it } from "vitest";
import {
  CALIBRATION_TARGETS,
  DEFAULT_GAZE_SETTINGS,
  GazeTrackerState,
  classifyGazeZone,
  computeEyeGaze,
  extractEyeBlendshapes,
  fitGazeCalibration,
  type GazeCalibrationSample,
} from "./gazeEngine";
import type { Point3D } from "./types";

function createSyntheticFace(
  irisShiftX = 0,
  irisShiftY = 0,
  eyeOpenScale = 1,
): Point3D[] {
  const face: Point3D[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));

  // Head reference points
  face[1] = { x: 0.5, y: 0.52, z: -0.05 };
  face[10] = { x: 0.5, y: 0.3, z: 0 };
  face[152] = { x: 0.5, y: 0.7, z: 0 };
  face[234] = { x: 0.35, y: 0.5, z: 0 };
  face[454] = { x: 0.65, y: 0.5, z: 0 };

  // Right eye (33 outer -> 133 inner), center = (0.43, 0.45), width = 0.06
  face[33] = { x: 0.4, y: 0.45, z: 0 };
  face[133] = { x: 0.46, y: 0.45, z: 0 };
  face[159] = { x: 0.43, y: 0.45 - 0.012 * eyeOpenScale, z: 0 };
  face[145] = { x: 0.43, y: 0.45 + 0.012 * eyeOpenScale, z: 0 };
  face[468] = { x: 0.43 + irisShiftX, y: 0.45 + irisShiftY, z: -0.01 };
  face[469] = { x: 0.43 + irisShiftX + 0.01, y: 0.45 + irisShiftY, z: -0.01 };
  face[470] = { x: 0.43 + irisShiftX, y: 0.45 + irisShiftY - 0.01, z: -0.01 };
  face[471] = { x: 0.43 + irisShiftX - 0.01, y: 0.45 + irisShiftY, z: -0.01 };
  face[472] = { x: 0.43 + irisShiftX, y: 0.45 + irisShiftY + 0.01, z: -0.01 };

  // Left eye (362 inner -> 263 outer), center = (0.57, 0.45), width = 0.06
  face[362] = { x: 0.54, y: 0.45, z: 0 };
  face[263] = { x: 0.6, y: 0.45, z: 0 };
  face[386] = { x: 0.57, y: 0.45 - 0.012 * eyeOpenScale, z: 0 };
  face[374] = { x: 0.57, y: 0.45 + 0.012 * eyeOpenScale, z: 0 };
  face[473] = { x: 0.57 + irisShiftX, y: 0.45 + irisShiftY, z: -0.01 };
  face[474] = { x: 0.57 + irisShiftX + 0.01, y: 0.45 + irisShiftY, z: -0.01 };
  face[475] = { x: 0.57 + irisShiftX, y: 0.45 + irisShiftY - 0.01, z: -0.01 };
  face[476] = { x: 0.57 + irisShiftX - 0.01, y: 0.45 + irisShiftY, z: -0.01 };
  face[477] = { x: 0.57 + irisShiftX, y: 0.45 + irisShiftY + 0.01, z: -0.01 };

  return face;
}

describe("V2.1 Eye Gaze & Pupil Tracking Engine", () => {
  it("classifies all 9 gaze zones accurately", () => {
    expect(classifyGazeZone(0.5, 0.5)).toBe("CENTER");
    expect(classifyGazeZone(0.15, 0.5)).toBe("LEFT");
    expect(classifyGazeZone(0.85, 0.5)).toBe("RIGHT");
    expect(classifyGazeZone(0.5, 0.15)).toBe("UP");
    expect(classifyGazeZone(0.5, 0.85)).toBe("DOWN");
    expect(classifyGazeZone(0.15, 0.15)).toBe("UP-LEFT");
    expect(classifyGazeZone(0.85, 0.15)).toBe("UP-RIGHT");
    expect(classifyGazeZone(0.15, 0.85)).toBe("DOWN-LEFT");
    expect(classifyGazeZone(0.85, 0.85)).toBe("DOWN-RIGHT");
  });

  it("estimates centered gaze when irises sit at eye centers and shifts smoothly with pupil movement", () => {
    const centeredFace = createSyntheticFace(0, 0);
    const centerEst = computeEyeGaze({
      faceLandmarks: centeredFace,
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
    });

    expect(centerEst).not.toBeNull();
    expect(centerEst?.zone).toBe("CENTER");
    expect(centerEst?.screenX).toBeCloseTo(0.5, 1);
    expect(centerEst?.screenY).toBeCloseTo(0.5, 1);

    // Shift irises toward -x in camera space -> in mirrored view that is looking RIGHT (+screenX)
    const rightFace = createSyntheticFace(-0.018, 0);
    const rightEst = computeEyeGaze({
      faceLandmarks: rightFace,
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
    });
    expect(rightEst?.screenX).toBeGreaterThan(0.7);
    expect(rightEst?.zone).toBe("RIGHT");

    // In unmirrored view, -x iris shift projects to LEFT (< 0.3)
    const unmirroredEst = computeEyeGaze({
      faceLandmarks: rightFace,
      mirrored: false,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
    });
    expect(unmirroredEst?.screenX).toBeLessThan(0.3);
    expect(unmirroredEst?.zone).toBe("LEFT");

    // Shift irises upward (-y) -> UP
    const upFace = createSyntheticFace(0, -0.01);
    const upEst = computeEyeGaze({
      faceLandmarks: upFace,
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
    });
    expect(upEst?.screenY).toBeLessThan(0.3);
    expect(upEst?.zone).toBe("UP");

    // Head-pose compensation steers gaze toward head yaw direction
    const yawedFace = createSyntheticFace(0, 0);
    yawedFace[1] = { x: 0.42, y: 0.52, z: -0.05 }; // nose shifted -x -> negative yaw -> mirrored +x
    const headAssistEst = computeEyeGaze({
      faceLandmarks: yawedFace,
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0.8 },
    });
    expect(headAssistEst?.rawGazeX).toBeGreaterThan(0.2);
  });

  it("extracts eye blendshapes and detects blinks", () => {
    expect(extractEyeBlendshapes(null)).toBeNull();
    expect(extractEyeBlendshapes([{ categoryName: "jawOpen", score: 0.5 }])).toBeNull();

    const bs = extractEyeBlendshapes([
      { categoryName: "eyeLookInLeft", score: 0.7 },
      { categoryName: "eyeLookOutRight", score: 0.75 },
      { categoryName: "eyeBlinkLeft", score: 0.85 },
      { categoryName: "eyeBlinkRight", score: 0.82 },
    ]);
    expect(bs).not.toBeNull();
    expect(bs?.eyeBlinkLeft).toBe(0.85);

    const blinkingEst = computeEyeGaze({
      faceLandmarks: createSyntheticFace(0, 0, 0.2),
      blendshapes: bs,
      mirrored: true,
    });
    expect(blinkingEst?.isBlinking).toBe(true);
  });

  it("fits a 5-point affine calibration accurately and rejects insufficient/non-finite samples", () => {
    expect(CALIBRATION_TARGETS).toHaveLength(5);
    expect(
      fitGazeCalibration([
        { targetX: 0.5, targetY: 0.5, rawGazeX: 0, rawGazeY: 0 },
        { targetX: 0.2, targetY: 0.2, rawGazeX: -0.3, rawGazeY: -0.3 },
      ]),
    ).toBeNull();

    expect(
      fitGazeCalibration([
        { targetX: 0.5, targetY: 0.5, rawGazeX: Number.NaN, rawGazeY: 0 },
        { targetX: 0.2, targetY: 0.2, rawGazeX: -0.3, rawGazeY: -0.3 },
        { targetX: 0.8, targetY: 0.8, rawGazeX: 0.3, rawGazeY: 0.3 },
      ]),
    ).toBeNull();

    const samples: GazeCalibrationSample[] = [
      { targetX: 0.5, targetY: 0.5, rawGazeX: 0.05, rawGazeY: -0.05 },
      { targetX: 0.14, targetY: 0.16, rawGazeX: -0.35, rawGazeY: -0.45 },
      { targetX: 0.86, targetY: 0.16, rawGazeX: 0.45, rawGazeY: -0.45 },
      { targetX: 0.86, targetY: 0.84, rawGazeX: 0.45, rawGazeY: 0.35 },
      { targetX: 0.14, targetY: 0.84, rawGazeX: -0.35, rawGazeY: 0.35 },
    ];
    const cal = fitGazeCalibration(samples);
    expect(cal).not.toBeNull();
    expect(cal?.sampleCount).toBe(5);

    const predCenterX = cal!.ax0 + cal!.ax1 * 0.05 + cal!.ax2 * -0.05;
    const predCenterY = cal!.ay0 + cal!.ay1 * 0.05 + cal!.ay2 * -0.05;
    expect(predCenterX).toBeCloseTo(0.5, 2);
    expect(predCenterY).toBeCloseTo(0.5, 2);

    const calEst = computeEyeGaze({
      faceLandmarks: createSyntheticFace(0, 0),
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
      calibration: cal,
    });
    expect(calEst?.calibrated).toBe(true);
  });

  it("freezes gaze during blinks, counts blinks, preserves blinkCount on reset(), clears heatmap, and tracks fixation", () => {
    const tracker = new GazeTrackerState();
    expect(tracker.getHeatmap()).toHaveLength(108);
    expect(tracker.getFixationSec(1000)).toBe(0);

    const openEst = computeEyeGaze({
      faceLandmarks: createSyntheticFace(-0.015, 0),
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
    })!;

    const s1 = tracker.step(openEst, 1000, { enabled: true, strength: 0.5 });
    expect(tracker.getBlinkCount()).toBe(0);
    expect(tracker.getTrail().length).toBe(1);
    expect(tracker.getHeatmap().reduce((a, b) => a + b, 0)).toBe(1);

    const s1b = tracker.step(openEst, 2500, { enabled: true, strength: 0.5 });
    expect(s1b.zone).toBe(s1.zone);
    expect(tracker.getFixationSec(2500)).toBeCloseTo(1.5, 1);

    const blinkEst = computeEyeGaze({
      faceLandmarks: createSyntheticFace(0.015, 0.015, 0.1),
      mirrored: true,
      settings: { ...DEFAULT_GAZE_SETTINGS, headCompensation: 0 },
    })!;
    expect(blinkEst.isBlinking).toBe(true);

    const s2 = tracker.step(blinkEst, 2533, { enabled: true, strength: 0.5 });
    expect(tracker.getBlinkCount()).toBe(1);
    expect(s2.screenX).toBeCloseTo(s1b.screenX, 2);
    expect(s2.screenY).toBeCloseTo(s1b.screenY, 2);

    // Sustained blink does not double-count until rising edge resets
    tracker.step(blinkEst, 2566, { enabled: true, strength: 0.5 });
    expect(tracker.getBlinkCount()).toBe(1);

    // reset() preserves blinkCount and heatmap while clearing trail and fixation
    tracker.reset();
    expect(tracker.getBlinkCount()).toBe(1);
    expect(tracker.getTrail()).toHaveLength(0);
    expect(tracker.getFixationSec(3000)).toBe(0);
    expect(tracker.getHeatmap().reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    tracker.clearHeatmap();
    expect(tracker.getHeatmap()).toHaveLength(108);
    expect(tracker.getHeatmap().every((v) => v === 0)).toBe(true);
    expect(tracker.getTrail()).toHaveLength(0);
  });
});
