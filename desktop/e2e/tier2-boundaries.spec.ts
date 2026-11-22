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
} from "./fixtures/hudHelpers";
import {
  makeBlinkFrame,
  makeCenterGaze,
  makeHeadPoseFrame,
  makeNoFaceFrame,
  makeSyntheticFace,
  makeZoneGaze,
  type Landmark3D,
} from "./fixtures/syntheticFace";

test.describe("Tier 2: Boundary, Negative & Error Cases (F01-F24)", () => {
  test.describe("F01 Boundaries: Top Header Branding", () => {
    test("T2-F01-01 narrow mobile viewport (390x844) wraps header with zero horizontal overflow", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { close } = await bootHudSession(page);
      try {
        await expect(page.locator("header")).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        );
        expect(overflow).toBe(true);
      } finally {
        await close();
      }
    });

    test("T2-F01-02 ultra-wide viewport (2560x1440) stretches header full width", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 2560, height: 1440 });
      const { close } = await bootHudSession(page);
      try {
        const box = await page.locator("header").boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(2550);
      } finally {
        await close();
      }
    });

    test("T2-F01-03 short viewport (1280x480) keeps header non-overlapping above stage", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 480 });
      const { close } = await bootHudSession(page);
      try {
        const headerBox = await page.locator("header").boundingBox();
        const stageBox = await page.getByTestId("eye-stage").boundingBox();
        expect(headerBox).not.toBeNull();
        expect(stageBox).not.toBeNull();
        expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(
          stageBox!.y + 1,
        );
      } finally {
        await close();
      }
    });

    test("T2-F01-04 zero uncaught pageerror or console.error during full boot cycle", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        expect(errors.pageErrors).toEqual([]);
        expect(errors.consoleErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F01-05 abrupt WebSocket disconnect preserves header shell without pageerror", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.stopStream();
        server.disconnectClients();
        await expect(page.locator("header h1")).toContainText(
          "Eye Gaze HUD V2.1",
        );
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F02 Boundaries: Live Gaze Zone Badge", () => {
    test("T2-F02-01 477 landmarks (1 short of iris) returns NO LOCK without throwing", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        const short = makeCenterGaze();
        server.setStreamGenerator(() => ({
          ...short,
          landmarks: short.landmarks.slice(0, 477),
        }));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F02-02 null blendshapes with 478 landmarks still locks gaze geometrically", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() =>
          makeZoneGaze("RIGHT", { omitBlendshapes: true, dirX: 1.4 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
      } finally {
        await close();
      }
    });

    test("T2-F02-03 gaze near deadzone boundary transitions cleanly between CENTER and RIGHT", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        // Turn off smoothing for exact single-frame boundary check
        await page.getByTestId("smoothing-toggle").click();
        // dirX = 0.42 -> screenX ~ 0.646 (CENTER); dirX = 0.50 -> screenX ~ 0.674 (RIGHT)
        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: 0.42, dirY: 0 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: 0.5, dirY: 0 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
      } finally {
        await close();
      }
    });

    test("T2-F02-04 rapid alternating faceDetected true/false leaves no stale CENTER on NO LOCK", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.stopStream();
        await server.pumpFrames(
          10,
          (seq) => (seq % 2 === 0 ? makeCenterGaze() : makeNoFaceFrame()),
          15,
        );
        server.sendFrame({ data: makeNoFaceFrame() });
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
      } finally {
        await close();
      }
    });

    test("T2-F02-05 collapsed zero/NaN-serialized landmark coordinates fall back to NO LOCK safely", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        const zeroLandmarks: Landmark3D[] = Array.from(
          { length: 478 },
          () => [Number.NaN, Number.NaN, 0] as Landmark3D,
        );
        server.setStreamGenerator(() => ({
          faceDetected: true,
          landmarks: zeroLandmarks,
          blendshapes: null,
        }));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F03 Boundaries: Blink Counter", () => {
    test("T2-F03-01 unilateral left or right blink keeps blinkCount at 0", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await server.pumpFrames(
          8,
          () => makeBlinkFrame({ unilateral: "left" }),
          20,
        );
        await server.pumpFrames(
          8,
          () => makeBlinkFrame({ unilateral: "right" }),
          20,
        );
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "0 BLINKS",
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      } finally {
        await close();
      }
    });

    test("T2-F03-02 sustained bilateral blink over 30 frames increments count by exactly +1", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
        await server.pumpFrames(30, () => makeBlinkFrame(), 12);
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
      } finally {
        await close();
      }
    });

    test("T2-F03-03 low EAR alone with 0 blendshape blink score still detects blink", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() =>
          makeSyntheticFace({
            blink: true,
            eyeBlinkLeftScore: 0,
            eyeBlinkRightScore: 0,
          }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
      } finally {
        await close();
      }
    });

    test("T2-F03-04 exact blendshape blink threshold: 0.52 does not trigger, 0.53 does", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() =>
          makeSyntheticFace({
            leftOpenness: 100,
            rightOpenness: 100,
            eyeBlinkLeftScore: 0.52,
            eyeBlinkRightScore: 0.52,
          }),
        );
        await page.waitForTimeout(220);
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "0 BLINKS",
        );

        server.setStreamGenerator(() =>
          makeSyntheticFace({
            leftOpenness: 100,
            rightOpenness: 100,
            eyeBlinkLeftScore: 0.53,
            eyeBlinkRightScore: 0.53,
          }),
        );
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
      } finally {
        await close();
      }
    });

    test("T2-F03-05 blink-freeze preserves last screenX/Y despite downward eye movement during blink", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeZoneGaze("UP-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-RIGHT");
        await page.waitForTimeout(200);
        const before = await readGazeCoordPercent(page);
        expect(before).not.toBeNull();

        server.setStreamGenerator(() =>
          makeBlinkFrame({ dirX: 0, dirY: 1.5 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        const during = await readGazeCoordPercent(page);
        expect(during).not.toBeNull();
        expect(Math.abs(during!.x - before!.x)).toBeLessThanOrEqual(5);
        expect(Math.abs(during!.y - before!.y)).toBeLessThanOrEqual(5);
      } finally {
        await close();
      }
    });
  });

  test.describe("F04 Boundaries: 5-PT CAL Badge", () => {
    test("T2-F04-01 canceling calibration at step 5/5 via Escape keeps 5-PT CAL absent", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        for (let step = 0; step < 4; step++) {
          server.setStreamGenerator(() => makeCalibrationTargetGaze(step));
          await expect(page.getByTestId("calibration-overlay")).toContainText(
            `(${step + 1}/5)`,
          );
          await page.waitForTimeout(100);
          await page.getByTestId("calibration-target-button").click();
        }
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(5/5)",
        );
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T2-F04-02 canceling a recalibration preserves existing 5-PT CAL badge", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await page.getByTestId("start-calibration-button").click();
        await expect(page.getByTestId("calibration-overlay")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T2-F04-03 clicking Reset hides 5-PT CAL immediately", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await page.getByTestId("reset-calibration-button").click();
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T2-F04-04 viewport < 640px hides 5-PT CAL via sm breakpoint without overflow", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await page.setViewportSize({ width: 500, height: 800 });
        await expect(page.getByTestId("hud-calibrated-badge")).toBeHidden();
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

    test("T2-F04-05 repeated calibration overwrites cleanly without duplicate badges", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await completeCalibration(page, server, "space");
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(1);
      } finally {
        await close();
      }
    });
  });

  test.describe("F05 Boundaries: FPS, Latency & Delegate", () => {
    test("T2-F05-01 zero inferenceMs displays 0.0 ms", async ({ page }) => {
      const { close } = await bootHudSession(page, { inferenceMs: 0 });
      try {
        await expect(page.getByTestId("hud-inference-ms")).toHaveText("0.0 ms");
      } finally {
        await close();
      }
    });

    test("T2-F05-02 negative inferenceMs clamps safely to 0.0 ms", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, { inferenceMs: -12.5 });
      try {
        await expect(page.getByTestId("hud-inference-ms")).toHaveText("0.0 ms");
      } finally {
        await close();
      }
    });

    test("T2-F05-03 high inference latency (120.46 ms) formats without breaking header layout", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, { inferenceMs: 120.46 });
      try {
        await expect(page.getByTestId("hud-inference-ms")).toHaveText(
          "120.5 ms",
        );
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

    test("T2-F05-04 delegate toggling GPU -> CPU -> GPU updates header and sidebar", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialDelegate: "GPU",
      });
      try {
        await expect(page.getByTestId("hud-delegate")).toHaveText("GPU");
        server.setStreamMeta({ delegate: "CPU" });
        await expect(page.getByTestId("hud-delegate")).toHaveText("CPU");
        await expect(page.getByTestId("control-panel")).toContainText("CPU");
        server.setStreamMeta({ delegate: "GPU" });
        await expect(page.getByTestId("hud-delegate")).toHaveText("GPU");
        await expect(page.getByTestId("control-panel")).toContainText("GPU");
      } finally {
        await close();
      }
    });

    test("T2-F05-05 stopping frame stream never renders NaN or Infinity FPS", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.stopStream();
        await page.waitForTimeout(250);
        const txt = (await page.getByTestId("hud-fps").innerText()).trim();
        expect(Number.isFinite(Number(txt))).toBe(true);
        expect(txt).not.toMatch(/NaN|Infinity/i);
      } finally {
        await close();
      }
    });
  });

  test.describe("F06 Boundaries: Collapsible Panel Toggle", () => {
    test("T2-F06-01 rapid 10x and 11th click spam settles to consistent state", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("panel-toggle");
        for (let i = 0; i < 10; i++) {
          await toggle.click();
        }
        await expect(page.getByTestId("control-panel")).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await toggle.click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
      } finally {
        await close();
      }
    });

    test("T2-F06-02 mobile viewport (390x844) stacks sidebar below stage and collapses cleanly", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { close } = await bootHudSession(page);
      try {
        const stageBox = await page.getByTestId("eye-stage").boundingBox();
        const panelBox = await page.getByTestId("control-panel").boundingBox();
        expect(stageBox).not.toBeNull();
        expect(panelBox).not.toBeNull();
        expect(panelBox!.y).toBeGreaterThanOrEqual(
          stageBox!.y + stageBox!.height - 2,
        );

        await page.getByTestId("panel-toggle").click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await expect(page.getByTestId("eye-stage")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T2-F06-03 collapsing panel mid-calibration keeps calibration-overlay interactive", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        await page.getByTestId("panel-toggle").click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await expect(page.getByTestId("calibration-overlay")).toBeVisible();

        server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
        await page.getByTestId("calibration-target-button").click();
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
      } finally {
        await close();
      }
    });

    test("T2-F06-04 collapsing panel during status-overlay keeps alert overlay visible", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "no-camera",
        streamInitialFrames: false,
      });
      try {
        await page.getByTestId("panel-toggle").click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        await expect(page.getByTestId("retry-button")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T2-F06-05 keyboard Enter on focused panel-toggle toggles sidebar", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("panel-toggle");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("control-panel")).toBeVisible();
      } finally {
        await close();
      }
    });
  });

  test.describe("F07 Boundaries: Aspect-Locked Stage", () => {
    test("T2-F07-01 portrait container (400x800) letterboxes stage preserving aspect ratio", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 400, height: 800 });
      const { close } = await bootHudSession(page);
      try {
        await expect
          .poll(async () => {
            const box = await page.getByTestId("eye-stage").boundingBox();
            return box ? box.width / box.height : 0;
          })
          .toBeCloseTo(16 / 9, 1);
      } finally {
        await close();
      }
    });

    test("T2-F07-02 ultra-wide short container (1920x400) pillarboxes stage preserving aspect ratio", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1920, height: 400 });
      const { close } = await bootHudSession(page);
      try {
        await expect
          .poll(async () => {
            const box = await page.getByTestId("eye-stage").boundingBox();
            return box ? box.width / box.height : 0;
          })
          .toBeCloseTo(16 / 9, 1);
      } finally {
        await close();
      }
    });

    test("T2-F07-03 switching stream 1280x720 -> 640x480 updates stage aspect ratio", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        width: 1280,
        height: 720,
      });
      try {
        await expect
          .poll(async () => {
            const box = await page.getByTestId("eye-stage").boundingBox();
            return box ? box.width / box.height : 0;
          })
          .toBeCloseTo(16 / 9, 1);

        server.setStreamMeta({ width: 640, height: 480 });
        await expect
          .poll(async () => {
            const box = await page.getByTestId("eye-stage").boundingBox();
            return box ? box.width / box.height : 0;
          })
          .toBeCloseTo(4 / 3, 1);
      } finally {
        await close();
      }
    });

    test("T2-F07-04 empty/corrupted JPEG bytes in binary packet do not crash stage or telemetry", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({
          data: makeZoneGaze("UP"),
          jpegBytes: Buffer.alloc(0),
        });
        server.sendFrame({
          data: makeZoneGaze("UP"),
          jpegBytes: Buffer.from([0x00, 0xff, 0x12]),
        });
        server.startStream(() => makeZoneGaze("UP"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP");
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F07-05 devicePixelRatio 1 vs 2.5 scales canvas backing buffer proportionally", async ({
      browser,
    }) => {
      const ctx1 = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      const p1 = await ctx1.newPage();
      const s1 = await bootHudSession(p1);
      let ratio1: number;
      try {
        ratio1 = await p1.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            '[data-testid="eye-canvas"]',
          )!;
          return c.width / c.getBoundingClientRect().width;
        });
      } finally {
        await s1.close();
        await ctx1.close();
      }

      const ctx2 = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2.5,
      });
      const p2 = await ctx2.newPage();
      const s2 = await bootHudSession(p2);
      try {
        await expect
          .poll(async () =>
            p2.evaluate(() => {
              const c = document.querySelector<HTMLCanvasElement>(
                '[data-testid="eye-canvas"]',
              )!;
              return c.width / c.getBoundingClientRect().width;
            }),
          )
          .toBeCloseTo(2.5, 1);
        expect(ratio1).toBeCloseTo(1, 1);
      } finally {
        await s2.close();
        await ctx2.close();
      }
    });
  });

  test.describe("F08 Boundaries: Status & Retry Overlay", () => {
    test("T2-F08-01 camera-busy displays custom message verbatim alongside Retry", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "camera-busy",
        initialMessage: "Locked by Firefox PID 123",
        streamInitialFrames: false,
      });
      try {
        const overlay = page.getByTestId("status-overlay");
        await expect(overlay).toContainText("Locked by Firefox PID 123");
        await expect(page.getByTestId("retry-button")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T2-F08-02 empty/whitespace message falls back to default permission-denied detail", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "permission-denied",
        initialMessage: "   ",
        streamInitialFrames: false,
      });
      try {
        const overlay = page.getByTestId("status-overlay");
        await expect(overlay).toContainText("Camera Permission Denied");
        await expect(overlay.locator("p")).not.toHaveText("");
      } finally {
        await close();
      }
    });

    test("T2-F08-03 clicking Retry while WS is disconnected causes no unhandled pageerror", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, {
        initialStatus: "error",
        streamInitialFrames: false,
      });
      try {
        server.disconnectClients();
        await page.waitForTimeout(100);
        await page.getByTestId("retry-button").click();
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F08-04 ready -> camera-busy -> loading-model -> ready clears stale state and recovers", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.stopStream();
        server.sendStatus("camera-busy", "Busy");
        await expect(page.getByTestId("status-overlay")).toContainText("Busy");

        server.sendStatus("loading-model");
        await expect(page.getByTestId("status-overlay")).toContainText(
          "Initializing Eye & Iris Engine",
        );

        server.sendStatus("ready", undefined, "GPU");
        server.startStream(() => makeZoneGaze("UP-LEFT"));
        await expect(page.getByTestId("status-overlay")).toHaveCount(0);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-LEFT");
      } finally {
        await close();
      }
    });

    test("T2-F08-05 calibration-overlay is suppressed whenever status drops away from ready", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        await expect(page.getByTestId("calibration-overlay")).toBeVisible();
        server.sendStatus("camera-busy");
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F09 Boundaries: 5-Point Calibration", () => {
    test("T2-F09-01 blinking frames during calibration capture pause progress until open frames arrive", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");

        await page.getByTestId("start-calibration-button").click();
        await page.getByTestId("calibration-target-button").click();
        await page.waitForTimeout(250);
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(1/5)",
        );
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "0%",
        );

        server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
      } finally {
        await close();
      }
    });

    test("T2-F09-02 NO LOCK frames during calibration capture pause progress cleanly", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");

        await page.getByTestId("start-calibration-button").click();
        await page.getByTestId("calibration-target-button").click();
        await page.waitForTimeout(250);
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(1/5)",
        );

        server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
      } finally {
        await close();
      }
    });

    test("T2-F09-03 pressing Space 5x rapidly during step 1 capture only captures step 1", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
        await page.getByTestId("start-calibration-button").click();
        await page.waitForTimeout(100);
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press("Space");
        }
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
        await page.waitForTimeout(200);
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
      } finally {
        await close();
      }
    });

    test("T2-F09-04 clicking start-calibration-button mid-step 3 restarts cleanly at step 1/5", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        for (let step = 0; step < 2; step++) {
          server.setStreamGenerator(() => makeCalibrationTargetGaze(step));
          await expect(page.getByTestId("calibration-overlay")).toContainText(
            `(${step + 1}/5)`,
          );
          await page.getByTestId("calibration-target-button").click();
        }
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(3/5)",
        );
        await page.getByTestId("start-calibration-button").click();
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(1/5)",
        );
      } finally {
        await close();
      }
    });

    test("T2-F09-05 identical gaze samples across all 5 targets solve safely without NaN", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeCenterGaze());
        await page.getByTestId("start-calibration-button").click();
        for (let step = 0; step < 5; step++) {
          await expect(page.getByTestId("calibration-overlay")).toContainText(
            `(${step + 1}/5)`,
          );
          await page.getByTestId("calibration-target-button").click();
        }
        await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
        await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
        const coords = await readGazeCoordPercent(page);
        expect(coords).not.toBeNull();
        expect(Number.isFinite(coords!.x)).toBe(true);
        expect(Number.isFinite(coords!.y)).toBe(true);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F10 Boundaries: Base Ocular Wireframe", () => {
    test("T2-F10-01 468 landmarks (<478) draws eyelids without irises and reports NO LOCK", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const base = makeCenterGaze();
        server.setStreamGenerator(() => ({
          ...base,
          landmarks: base.landmarks.slice(0, 468),
        }));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        const eyeBand = await sampleCanvasRegion(page, {
          x1: 0.34,
          y1: 0.36,
          x2: 0.66,
          y2: 0.48,
        });
        expect(eyeBand.nonEmptyPixels).toBeGreaterThan(10);
        expect(eyeBand.brightWhitePixels).toBe(0);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F10-02 extreme corner coordinates (0,0) and (1,1) clip safely within canvas", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        const extreme = makeCenterGaze();
        extreme.landmarks[33] = [0.0, 0.0, 0];
        extreme.landmarks[263] = [1.0, 1.0, 0];
        server.setStreamGenerator(() => extreme);
        await page.waitForTimeout(200);
        const stats = await sampleCanvasRegion(page);
        expect(stats.width).toBeGreaterThan(0);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F10-03 partial occlusion (right eye occluded) still renders left eye wireframe", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const partial = makeCenterGaze();
        for (const idx of [33, 133, 159, 145, 468]) {
          partial.landmarks[idx] = [Number.NaN, Number.NaN, 0];
        }
        server.setStreamGenerator(() => partial);
        await page.waitForTimeout(200);
        const leftBand = await sampleCanvasRegion(page, {
          x1: 0.34,
          y1: 0.36,
          x2: 0.5,
          y2: 0.48,
        });
        expect(leftBand.cyanPixels).toBeGreaterThan(10);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F10-04 faceDetected true -> false -> true clears and redraws cleanly", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        await expect
          .poll(async () => (await sampleCanvasRegion(page)).nonEmptyPixels)
          .toBe(0);

        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await expect
          .poll(async () => (await sampleCanvasRegion(page)).nonEmptyPixels)
          .toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T2-F10-05 rapid 60fps landmark jitter causes zero canvas exceptions", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, { fps: 60 });
      try {
        server.setStreamGenerator((seq) =>
          makeSyntheticFace({
            dirX: (seq % 2 === 0 ? 1 : -1) * 0.8,
            dirY: ((seq % 3) - 1) * 0.6,
          }),
        );
        await page.waitForTimeout(350);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F11 Boundaries: Layer 1 - Rays & Reticle", () => {
    test("T2-F11-01 reticle near top edge (screenY=0.01) flips upright pill below reticle", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: 0, dirY: -2.0 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP");
        await expect
          .poll(async () => {
            const belowBand = await sampleCanvasRegion(page, {
              x1: 0.42,
              y1: 0.06,
              x2: 0.58,
              y2: 0.16,
            });
            return belowBand.darkBgPixels + belowBand.cyanPixels;
          })
          .toBeGreaterThan(30);
      } finally {
        await close();
      }
    });

    test("T2-F11-02 reticle near left/right edge clamps pill safely inside canvas bounds", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: -2.0, dirY: 0 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
        const leftEdge = await sampleCanvasRegion(page, {
          x1: 0.0,
          y1: 0.35,
          x2: 0.15,
          y2: 0.55,
        });
        expect(leftEdge.cyanPixels).toBeGreaterThan(20);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F11-03 long label DOWN-RIGHT • CAL renders cleanly inside stage", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        await completeCalibration(page, server, "click");
        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.68,
              y1: 0.68,
              x2: 0.99,
              y2: 0.99,
            });
            return s.emeraldPixels;
          })
          .toBeGreaterThan(30);
      } finally {
        await close();
      }
    });

    test("T2-F11-04 blinking switches reticle and rays to amber #f59e0b", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
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
          .toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T2-F11-05 toggling Rays & Reticle OFF during NO LOCK succeeds with zero errors", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        const btn = page.getByTestId("toggle-showGazeRays");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F12 Boundaries: Layer 2 - 3x3 Zone Grid", () => {
    test("T2-F12-01 exact boundary screenX ~ 0.335 (LEFT) vs 0.345 (CENTER) moves sector highlight", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("smoothing-toggle").click();
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: -0.48, dirY: 0 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
        await expect
          .poll(async () => {
            const leftCell = await sampleCanvasRegion(page, {
              x1: 0.02,
              y1: 0.35,
              x2: 0.31,
              y2: 0.65,
            });
            return leftCell.cyanPixels;
          })
          .toBeGreaterThan(25);

        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: -0.42, dirY: 0 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      } finally {
        await close();
      }
    });

    test("T2-F12-02 during BLINK active grid sector switches highlight to amber", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.68,
              y1: 0.68,
              x2: 0.98,
              y2: 0.98,
            });
            return s.amberPixels;
          })
          .toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T2-F12-03 during NO LOCK grid draws zero highlight pixels", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        await expect
          .poll(async () => (await sampleCanvasRegion(page)).nonEmptyPixels)
          .toBe(0);
      } finally {
        await close();
      }
    });

    test("T2-F12-04 resizing stage preserves 1/3 grid proportions", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        await page.setViewportSize({ width: 960, height: 640 });
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.68,
              y1: 0.68,
              x2: 0.98,
              y2: 0.98,
            });
            return s.cyanPixels;
          })
          .toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T2-F12-05 rapid ON/OFF grid toggles keep grid aligned and clean", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showZoneGrid");
        for (let i = 0; i < 6; i++) {
          await btn.click();
        }
        await expect(btn).toHaveAttribute("aria-pressed", "true");
      } finally {
        await close();
      }
    });
  });

  test.describe("F13 Boundaries: Layer 3 - Thermal Heatmap", () => {
    test("T2-F13-01 faint cell (<0.04 relative intensity) is skipped cleanly", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("smoothing-toggle").click();
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.stopStream();
        // 1 frame in UP-LEFT vs 35 frames in DOWN-RIGHT -> 1/35 = 0.028 < 0.04
        server.sendFrame({ data: makeZoneGaze("UP-LEFT") });
        await server.pumpFrames(35, () => makeZoneGaze("DOWN-RIGHT"), 10);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        const faintCell = await sampleCanvasRegion(page, {
          x1: 0.02,
          y1: 0.02,
          x2: 0.22,
          y2: 0.22,
        });
        expect(faintCell.nonEmptyPixels).toBe(0);
      } finally {
        await close();
      }
    });

    test("T2-F13-02 concentration progression paints cyan -> yellow -> red thermal zones", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("smoothing-toggle").click();
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.stopStream();
        await server.pumpFrames(2, () => makeZoneGaze("UP-LEFT"), 12);
        await server.pumpFrames(5, () => makeZoneGaze("UP-RIGHT"), 12);
        await server.pumpFrames(12, () => makeZoneGaze("DOWN-RIGHT"), 12);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        const hot = await sampleCanvasRegion(page, {
          x1: 0.72,
          y1: 0.72,
          x2: 0.96,
          y2: 0.96,
        });
        const mid = await sampleCanvasRegion(page, {
          x1: 0.72,
          y1: 0.04,
          x2: 0.96,
          y2: 0.28,
        });
        expect(hot.redPixels).toBeGreaterThan(20);
        expect(mid.yellowPixels).toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T2-F13-03 blinking frames do not increment heatmap cell counts", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.stopStream();
        await page.getByTestId("clear-heatmap-button").click();
        await server.pumpFrames(15, () => makeBlinkFrame(), 15);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");

        const corner = await sampleCanvasRegion(page, {
          x1: 0.05,
          y1: 0.05,
          x2: 0.25,
          y2: 0.25,
        });
        expect(corner.nonEmptyPixels).toBe(0);
      } finally {
        await close();
      }
    });

    test("T2-F13-04 clamped gaze (0.99, 0.99) maps safely to cell (11,8) without errors", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: 2.2, dirY: 2.2 }),
        );
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );
        const corner = await sampleCanvasRegion(page, {
          x1: 0.92,
          y1: 0.9,
          x2: 0.99,
          y2: 0.99,
        });
        expect(corner.nonEmptyPixels).toBeGreaterThan(0);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F13-05 Clear zeroes all 108 bins immediately even while showHeatmap is OFF", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeZoneGaze("LEFT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
        await page.waitForTimeout(200);

        await page.getByTestId("toggle-showHeatmap").click();
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");

        await page.getByTestId("clear-heatmap-button").click();
        await page.getByTestId("toggle-showHeatmap").click();
        const leftBand = await sampleCanvasRegion(page, {
          x1: 0.05,
          y1: 0.42,
          x2: 0.25,
          y2: 0.58,
        });
        expect(leftBand.nonEmptyPixels).toBe(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F14 Boundaries: Layer 4 - Saccade Trail", () => {
    test("T2-F14-01 single-frame stream (trail.length === 1) draws safely with zero errors", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeZoneGaze("LEFT") });
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F14-02 stationary gaze across 30 frames renders without zero-length NaN", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        await server.pumpFrames(30, () => makeCenterGaze(), 12);
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.trail.length).toBeLessThanOrEqual(28);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F14-03 blinking freezes trail without pushing new points", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.stopStream();
        await page.getByTestId("clear-heatmap-button").click();
        await server.pumpFrames(4, () => makeZoneGaze("RIGHT"), 20);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
        const beforeSnap = await triggerExportSnapshot(page);

        await server.pumpFrames(8, () => makeBlinkFrame(), 20);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        const afterSnap = await triggerExportSnapshot(page);
        expect(afterSnap.payload.trail.length).toBe(
          beforeSnap.payload.trail.length,
        );
      } finally {
        await close();
      }
    });

    test("T2-F14-04 Reset calibration and Clear both empty saccade trail", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await server.pumpFrames(8, () => makeZoneGaze("LEFT"), 20);
        server.stopStream();
        await page.getByTestId("reset-calibration-button").click();
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.trail).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F14-05 large timestamp jump (dt > 1000 ms) keeps valid finite trail timestamps", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeCenterGaze(), timestampMs: 1000 });
        server.sendFrame({ data: makeZoneGaze("RIGHT"), timestampMs: 4500 });
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
        const { payload } = await triggerExportSnapshot(page);
        expect(
          payload.trail.every(
            (pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y),
          ),
        ).toBe(true);
      } finally {
        await close();
      }
    });
  });

  test.describe("F15 Boundaries: Layer 5 - Ocular Scope", () => {
    test("T2-F15-01 stage width < 280px hides Ocular Scope gracefully", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 270, height: 600 });
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeLessThan(280);
        const corner = await sampleCanvasRegion(page, {
          x1: 0.02,
          y1: 0.65,
          x2: 0.6,
          y2: 0.98,
        });
        expect(corner.darkBgPixels).toBe(0);
      } finally {
        await close();
      }
    });

    test("T2-F15-02 stage height < 200px hides Ocular Scope gracefully", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 700, height: 240 });
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("panel-toggle").click();
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        if (box!.height < 200) {
          const corner = await sampleCanvasRegion(page, {
            x1: 12,
            y1: Math.max(0, box!.height - 86),
            x2: 204,
            y2: box!.height - 12,
            normalized: false,
          });
          expect(corner.darkBgPixels).toBe(0);
        }
      } finally {
        await close();
      }
    });

    test("T2-F15-03 mirror ON vs OFF swaps L-EYE (cyan) and R-EYE (pink) slot sides", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        const leftSlot = {
          x1: 22,
          y1: box!.height - 65,
          x2: 96,
          y2: box!.height - 30,
          normalized: false,
        };
        const mirroredLeft = await sampleCanvasRegion(page, leftSlot);
        expect(mirroredLeft.cyanPixels).toBeGreaterThan(
          mirroredLeft.pinkPixels,
        );

        await page.getByTestId("mirror-toggle").click();
        await expect
          .poll(async () => {
            const unmirroredLeft = await sampleCanvasRegion(page, leftSlot);
            return unmirroredLeft.pinkPixels > unmirroredLeft.cyanPixels;
          })
          .toBe(true);
      } finally {
        await close();
      }
    });

    test("T2-F15-04 0% openness blink renders amber scope border without error", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        await expect
          .poll(async () => {
            const scope = await sampleCanvasRegion(page, {
              x1: 12,
              y1: box!.height - 86,
              x2: 204,
              y2: box!.height - 12,
              normalized: false,
            });
            return scope.amberPixels;
          })
          .toBeGreaterThan(15);
      } finally {
        await close();
      }
    });

    test("T2-F15-05 single valid eye renders Ocular Scope without crashing", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        const oneEye = makeCenterGaze();
        for (const idx of [33, 133, 159, 145, 468]) {
          oneEye.landmarks[idx] = [Number.NaN, Number.NaN, 0];
        }
        server.setStreamGenerator(() => oneEye);
        await page.waitForTimeout(200);
        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        const scope = await sampleCanvasRegion(page, {
          x1: 12,
          y1: box!.height - 86,
          x2: 204,
          y2: box!.height - 12,
          normalized: false,
        });
        expect(scope.cyanPixels).toBeGreaterThan(15);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F16 Boundaries: Layer 6 - Face Mesh", () => {
    test("T2-F16-01 enabling Face Mesh when faceDetected is false yields zero errors", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        await page.getByTestId("toggle-showFaceMesh").click();
        await expect(page.getByTestId("toggle-showFaceMesh")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F16-02 blackout Face Mesh renders denser intensity than overlay Face Mesh", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();
        await page.getByTestId("toggle-showFaceMesh").click();

        const chin = { x1: 0.42, y1: 0.56, x2: 0.58, y2: 0.72 };
        const overlayAct = await measureCanvasActivity(page, chin);
        await page.getByTestId("mode-blackout").click();
        const blackoutAct = await measureCanvasActivity(page, chin);
        expect(overlayAct.nonZeroAlphaPixels).toBeGreaterThan(20);
        expect(blackoutAct.rgbSum).toBeGreaterThan(overlayAct.rgbSum);
      } finally {
        await close();
      }
    });

    test("T2-F16-03 extreme head roll ±45 deg renders Face Mesh without clipping exception", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showFaceMesh").click();
        server.setStreamGenerator(() => makeHeadPoseFrame(0, 0, 45));
        await expect
          .poll(async () =>
            readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
          )
          .toContain("45.0°");
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F16-04 60 frames with 2556-edge Face Mesh stay responsive with 0 errors", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, { fps: 60 });
      try {
        await page.getByTestId("toggle-showFaceMesh").click();
        await server.pumpFrames(60, () => makeCenterGaze(), 10);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F16-05 toggling Face Mesh does not alter gaze coordinates", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const before = await readGazeCoordPercent(page);
        await page.getByTestId("toggle-showFaceMesh").click();
        const after = await readGazeCoordPercent(page);
        expect(after).toEqual(before);
      } finally {
        await close();
      }
    });
  });

  test.describe("F17 Boundaries: Live 2D Gaze Radar", () => {
    test("T2-F17-01 extreme top-left gaze (0.01, 0.01) clamps radar dot at left: 4%, top: 8%", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: -2.2, dirY: -2.2 }),
        );
        const dot = page.getByTestId("gaze-radar-dot");
        await expect
          .poll(async () => (await dot.getAttribute("style")) ?? "")
          .toMatch(/left:\s*4%;\s*top:\s*8%/);
      } finally {
        await close();
      }
    });

    test("T2-F17-02 extreme bottom-right gaze (0.99, 0.99) clamps radar dot at left: 96%, top: 92%", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() =>
          makeSyntheticFace({ dirX: 2.2, dirY: 2.2 }),
        );
        const dot = page.getByTestId("gaze-radar-dot");
        await expect
          .poll(async () => (await dot.getAttribute("style")) ?? "")
          .toMatch(/left:\s*96%;\s*top:\s*92%/);
      } finally {
        await close();
      }
    });

    test("T2-F17-03 during BLINK no 3x3 radar cell is highlighted and dot turns amber", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("gaze-zone-badge")).toHaveText("BLINK");
        await expect(page.getByTestId("gaze-radar-dot")).toHaveClass(
          /bg-amber-400/,
        );
        await expect(
          page
            .getByTestId("gaze-lab-section")
            .locator(".bg-cyan-500\\/20"),
        ).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T2-F17-04 on NO LOCK gaze-radar-dot unmounts from DOM", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("gaze-radar-dot")).toHaveCount(1);
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("gaze-radar-dot")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T2-F17-05 gaze-zone-badge matches hud-gaze-zone across transitions", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        for (const gen of [
          () => makeZoneGaze("UP-LEFT"),
          () => makeBlinkFrame(),
          () => makeNoFaceFrame(),
          () => makeZoneGaze("DOWN-RIGHT"),
        ]) {
          server.setStreamGenerator(gen);
          await expect
            .poll(async () => {
              const h = (
                await page.getByTestId("hud-gaze-zone").innerText()
              ).trim();
              const s = (
                await page.getByTestId("gaze-zone-badge").innerText()
              ).trim();
              return h === s ? h : "MISMATCH";
            })
            .not.toBe("MISMATCH");
        }
      } finally {
        await close();
      }
    });
  });

  test.describe("F18 Boundaries: Calibration & Clear Actions", () => {
    test("T2-F18-01 reset-calibration-button is disabled when uncalibrated", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const resetBtn = page.getByTestId("reset-calibration-button");
        await expect(resetBtn).toBeDisabled();
      } finally {
        await close();
      }
    });

    test("T2-F18-02 clicking Clear when heatmap and trail are already empty is a safe no-op", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeNoFaceFrame() });
        await page.getByTestId("clear-heatmap-button").click();
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.trail).toEqual([]);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F18-03 clicking start-calibration-button while calibrating restarts at step 1/5", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
        await page.getByTestId("start-calibration-button").click();
        await page.getByTestId("calibration-target-button").click();
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
        await page.getByTestId("start-calibration-button").click();
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(1/5)",
        );
      } finally {
        await close();
      }
    });

    test("T2-F18-04 Clear preserves calibration state and 5-PT CAL badge", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await page.getByTestId("clear-heatmap-button").click();
        await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
        await expect(page.getByTestId("control-panel")).toContainText(
          "CALIBRATED",
        );
      } finally {
        await close();
      }
    });

    test("T2-F18-05 Reset and Clear never alter blinkCount", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "2 BLINKS",
        );
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        await completeCalibration(page, server, "click");
        await page.getByTestId("clear-heatmap-button").click();
        await page.getByTestId("reset-calibration-button").click();
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "2 BLINKS",
        );
      } finally {
        await close();
      }
    });
  });

  test.describe("F19 Boundaries: Ocular Biometrics Grid", () => {
    test("T2-F19-01 extreme yaw ±90 deg clamps HEAD POSE Yaw to ±75.0 deg", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeHeadPoseFrame(90, 0, 0));
        await expect
          .poll(async () =>
            readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
          )
          .toMatch(/^75\.0°/);

        server.setStreamGenerator(() => makeHeadPoseFrame(-90, 0, 0));
        await expect
          .poll(async () =>
            readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
          )
          .toMatch(/^-75\.0°/);
      } finally {
        await close();
      }
    });

    test("T2-F19-02 extreme pitch ±90 deg clamps Pitch to ±60.0 deg", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeHeadPoseFrame(0, 90, 0));
        await expect
          .poll(async () =>
            readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
          )
          .toMatch(/\/\s*60\.0°\s*\//);

        server.setStreamGenerator(() => makeHeadPoseFrame(0, -90, 0));
        await expect
          .poll(async () =>
            readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
          )
          .toMatch(/\/\s*-60\.0°\s*\//);
      } finally {
        await close();
      }
    });

    test("T2-F19-03 extreme roll ±89 deg stays bounded within ±90.0 deg", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeHeadPoseFrame(0, 0, -89));
        await expect
          .poll(async () =>
            readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"),
          )
          .toMatch(/\/\s*-89\.0°$/);
      } finally {
        await close();
      }
    });

    test("T2-F19-04 fixation timer does not reset during transient blink-freeze", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.waitForTimeout(450);
        const before = Number(
          (await readBiometricTile(page, "BLINKS / FIXATION")).match(
            /(\d+\.\d)s$/,
          )?.[1] ?? 0,
        );
        expect(before).toBeGreaterThanOrEqual(0.3);

        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        await page.waitForTimeout(150);
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        const after = Number(
          (await readBiometricTile(page, "BLINKS / FIXATION")).match(
            /(\d+\.\d)s$/,
          )?.[1] ?? 0,
        );
        expect(after).toBeGreaterThanOrEqual(before);
      } finally {
        await close();
      }
    });

    test("T2-F19-05 neutral head pose renders 0.0° without negative zero (-0.0°)", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const pose = await readBiometricTile(
          page,
          "HEAD POSE (YAW / PITCH / ROLL)",
        );
        expect(pose).toBe("0.0° / 0.0° / 0.0°");
        expect(pose).not.toContain("-0.0");
      } finally {
        await close();
      }
    });
  });

  test.describe("F20 Boundaries: Sensitivity & Head Assist", () => {
    test("T2-F20-01 slider minimum boundaries (0.8x, 0.8x, 0%) clamp and display cleanly", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "gaze-sensitivity-x", 0.8);
        await setRangeValue(page, "gaze-sensitivity-y", 0.8);
        await setRangeValue(page, "gaze-head-comp", 0);
        const panel = page.getByTestId("control-panel");
        await expect(panel).toContainText("0.8x");
        await expect(panel).toContainText("0%");
      } finally {
        await close();
      }
    });

    test("T2-F20-02 slider maximum boundaries (4.0x, 4.0x, 100%) clamp and display cleanly", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "gaze-sensitivity-x", 4.0);
        await setRangeValue(page, "gaze-sensitivity-y", 4.0);
        await setRangeValue(page, "gaze-head-comp", 1);
        const panel = page.getByTestId("control-panel");
        await expect(panel).toContainText("4.0x");
        await expect(panel).toContainText("100%");
      } finally {
        await close();
      }
    });

    test("T2-F20-03 extreme 4.0x gain clamps screenX/Y inside [1%, 99%]", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "gaze-sensitivity-x", 4.0);
        await setRangeValue(page, "gaze-sensitivity-y", 4.0);
        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await page.waitForTimeout(250);
        const coord = await readGazeCoordPercent(page);
        expect(coord).not.toBeNull();
        expect(coord!.x).toBeLessThanOrEqual(99);
        expect(coord!.y).toBeLessThanOrEqual(99);
        expect(coord!.x).toBeGreaterThanOrEqual(1);
        expect(coord!.y).toBeGreaterThanOrEqual(1);
      } finally {
        await close();
      }
    });

    test("T2-F20-04 changing sensX/Y while CALIBRATED does not distort calibrated screenX/Y", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
        await page.waitForTimeout(220);
        const before = await readGazeCoordPercent(page);

        await setRangeValue(page, "gaze-sensitivity-x", 0.8);
        await setRangeValue(page, "gaze-sensitivity-y", 4.0);
        await page.waitForTimeout(220);
        const after = await readGazeCoordPercent(page);
        expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(
          3,
        );
      } finally {
        await close();
      }
    });

    test("T2-F20-05 headComp=0 completely ignores ±45 deg head yaw and pitch", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "gaze-head-comp", 0);
        server.setStreamGenerator(() => makeHeadPoseFrame(45, -45, 0));
        await page.waitForTimeout(240);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const coord = await readGazeCoordPercent(page);
        expect(coord!.x).toBeGreaterThanOrEqual(46);
        expect(coord!.x).toBeLessThanOrEqual(54);
        expect(coord!.y).toBeGreaterThanOrEqual(46);
        expect(coord!.y).toBeLessThanOrEqual(54);
      } finally {
        await close();
      }
    });
  });

  test.describe("F21 Boundaries: Display Mode & Mirror", () => {
    test("T2-F21-01 clicking mode-overlay when already overlay is idempotent", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("mode-overlay").click();
        await expect(page.getByTestId("mode-overlay")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      } finally {
        await close();
      }
    });

    test("T2-F21-02 clicking mode-blackout twice stays cleanly in blackout", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("mode-blackout").click();
        await page.getByTestId("mode-blackout").click();
        await expect(page.getByTestId("mode-blackout")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      } finally {
        await close();
      }
    });

    test("T2-F21-03 toggling mirror-toggle flips RIGHT (~85%) to LEFT (~15%)", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
        await expect
          .poll(async () => (await readGazeCoordPercent(page))?.x ?? 0)
          .toBeGreaterThan(78);

        await page.getByTestId("mirror-toggle").click();
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
        await expect
          .poll(async () => (await readGazeCoordPercent(page))?.x ?? 100)
          .toBeLessThan(22);
      } finally {
        await close();
      }
    });

    test("T2-F21-04 Blackout + NO LOCK still renders #05080f tactical grid", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        await page.getByTestId("mode-blackout").click();
        const stats = await sampleCanvasRegion(page);
        expect(stats.darkBgPixels).toBeGreaterThan(1000);
      } finally {
        await close();
      }
    });

    test("T2-F21-05 Blackout keeps eye-video opacity 0 as new JPEG frames stream in", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("mode-blackout").click();
        await server.pumpFrames(10, () => makeCenterGaze(), 25);
        const opacity = await page
          .getByTestId("eye-video")
          .evaluate((el) => Number(getComputedStyle(el).opacity));
        expect(opacity).toBe(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F22 Boundaries: Gaze Smoothing (One-Euro)", () => {
    test("T2-F22-01 strength 0.0 displays 0% and exports strength 0", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "smoothing-slider", 0);
        await expect(page.getByTestId("control-panel")).toContainText("0%");
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.smoothing).toEqual({ enabled: true, strength: 0 });
      } finally {
        await close();
      }
    });

    test("T2-F22-02 strength 1.0 displays 100% and applies strong damping", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "smoothing-slider", 1);
        await expect(page.getByTestId("control-panel")).toContainText("100%");
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.stopStream();
        server.sendFrame({ data: makeZoneGaze("RIGHT") });
        await page.waitForTimeout(140);
        const c = await readGazeCoordPercent(page);
        expect(c!.x).toBeLessThan(75);
      } finally {
        await close();
      }
    });

    test("T2-F22-03 disabling smoothing disables slider and resets trail", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await server.pumpFrames(8, () => makeCenterGaze(), 20);
        server.stopStream();
        await page.getByTestId("smoothing-toggle").click();
        await expect(page.getByTestId("smoothing-slider")).toBeDisabled();
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.trail).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F22-04 timestamp gap dt > 1000ms resets One-Euro smoother without NaN", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeCenterGaze(), timestampMs: 1000 });
        server.sendFrame({ data: makeZoneGaze("LEFT"), timestampMs: 3500 });
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
        const c = await readGazeCoordPercent(page);
        expect(Number.isFinite(c?.x)).toBe(true);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T2-F22-05 non-monotonic or duplicate timestamps (dt <= 0) never produce NaN", async ({
      page,
    }) => {
      const errors = attachErrorCollectors(page);
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeCenterGaze(), timestampMs: 2000 });
        server.sendFrame({ data: makeZoneGaze("UP"), timestampMs: 2000 });
        server.sendFrame({ data: makeZoneGaze("UP"), timestampMs: 1500 });
        await page.waitForTimeout(180);
        const c = await readGazeCoordPercent(page);
        expect(c).not.toBeNull();
        expect(Number.isFinite(c!.x)).toBe(true);
        expect(Number.isFinite(c!.y)).toBe(true);
        expect(errors.pageErrors).toEqual([]);
      } finally {
        await close();
      }
    });
  });

  test.describe("F23 Boundaries: Export Gaze Snapshot (JSON)", () => {
    test("T2-F23-01 export during NO LOCK produces valid JSON with gaze=null and trail=[]", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeNoFaceFrame() });
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.gaze).toBeNull();
        expect(payload.trail).toEqual([]);
        expect(payload.calibrated).toBe(false);
        expect(payload.calibration).toBeNull();
      } finally {
        await close();
      }
    });

    test("T2-F23-02 export when calibrated includes finite affine coefficients and sampleCount=5", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.calibrated).toBe(true);
        const cal = payload.calibration!;
        expect(cal.sampleCount).toBe(5);
        for (const k of ["ax0", "ax1", "ax2", "ay0", "ay1", "ay2"] as const) {
          expect(Number.isFinite(cal[k])).toBe(true);
        }
      } finally {
        await close();
      }
    });

    test("T2-F23-03 export after Reset has calibrated=false, calibration=null, trail=[] and preserved blinkCount", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        await completeCalibration(page, server, "click");
        server.stopStream();
        await page.getByTestId("reset-calibration-button").click();
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.calibrated).toBe(false);
        expect(payload.calibration).toBeNull();
        expect(payload.trail).toEqual([]);
        expect(payload.blinkCount).toBe(1);
      } finally {
        await close();
      }
    });

    test("T2-F23-04 export during active BLINK records gaze.isBlinking=true and frozen coordinates", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
        await page.waitForTimeout(150);

        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("BLINK");
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.gaze?.isBlinking).toBe(true);
        expect(payload.gaze?.zone).toBe("RIGHT");
      } finally {
        await close();
      }
    });

    test("T2-F23-05 two exports 50ms apart produce distinct timestampMs filenames", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const first = await triggerExportSnapshot(page);
        await page.waitForTimeout(60);
        const second = await triggerExportSnapshot(page);
        expect(second.filename).not.toBe(first.filename);
        expect(second.payload.timestampMs).toBeGreaterThan(
          first.payload.timestampMs,
        );
      } finally {
        await close();
      }
    });
  });

  test.describe("F24 Boundaries: Copyright Footer", () => {
    test("T2-F24-01 footer year range starts 2025– and end year >= 2026", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const txt = await page
          .getByTestId("app-copyright-footer")
          .innerText();
        const m = txt.match(/© 2025–(\d{4})/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(2026);
      } finally {
        await close();
      }
    });

    test("T2-F24-02 footer never overlaps eye-stage or control-panel at 1280x720 and 800x600", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        for (const vp of [
          { width: 1280, height: 720 },
          { width: 800, height: 600 },
        ]) {
          await page.setViewportSize(vp);
          const footerBox = await page
            .getByTestId("app-copyright-footer")
            .boundingBox();
          const stageBox = await page.getByTestId("eye-stage").boundingBox();
          expect(footerBox).not.toBeNull();
          expect(stageBox).not.toBeNull();
          expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(
            footerBox!.y + 1,
          );
        }
      } finally {
        await close();
      }
    });

    test("T2-F24-03 footer link hamzafpv.com.tr is visible and unobstructed", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const link = page
          .getByTestId("app-copyright-footer")
          .getByRole("link", { name: "hamzafpv.com.tr" });
        await expect(link).toBeVisible();
        const hitTest = await link.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const topEl = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return topEl === el || el.contains(topEl);
        });
        expect(hitTest).toBe(true);
      } finally {
        await close();
      }
    });

    test("T2-F24-04 panel copyright stays reachable via sidebar scroll on 600px height", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1024, height: 600 });
      const { close } = await bootHudSession(page);
      try {
        const panelLink = page
          .getByTestId("control-panel")
          .locator('a[href="https://hamzafpv.com.tr"]');
        await panelLink.scrollIntoViewIfNeeded();
        await expect(panelLink).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T2-F24-05 footer remains visible when status-overlay is active", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "error",
        streamInitialFrames: false,
      });
      try {
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        await expect(page.getByTestId("app-copyright-footer")).toBeVisible();
      } finally {
        await close();
      }
    });
  });
});
