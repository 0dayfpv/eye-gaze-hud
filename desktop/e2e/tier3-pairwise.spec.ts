import { expect, test } from "@playwright/test";
import {
  attachErrorCollectors,
  bootHudSession,
  completeCalibration,
  measureCanvasActivity,
  readBiometricTile,
  readGazeCoordPercent,
  sampleCanvasRegion,
  setRangeValue,
  triggerExportSnapshot,
  waitForDelegate,
} from "./fixtures/hudHelpers";
import {
  makeBlinkFrame,
  makeCalibrationTargetGaze,
  makeCenterGaze,
  makeHeadPoseFrame,
  makeNoFaceFrame,
  makeSyntheticFace,
  makeZoneGaze,
  type GazeZone,
} from "./fixtures/syntheticFace";

test.describe("Tier 3: Cross-Feature Pairwise Interactions (T3-01..T3-36)", () => {
  test("T3-01 Calibration x Mirror Mode: calibrated gaze flips consistently without NaN when Mirror toggles OFF", async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");
      server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
      const mirroredRight = await readGazeCoordPercent(page);

      await page.getByTestId("mirror-toggle").click();
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
      const unmirrored = await readGazeCoordPercent(page);
      expect(mirroredRight!.x).toBeGreaterThan(70);
      expect(unmirrored!.x).toBeLessThan(30);
      expect(errors.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  test("T3-02 Calibration x Blackout: 5-point calibration completes over Blackout tactical grid", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("mode-blackout").click();
      await completeCalibration(page, server, "space");
      await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
      await expect(page.getByTestId("mode-blackout")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      await close();
    }
  });

  test("T3-03 Calibration x Blink Counter: blinks mid-calibration increment counter while skipped by buffer", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("start-calibration-button").click();
      server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
      await page.getByTestId("calibration-target-button").click();
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        "(2/5)",
      );

      // Inject blink during step 2 capture -> blinkCount increments while step 2 waits for open eyes
      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
      await page.getByTestId("calibration-target-button").click();
      await page.waitForTimeout(200);
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        "(2/5)",
      );

      server.setStreamGenerator(() => makeCalibrationTargetGaze(1));
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        "(3/5)",
      );
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
    } finally {
      await close();
    }
  });

  test("T3-04 Calibration x Heatmap & Trail: completing 5-point calibration auto-clears prior heatmap and trail", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await server.pumpFrames(15, () => makeZoneGaze("UP-LEFT"), 15);
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-LEFT");
      await completeCalibration(page, server, "click");
      server.stopStream();
      const { payload } = await triggerExportSnapshot(page);
      expect(payload.trail.length).toBeLessThanOrEqual(5);
      expect(payload.calibrated).toBe(true);
    } finally {
      await close();
    }
  });

  test("T3-05 Calibration x Sensitivity Sliders: affine fit ignores sensX/Y until Reset reverts to MANUAL", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");
      server.setStreamGenerator(() => makeSyntheticFace({ dirX: 0.5, dirY: 0 }));
      await page.waitForTimeout(220);
      const calCoord = await readGazeCoordPercent(page);

      await setRangeValue(page, "gaze-sensitivity-x", 4.0);
      await page.waitForTimeout(200);
      const stillCal = await readGazeCoordPercent(page);
      expect(
        Math.abs((stillCal?.x ?? 0) - (calCoord?.x ?? 0)),
      ).toBeLessThanOrEqual(3);

      await page.getByTestId("reset-calibration-button").click();
      await expect
        .poll(async () => (await readGazeCoordPercent(page))?.x ?? 0)
        .toBeGreaterThan(85);
    } finally {
      await close();
    }
  });

  test("T3-06 Calibration x Head-Pose Assist: calibrated projection incorporates head yaw offset", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");
      await setRangeValue(page, "gaze-head-comp", 0.8);
      server.setStreamGenerator(() => makeHeadPoseFrame(-25, 0, 0));
      await expect
        .poll(async () => (await readGazeCoordPercent(page))?.x ?? 50)
        .toBeGreaterThan(68);
    } finally {
      await close();
    }
  });

  test("T3-07 Calibration x JSON Export: Calibrate -> Export -> Reset -> Export schema transition", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");
      const calSnap = await triggerExportSnapshot(page);
      expect(calSnap.payload.calibrated).toBe(true);
      expect(calSnap.payload.calibration).not.toBeNull();

      await page.getByTestId("reset-calibration-button").click();
      const resetSnap = await triggerExportSnapshot(page);
      expect(resetSnap.payload.calibrated).toBe(false);
      expect(resetSnap.payload.calibration).toBeNull();
    } finally {
      await close();
    }
  });

  test("T3-08 Calibration x Status Error: camera-busy supersedes calibration overlay and Retry recovers", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page, {
      autoRecoverOnRetry: true,
    });
    try {
      await page.getByTestId("start-calibration-button").click();
      await expect(page.getByTestId("calibration-overlay")).toBeVisible();

      server.stopStream();
      server.sendStatus("camera-busy", "Busy mid-cal");
      await expect(page.getByTestId("status-overlay")).toBeVisible();
      await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);

      await page.getByTestId("retry-button").click();
      await expect(page.getByTestId("status-overlay")).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test("T3-09 Blackout x Face Mesh: #05080f grid, face oval, and tesselation render together", async ({
    page,
  }) => {
    const { close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showGazeRays").click();
      await page.getByTestId("toggle-showZoneGrid").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showTrail").click();
      await page.getByTestId("toggle-showEyeMagnifier").click();

      await page.getByTestId("mode-blackout").click();
      const chin = { x1: 0.42, y1: 0.56, x2: 0.58, y2: 0.72 };
      const base = await measureCanvasActivity(page, chin);

      await page.getByTestId("toggle-showFaceMesh").click();
      await expect
        .poll(async () => (await measureCanvasActivity(page, chin)).rgbSum)
        .toBeGreaterThan(base.rgbSum + 500);
    } finally {
      await close();
    }
  });

  test("T3-10 Mirror x Ocular Scope: asymmetric openness swaps L-EYE and R-EYE slots cleanly", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showGazeRays").click();
      await page.getByTestId("toggle-showZoneGrid").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showTrail").click();
      server.setStreamGenerator(() =>
        makeSyntheticFace({ leftOpenness: 95, rightOpenness: 35 }),
      );
      await expect
        .poll(async () => readBiometricTile(page, "LEFT IRIS (hx, hy)"))
        .toContain("95%");

      const box = await page.getByTestId("eye-canvas").boundingBox();
      expect(box).not.toBeNull();
      const leftSlot = {
        x1: 22,
        y1: box!.height - 65,
        x2: 96,
        y2: box!.height - 30,
        normalized: false,
      };
      const mirrored = await sampleCanvasRegion(page, leftSlot);
      expect(mirrored.cyanPixels).toBeGreaterThan(mirrored.pinkPixels);

      await page.getByTestId("mirror-toggle").click();
      await expect
        .poll(async () => {
          const s = await sampleCanvasRegion(page, leftSlot);
          return s.pinkPixels > s.cyanPixels;
        })
        .toBe(true);
    } finally {
      await close();
    }
  });

  test("T3-11 Mirror x Rays & Wireframe: toggling Mirror OFF clears flip transform and flips reticle side", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
      const rightSideBefore = await sampleCanvasRegion(page, {
        x1: 0.72,
        y1: 0.35,
        x2: 0.98,
        y2: 0.65,
      });
      expect(rightSideBefore.cyanPixels).toBeGreaterThan(20);

      await page.getByTestId("mirror-toggle").click();
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
      const transform = await page
        .getByTestId("eye-video")
        .evaluate((el) => getComputedStyle(el).transform);
      expect(transform).not.toContain("-1");

      await expect
        .poll(async () => {
          const leftSideAfter = await sampleCanvasRegion(page, {
            x1: 0.02,
            y1: 0.35,
            x2: 0.28,
            y2: 0.65,
          });
          return leftSideAfter.cyanPixels;
        })
        .toBeGreaterThan(20);
    } finally {
      await close();
    }
  });

  test("T3-12 Smoothing OFF x Saccade Trail: turning smoothing OFF resets trail, then rebuilds unsmoothed points", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await server.pumpFrames(12, () => makeZoneGaze("LEFT"), 15);
      server.stopStream();
      await page.getByTestId("smoothing-toggle").click();
      const emptySnap = await triggerExportSnapshot(page);
      expect(emptySnap.payload.trail).toEqual([]);

      await server.pumpFrames(4, () => makeZoneGaze("RIGHT"), 15);
      const rebuilt = await triggerExportSnapshot(page);
      expect(rebuilt.payload.trail.length).toBeGreaterThanOrEqual(2);
    } finally {
      await close();
    }
  });

  test("T3-13 Smoothing x Blink-Freeze: max smoothing (1.0) + blink holds frozen coordinates", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await setRangeValue(page, "smoothing-slider", 1.0);
      server.setStreamGenerator(() => makeZoneGaze("LEFT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
      await page.waitForTimeout(200);
      const before = await readGazeCoordPercent(page);

      server.setStreamGenerator(() =>
        makeBlinkFrame({ dirX: 1.5, dirY: 1.5 }),
      );
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
      const during = await readGazeCoordPercent(page);
      expect(Math.abs(during!.x - before!.x)).toBeLessThanOrEqual(5);
    } finally {
      await close();
    }
  });

  test("T3-14 Smoothing x Fixation Timer: max smoothing stabilizes ±2% iris jitter so fixation climbs", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await setRangeValue(page, "smoothing-slider", 1.0);
      server.setStreamGenerator((seq) =>
        makeSyntheticFace({
          dirX: seq % 2 === 0 ? 0.04 : -0.04,
          dirY: 0,
        }),
      );
      await expect
        .poll(async () => {
          const tile = await readBiometricTile(page, "BLINKS / FIXATION");
          return Number(tile.match(/(\d+\.\d)s$/)?.[1] ?? 0);
        })
        .toBeGreaterThanOrEqual(0.5);
    } finally {
      await close();
    }
  });

  test("T3-15 All 6 Layers ON simultaneously vs all 6 OFF in blackout mode", async ({
    page,
  }) => {
    const { close } = await bootHudSession(page);
    try {
      await page.getByTestId("mode-blackout").click();
      await page.getByTestId("toggle-showFaceMesh").click();
      for (const id of [
        "toggle-showGazeRays",
        "toggle-showZoneGrid",
        "toggle-showHeatmap",
        "toggle-showTrail",
        "toggle-showEyeMagnifier",
        "toggle-showFaceMesh",
      ]) {
        await expect(page.getByTestId(id)).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      }
      const allOn = await measureCanvasActivity(page);

      for (const id of [
        "toggle-showGazeRays",
        "toggle-showZoneGrid",
        "toggle-showHeatmap",
        "toggle-showTrail",
        "toggle-showEyeMagnifier",
        "toggle-showFaceMesh",
      ]) {
        await page.getByTestId(id).click();
      }
      const allOff = await measureCanvasActivity(page);
      expect(allOn.aboveBlackoutPixels).toBeGreaterThan(
        allOff.aboveBlackoutPixels + 200,
      );
    } finally {
      await close();
    }
  });

  test("T3-16 Panel Collapse x Stage Resize: collapsing panel grows stage while preserving 16:9 ratio", async ({
    page,
  }) => {
    const { close } = await bootHudSession(page, { width: 1280, height: 720 });
    try {
      const openBox = await page.getByTestId("eye-stage").boundingBox();
      expect(openBox).not.toBeNull();
      expect(openBox!.width / openBox!.height).toBeCloseTo(16 / 9, 1);

      await page.getByTestId("panel-toggle").click();
      await expect
        .poll(async () => {
          const b = await page.getByTestId("eye-stage").boundingBox();
          return b ? b.width : 0;
        })
        .toBeGreaterThan(openBox!.width + 80);

      const collapsedBox = await page.getByTestId("eye-stage").boundingBox();
      expect(collapsedBox!.width / collapsedBox!.height).toBeCloseTo(
        16 / 9,
        1,
      );
    } finally {
      await close();
    }
  });

  test("T3-17 Panel Collapse x Calibration: calibrate with panel collapsed then expand and verify state", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("start-calibration-button").click();
      await page.getByTestId("panel-toggle").click();
      await expect(page.getByTestId("control-panel")).toBeHidden();

      for (let step = 0; step < 5; step++) {
        server.setStreamGenerator(() => makeCalibrationTargetGaze(step));
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          `(${step + 1}/5)`,
        );
        await page.waitForTimeout(100);
        await page.keyboard.press("Space");
      }
      await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);

      await page.getByTestId("panel-toggle").click();
      await expect(page.getByTestId("start-calibration-button")).toContainText(
        "Recalibrate 5-Pt",
      );
      await expect(page.getByTestId("reset-calibration-button")).toBeEnabled();
    } finally {
      await close();
    }
  });

  test("T3-18 Panel Collapse x Ocular Scope: scope hides on constrained stage and appears when panel collapses", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 440, height: 400 });
    const { close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showGazeRays").click();
      await page.getByTestId("toggle-showZoneGrid").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showTrail").click();
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

      const smallBox = await page.getByTestId("eye-canvas").boundingBox();
      expect(smallBox).not.toBeNull();
      expect(smallBox!.height).toBeLessThan(200);

      await page.getByTestId("panel-toggle").click();
      await expect
        .poll(async () => {
          const b = await page.getByTestId("eye-canvas").boundingBox();
          return b ? b.height : 0;
        })
        .toBeGreaterThanOrEqual(200);

      const grownBox = await page.getByTestId("eye-canvas").boundingBox();
      const scope = await sampleCanvasRegion(page, {
        x1: 12,
        y1: grownBox!.height - 86,
        x2: 204,
        y2: grownBox!.height - 12,
        normalized: false,
      });
      expect(scope.cyanPixels).toBeGreaterThan(20);
    } finally {
      await close();
    }
  });

  test("T3-19 Gaze Radar x Header Zone Badge: full consistency across zones, BLINK, and NO LOCK", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      const zones: GazeZone[] = [
        "UP-LEFT",
        "UP",
        "UP-RIGHT",
        "LEFT",
        "CENTER",
        "RIGHT",
        "DOWN-LEFT",
        "DOWN",
        "DOWN-RIGHT",
      ];
      for (const z of zones) {
        server.setStreamGenerator(() => makeZoneGaze(z));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(z);
        await expect(page.getByTestId("gaze-zone-badge")).toHaveText(z);
        const cellText = z === "CENTER" ? "CTR" : z.replace("-", "");
        await expect(
          page
            .getByTestId("gaze-lab-section")
            .getByText(cellText, { exact: true }),
        ).toHaveClass(/bg-cyan-500\/20/);
      }
    } finally {
      await close();
    }
  });

  test("T3-20 Clear x Heatmap/Trail/Blinks: Clear wipes trail/heatmap while preserving blinks and calibration", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");
      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
      server.setStreamGenerator(() => makeZoneGaze("LEFT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");

      server.stopStream();
      await page.getByTestId("clear-heatmap-button").click();
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
      await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
      const { payload } = await triggerExportSnapshot(page);
      expect(payload.trail).toEqual([]);
    } finally {
      await close();
    }
  });

  test("T3-21 Head Assist x Mirror: +30 deg yaw with headComp=0.8 flips horizontal gaze across Mirror toggle", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await setRangeValue(page, "gaze-head-comp", 0.8);
      server.setStreamGenerator(() => makeHeadPoseFrame(30, 0, 0));
      await expect
        .poll(async () => (await readGazeCoordPercent(page))?.x ?? 50)
        .toBeLessThan(35);

      await page.getByTestId("mirror-toggle").click();
      await expect
        .poll(async () => (await readGazeCoordPercent(page))?.x ?? 50)
        .toBeGreaterThan(65);
    } finally {
      await close();
    }
  });

  test("T3-22 Sensitivity x Biometrics Gaze Coord: Gain X scales GAZE COORD while LEFT/RIGHT IRIS hx stays constant", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      server.setStreamGenerator(() =>
        makeSyntheticFace({ dirX: 0.4, dirY: 0 }),
      );
      await setRangeValue(page, "gaze-sensitivity-x", 0.8);
      await page.waitForTimeout(220);
      const irisBefore = await readBiometricTile(page, "LEFT IRIS (hx, hy)");
      const coordBefore = await readGazeCoordPercent(page);

      await setRangeValue(page, "gaze-sensitivity-x", 3.6);
      await page.waitForTimeout(220);
      const irisAfter = await readBiometricTile(page, "LEFT IRIS (hx, hy)");
      const coordAfter = await readGazeCoordPercent(page);

      expect(irisAfter).toBe(irisBefore);
      expect(coordAfter!.x).toBeGreaterThan(coordBefore!.x + 15);
    } finally {
      await close();
    }
  });

  test("T3-23 Status Recovery x Delegate Change: camera-busy GPU recovers to CPU on Retry", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page, {
      initialStatus: "camera-busy",
      initialDelegate: "GPU",
      autoRecoverOnRetry: true,
      recoverDelegate: "CPU",
      streamInitialFrames: false,
    });
    try {
      await waitForDelegate(page, "GPU");
      await page.getByTestId("retry-button").click();
      await expect(page.getByTestId("status-overlay")).toHaveCount(0);
      await waitForDelegate(page, "CPU");
      server.startStream(() => makeCenterGaze(), { delegate: "CPU" });
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
    } finally {
      await close();
    }
  });

  test("T3-24 Status Recovery x Blink Counter: accumulated blinks persist across no-camera error recovery", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page, {
      autoRecoverOnRetry: true,
    });
    try {
      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
      server.setStreamGenerator(() => makeCenterGaze());
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

      server.stopStream();
      server.sendStatus("no-camera");
      await expect(page.getByTestId("status-overlay")).toBeVisible();
      await page.getByTestId("retry-button").click();
      await expect(page.getByTestId("status-overlay")).toHaveCount(0);

      server.startStream(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("2 BLINKS");
    } finally {
      await close();
    }
  });

  test("T3-25 Calibrated x Blink x Reticle/Radar Color: emerald -> amber during blink -> emerald on open", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showZoneGrid").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showTrail").click();
      await page.getByTestId("toggle-showEyeMagnifier").click();

      await completeCalibration(page, server, "click");
      await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
        /bg-emerald-400/,
      );

      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
        /bg-amber-400/,
      );
      await expect
        .poll(async () => {
          const s = await sampleCanvasRegion(page, {
            x1: 0.35,
            y1: 0.35,
            x2: 0.65,
            y2: 0.65,
          });
          return s.amberPixels;
        })
        .toBeGreaterThan(15);

      server.setStreamGenerator(() => makeCenterGaze());
      await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
        /bg-emerald-400/,
      );
    } finally {
      await close();
    }
  });

  test("T3-26 Layer Toggles x JSON Export: custom layer flags export accurately in gazeSettings", async ({
    page,
  }) => {
    const { close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showFaceMesh").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showZoneGrid").click();

      const { payload } = await triggerExportSnapshot(page);
      expect(payload.gazeSettings.showFaceMesh).toBe(true);
      expect(payload.gazeSettings.showHeatmap).toBe(false);
      expect(payload.gazeSettings.showZoneGrid).toBe(false);
      expect(payload.gazeSettings.showGazeRays).toBe(true);
    } finally {
      await close();
    }
  });

  test("T3-27 Sensitivity/Mirror/Smoothing Settings x JSON Export: exact parameter fidelity", async ({
    page,
  }) => {
    const { close } = await bootHudSession(page);
    try {
      await setRangeValue(page, "gaze-sensitivity-x", 3.1);
      await setRangeValue(page, "gaze-sensitivity-y", 1.5);
      await setRangeValue(page, "gaze-head-comp", 0.75);
      await setRangeValue(page, "smoothing-slider", 0.2);
      await page.getByTestId("smoothing-toggle").click();
      await page.getByTestId("mirror-toggle").click();

      const { payload } = await triggerExportSnapshot(page);
      expect(payload.mirrored).toBe(false);
      expect(payload.smoothing).toEqual({ enabled: false, strength: 0.2 });
      expect(payload.gazeSettings.sensitivityX).toBeCloseTo(3.1, 2);
      expect(payload.gazeSettings.sensitivityY).toBeCloseTo(1.5, 2);
      expect(payload.gazeSettings.headCompensation).toBeCloseTo(0.75, 2);
    } finally {
      await close();
    }
  });

  test("T3-28 16:9 vs 4:3 Aspect Ratio x 3x3 Zone Grid: canvas backing updates and grid fills full stage", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page, {
      width: 1280,
      height: 720,
    });
    try {
      await page.getByTestId("toggle-showGazeRays").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showTrail").click();
      await page.getByTestId("toggle-showEyeMagnifier").click();

      server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("DOWN-RIGHT");
      const wideW = await page
        .getByTestId("eye-canvas")
        .evaluate((c: HTMLCanvasElement) => c.width);

      server.setStreamMeta({ width: 640, height: 480 });
      await expect
        .poll(async () => {
          const b = await page.getByTestId("eye-stage").boundingBox();
          return b ? b.width / b.height : 0;
        })
        .toBeCloseTo(4 / 3, 1);

      const narrowW = await page
        .getByTestId("eye-canvas")
        .evaluate((c: HTMLCanvasElement) => c.width);
      expect(narrowW).toBeLessThan(wideW);
      const cell = await sampleCanvasRegion(page, {
        x1: 0.68,
        y1: 0.68,
        x2: 0.98,
        y2: 0.98,
      });
      expect(cell.cyanPixels).toBeGreaterThan(20);
    } finally {
      await close();
    }
  });

  test("T3-29 NO LOCK x Biometrics: face-dependent tiles revert to -- while BLINKS count persists", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");

      server.setStreamGenerator(() => makeNoFaceFrame());
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
      expect(await readBiometricTile(page, "LEFT IRIS (hx, hy)")).toBe(
        "-- , --",
      );
      expect(await readBiometricTile(page, "RIGHT IRIS (hx, hy)")).toBe(
        "-- , --",
      );
      expect(await readBiometricTile(page, "GAZE COORD (X, Y)")).toBe(
        "--%, --%",
      );
      expect(
        await readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
      ).toBe("--° / --° / --°");
      expect(await readBiometricTile(page, "BLINKS / FIXATION")).toMatch(
        /^1 blinks •/,
      );
    } finally {
      await close();
    }
  });

  test("T3-30 Calibration x Responsive Resize: target button remains anchored proportionally on viewport resize", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("start-calibration-button").click();
      server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
      await page.getByTestId("calibration-target-button").click();
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        "(2/5)",
      );

      await page.setViewportSize({ width: 900, height: 600 });
      await expect(page.getByTestId("calibration-target-button")).toHaveAttribute(
        "style",
        /left:\s*14%;\s*top:\s*16%/,
      );
    } finally {
      await close();
    }
  });

  test("T3-31 Header/Footer x Mobile Scroll: 390x844 layout keeps header, stage, sidebar, and footer reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { close } = await bootHudSession(page);
    try {
      await expect(page.locator("header")).toBeVisible();
      await expect(page.getByTestId("eye-stage")).toBeVisible();
      await expect(page.getByTestId("control-panel")).toBeVisible();
      await expect(page.getByTestId("app-copyright-footer")).toBeVisible();
      await page.getByTestId("export-snapshot").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("export-snapshot")).toBeVisible();
    } finally {
      await close();
    }
  });

  test("T3-32 Heatmap x Zone Grid: thermal red hotspot aligns inside UP-LEFT sector", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showGazeRays").click();
      await page.getByTestId("toggle-showTrail").click();
      await page.getByTestId("toggle-showEyeMagnifier").click();

      server.setStreamGenerator(() => makeZoneGaze("UP-LEFT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-LEFT");

      await expect
        .poll(async () => {
          const s = await sampleCanvasRegion(page, {
            x1: 0.05,
            y1: 0.05,
            x2: 0.3,
            y2: 0.3,
          });
          return s.redPixels;
        })
        .toBeGreaterThan(25);
    } finally {
      await close();
    }
  });

  test("T3-33 Saccade Trail x Rays & Reticle: sweeping UP-LEFT -> CENTER -> DOWN-RIGHT connects trail to reticle", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("toggle-showZoneGrid").click();
      await page.getByTestId("toggle-showHeatmap").click();
      await page.getByTestId("toggle-showEyeMagnifier").click();

      for (const z of ["UP-LEFT", "CENTER", "DOWN-RIGHT"] as const) {
        server.setStreamGenerator(() => makeZoneGaze(z));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(z);
      }

      const midSegment = await sampleCanvasRegion(page, {
        x1: 0.55,
        y1: 0.55,
        x2: 0.85,
        y2: 0.85,
      });
      expect(midSegment.cyanPixels).toBeGreaterThan(30);
    } finally {
      await close();
    }
  });

  test("T3-34 Inference Latency x Smoothing: varying inferenceMs (2.0 -> 18.0 ms) updates HUD cleanly under smoothing", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page, { inferenceMs: 2.0 });
    try {
      await setRangeValue(page, "smoothing-slider", 0.8);
      await expect(page.getByTestId("hud-inference-ms")).toHaveText("2.0 ms");
      server.setStreamMeta({ inferenceMs: 18.0 });
      await expect(page.getByTestId("hud-inference-ms")).toHaveText("18.0 ms");
    } finally {
      await close();
    }
  });

  test("T3-35 Error State x Export: exporting snapshot during camera-busy succeeds cleanly", async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const { close } = await bootHudSession(page, {
      initialStatus: "camera-busy",
      streamInitialFrames: false,
    });
    try {
      await expect(page.getByTestId("status-overlay")).toBeVisible();
      const { payload } = await triggerExportSnapshot(page);
      expect(payload.app).toBe("eye-gaze-hud");
      expect(errors.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  test("T3-36 Gaze Radar x Reset Calibration: Reset reverts emerald radar dot to cyan and label to MANUAL", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");
      await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
        /bg-emerald-400/,
      );
      await page.getByTestId("reset-calibration-button").click();
      await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
        /bg-cyan-400/,
      );
      await expect(page.getByTestId("control-panel")).toContainText("MANUAL");
    } finally {
      await close();
    }
  });
});
