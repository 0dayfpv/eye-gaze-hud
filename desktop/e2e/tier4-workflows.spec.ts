import { expect, test } from "@playwright/test";
import {
  attachErrorCollectors,
  bootHudSession,
  completeCalibration,
  measureCanvasActivity,
  readBiometricTile,
  readGazeCoordPercent,
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

test.describe("Tier 4: Real-World End-to-End Workflows (T4-01..T4-13)", () => {
  test("T4-01 Cold Boot to Active Gaze Tracking", async ({ page }) => {
    const errors = attachErrorCollectors(page);
    const { server, close } = await bootHudSession(page, {
      initialStatus: "requesting-camera",
      initialDelegate: "GPU",
      streamInitialFrames: false,
    });
    try {
      await expect(page.getByTestId("status-overlay")).toContainText(
        "Requesting Camera Access",
      );
      server.sendStatus("loading-model", undefined, "GPU");
      await expect(page.getByTestId("status-overlay")).toContainText(
        "Initializing Eye & Iris Engine",
      );

      server.sendStatus("ready", undefined, "GPU");
      await expect(page.getByTestId("status-overlay")).toHaveCount(0);
      server.sendFrame({
        data: makeNoFaceFrame(),
        width: 1280,
        height: 720,
        inferenceMs: 3.8,
      });
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");

      server.startStream(() => makeCenterGaze(), {
        fps: 30,
        width: 1280,
        height: 720,
        delegate: "GPU",
        inferenceMs: 3.8,
      });
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      await expect(page.getByTestId("hud-inference-ms")).toHaveText("3.8 ms");
      await waitForDelegate(page, "GPU");
      await expect(page.getByTestId("gaze-radar-dot")).toBeVisible();
      expect(await readBiometricTile(page, "LEFT IRIS (hx, hy)")).toMatch(
        /\d+\.\d{2},\s*\d+\.\d{2}\s*•\s*\d+%/,
      );
      expect(await readBiometricTile(page, "RIGHT IRIS (hx, hy)")).toMatch(
        /\d+\.\d{2},\s*\d+\.\d{2}\s*•\s*\d+%/,
      );
      expect(await readBiometricTile(page, "GAZE COORD (X, Y)")).toMatch(
        /\d+%,\s*\d+%/,
      );
      expect(
        await readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
      ).toBe("0.0° / 0.0° / 0.0°");
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  test("T4-02 Full 5-Point Calibration & Accuracy Verification", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await expect(page.getByTestId("control-panel")).toContainText("MANUAL");
      await completeCalibration(page, server, "mixed");

      await expect(page.getByTestId("hud-calibrated-badge")).toHaveText(
        "5-PT CAL",
      );
      await expect(page.getByTestId("control-panel")).toContainText(
        "CALIBRATED",
      );
      await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
        /bg-emerald-400/,
      );

      for (const z of ["UP-LEFT", "CENTER", "DOWN-RIGHT"] as const) {
        server.setStreamGenerator(() => makeZoneGaze(z));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(z);
      }

      const { payload } = await triggerExportSnapshot(page);
      expect(payload.calibrated).toBe(true);
      expect(payload.calibration?.sampleCount).toBe(5);
      expect(payload.calibration!.ax1).toBeGreaterThan(0.5);
      expect(payload.calibration!.ay2).toBeGreaterThan(0.5);
    } finally {
      await close();
    }
  });

  test("T4-03 Camera Busy Recovery Workflow", async ({ page }) => {
    const { server, close } = await bootHudSession(page, {
      initialStatus: "camera-busy",
      initialMessage: "Device /dev/video0 is held by another process",
      autoRecoverOnRetry: true,
      streamInitialFrames: false,
    });
    try {
      const overlay = page.getByTestId("status-overlay");
      await expect(overlay).toHaveAttribute("role", "alert");
      await expect(overlay).toContainText(
        "Device /dev/video0 is held by another process",
      );

      const cmdPromise = server.waitForCommand("retry_camera");
      await page.getByTestId("retry-button").click();
      await cmdPromise;
      await expect(overlay).toHaveCount(0);

      server.startStream(() => makeCenterGaze());
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
    } finally {
      await close();
    }
  });

  test("T4-04 Permission Denied -> Missing Camera -> CPU Fallback Recovery", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page, {
      initialStatus: "permission-denied",
      initialDelegate: "GPU",
      streamInitialFrames: false,
    });
    try {
      await expect(page.getByTestId("status-overlay")).toContainText(
        "Camera Permission Denied",
      );
      const retry1 = server.waitForCommand("retry_camera");
      await page.getByTestId("retry-button").click();
      await retry1;

      server.clearCommands();
      server.sendStatus("no-camera", "Plug in webcam");
      await expect(page.getByTestId("status-overlay")).toContainText(
        "No Camera Detected",
      );

      const retry2 = server.waitForCommand("retry_camera");
      await page.getByTestId("retry-button").click();
      await retry2;

      server.sendStatus("ready", undefined, "CPU");
      await expect(page.getByTestId("status-overlay")).toHaveCount(0);
      server.startStream(() => makeZoneGaze("UP"), { delegate: "CPU" });
      await waitForDelegate(page, "CPU");
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP");
    } finally {
      await close();
    }
  });

  test("T4-05 9-Zone Gaze Sweep, Heatmap Build & Clear", async ({ page }) => {
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

      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");

      server.stopStream();
      for (const z of zones) {
        await server.pumpFrames(5, () => makeZoneGaze(z), 18);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(z);
      }

      const preClear = await triggerExportSnapshot(page);
      expect(preClear.payload.trail.length).toBeGreaterThan(5);
      expect(preClear.payload.trail.length).toBeLessThanOrEqual(28);

      await page.getByTestId("clear-heatmap-button").click();
      const postClear = await triggerExportSnapshot(page);
      expect(postClear.payload.trail).toEqual([]);
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");
    } finally {
      await close();
    }
  });

  test("T4-06 Natural Reading & Blink-Freeze Stability", async ({ page }) => {
    const { server, close } = await bootHudSession(page);
    try {
      server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
      await page.waitForTimeout(350);
      const steady = await readGazeCoordPercent(page);
      expect(steady).not.toBeNull();

      for (let i = 1; i <= 3; i++) {
        server.setStreamGenerator(() =>
          makeBlinkFrame({ dirX: 0, dirY: 1.4 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          `${i} BLINKS`,
        );
        await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
          /bg-amber-400/,
        );
        const frozen = await readGazeCoordPercent(page);
        expect(Math.abs(frozen!.y - steady!.y)).toBeLessThanOrEqual(5);

        server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
      }
    } finally {
      await close();
    }
  });

  test("T4-07 Blackout Tactical Presentation + Face Mesh Inspection", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("mode-blackout").click();
      await expect
        .poll(async () =>
          page
            .getByTestId("eye-video")
            .evaluate((el) => Number(getComputedStyle(el).opacity)),
        )
        .toBe(0);

      const chin = { x1: 0.42, y1: 0.56, x2: 0.58, y2: 0.72 };
      const baseActivity = await measureCanvasActivity(page, chin);

      await page.getByTestId("toggle-showFaceMesh").click();
      server.setStreamGenerator(() => makeHeadPoseFrame(-15, 12, -8));
      await expect
        .poll(async () =>
          readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
        )
        .toMatch(/^-15\.0°\s*\/\s*12\.0°\s*\/\s*-8\.0°$/);

      const meshActivity = await measureCanvasActivity(page, chin);
      expect(meshActivity.rgbSum).toBeGreaterThan(baseActivity.rgbSum);

      await page.getByTestId("mirror-toggle").click();
      await expect(page.getByTestId("mirror-toggle")).toHaveText("OFF");
      await page.getByTestId("mirror-toggle").click();
      await expect(page.getByTestId("mirror-toggle")).toHaveText("ON");
    } finally {
      await close();
    }
  });

  test("T4-08 Manual Gain Tuning & Head-Pose Assist Compensation", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await setRangeValue(page, "gaze-sensitivity-x", 3.6);
      await setRangeValue(page, "gaze-sensitivity-y", 1.2);
      await setRangeValue(page, "gaze-head-comp", 0.85);

      server.setStreamGenerator(() => makeHeadPoseFrame(-20, 10, 0));
      await expect
        .poll(async () => (await readGazeCoordPercent(page))?.x ?? 50)
        .toBeGreaterThan(78);

      const coord = await readGazeCoordPercent(page);
      expect(coord!.y).toBeGreaterThan(50);
      expect(coord!.y).toBeLessThan(85);

      const { payload } = await triggerExportSnapshot(page);
      expect(payload.calibrated).toBe(false);
      expect(payload.gazeSettings.sensitivityX).toBeCloseTo(3.6, 2);
      expect(payload.gazeSettings.sensitivityY).toBeCloseTo(1.2, 2);
      expect(payload.gazeSettings.headCompensation).toBeCloseTo(0.85, 2);
    } finally {
      await close();
    }
  });

  test("T4-09 One-Euro Filter Tuning & Raw Jitter Comparison", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("smoothing-toggle").click();
      await expect(page.getByTestId("smoothing-slider")).toBeDisabled();
      server.stopStream();

      server.sendFrame({ data: makeCenterGaze() });
      await page.waitForTimeout(130);
      server.sendFrame({ data: makeZoneGaze("RIGHT") });
      await page.waitForTimeout(130);
      const rawJump = await readGazeCoordPercent(page);
      expect(rawJump!.x).toBeGreaterThanOrEqual(82);

      await page.getByTestId("smoothing-toggle").click();
      await setRangeValue(page, "smoothing-slider", 0.9);
      server.sendFrame({ data: makeCenterGaze() });
      await page.waitForTimeout(140);
      server.sendFrame({ data: makeZoneGaze("LEFT") });
      await page.waitForTimeout(140);
      const dampedStep = await readGazeCoordPercent(page);
      expect(dampedStep!.x).toBeGreaterThan(22);

      await setRangeValue(page, "smoothing-slider", 0.2);
      const { payload } = await triggerExportSnapshot(page);
      expect(payload.smoothing).toEqual({ enabled: true, strength: 0.2 });
    } finally {
      await close();
    }
  });

  test("T4-10 Calibration Interruption, Restart & Reset Lifecycle", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await page.getByTestId("start-calibration-button").click();
      for (let s = 0; s < 2; s++) {
        server.setStreamGenerator(() => makeCalibrationTargetGaze(s));
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          `(${s + 1}/5)`,
        );
        await page.getByTestId("calibration-target-button").click();
      }
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
      await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);

      await page.getByTestId("start-calibration-button").click();
      for (let s = 0; s < 3; s++) {
        server.setStreamGenerator(() => makeCalibrationTargetGaze(s));
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          `(${s + 1}/5)`,
        );
        await page.getByTestId("calibration-target-button").click();
      }
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        "(4/5)",
      );
      await page.getByTestId("start-calibration-button").click();
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        "(1/5)",
      );
      await page.keyboard.press("Escape");

      await completeCalibration(page, server, "space");
      await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
      await page.getByTestId("reset-calibration-button").click();
      await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
      await expect(page.getByTestId("control-panel")).toContainText("MANUAL");
    } finally {
      await close();
    }
  });

  test("T4-11 Focus Mode (Collapsed Sidebar) & Responsive Viewport Workflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { server, close } = await bootHudSession(page);
    try {
      const initialBox = await page.getByTestId("eye-stage").boundingBox();
      await page.getByTestId("panel-toggle").click();
      await expect(page.getByTestId("control-panel")).toBeHidden();
      await expect
        .poll(async () => {
          const b = await page.getByTestId("eye-stage").boundingBox();
          return b ? b.width : 0;
        })
        .toBeGreaterThan(initialBox!.width + 100);

      server.setStreamGenerator(() => makeZoneGaze("UP-RIGHT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-RIGHT");
      server.setStreamGenerator(() => makeBlinkFrame());
      await expect(page.getByTestId("hud-blink-count")).toHaveText("1 BLINKS");

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("panel-toggle").click();
      await expect(page.getByTestId("control-panel")).toBeVisible();
      await expect(page.getByTestId("app-copyright-footer")).toBeVisible();

      const noOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      expect(noOverflow).toBe(true);
    } finally {
      await close();
    }
  });

  test("T4-12 Occlusion / User Leaves & Returns (NO LOCK Recovery)", async ({
    page,
  }) => {
    const { server, close } = await bootHudSession(page);
    try {
      for (let i = 1; i <= 2; i++) {
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          `${i} BLINKS`,
        );
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      }

      server.setStreamGenerator(() => makeNoFaceFrame());
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
      await expect(page.getByTestId("gaze-radar-dot")).toHaveCount(0);
      expect(await readBiometricTile(page, "GAZE COORD (X, Y)")).toBe(
        "--%, --%",
      );

      server.setStreamGenerator(() => makeZoneGaze("UP-LEFT"));
      await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-LEFT");
      await expect(page.getByTestId("gaze-radar-dot")).toBeVisible();
      await expect(page.getByTestId("hud-blink-count")).toHaveText("2 BLINKS");
    } finally {
      await close();
    }
  });

  test("T4-13 Comprehensive Diagnostic Snapshot Audit", async ({ page }) => {
    const { server, close } = await bootHudSession(page);
    try {
      await completeCalibration(page, server, "click");

      for (let i = 1; i <= 4; i++) {
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          `${i} BLINKS`,
        );
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      }

      await page.getByTestId("toggle-showFaceMesh").click();
      await page.getByTestId("mode-blackout").click();
      await page.getByTestId("mirror-toggle").click();
      await setRangeValue(page, "smoothing-slider", 0.7);

      await server.pumpFrames(
        15,
        (seq) => makeSyntheticFace({ dirX: -0.5 + seq * 0.06, dirY: 0.2 }),
        18,
      );

      const { filename, payload } = await triggerExportSnapshot(page);
      expect(filename).toMatch(/^eye-gaze-snapshot-\d+\.json$/);
      expect(payload.app).toBe("eye-gaze-hud");
      expect(payload.version).toBe("2.1.0");
      expect(Number.isFinite(payload.timestampMs)).toBe(true);
      expect(payload.mirrored).toBe(false);
      expect(payload.smoothing).toEqual({ enabled: true, strength: 0.7 });
      expect(payload.gazeSettings.showFaceMesh).toBe(true);
      expect(payload.calibrated).toBe(true);
      expect(payload.calibration?.sampleCount).toBe(5);
      expect(payload.blinkCount).toBe(4);
      expect(payload.gaze).not.toBeNull();
      expect(payload.gaze?.calibrated).toBe(true);
      expect(payload.trail.length).toBeGreaterThan(2);
      expect(payload.trail.length).toBeLessThanOrEqual(28);
    } finally {
      await close();
    }
  });
});
