import { expect, test } from "@playwright/test";
import {
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

test.describe("Tier 1: Feature Coverage (F01-F24)", () => {
  test.describe("F01: Top Header Branding", () => {
    test("T1-F01-01 root container uses #05080f cybernetic dark background", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const bg = await page
          .locator("div.h-dvh")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg).toBe("rgb(5, 8, 15)");
      } finally {
        await close();
      }
    });

    test("T1-F01-02 header renders Eye Gaze HUD V2.1 title", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const header = page.locator("header");
        await expect(header).toBeVisible();
        await expect(header.locator("h1")).toContainText("Eye Gaze HUD V2.1");
      } finally {
        await close();
      }
    });

    test("T1-F01-03 V2.1 version badge has pink accent styling", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const v21 = page.locator("header h1 span", { hasText: "V2.1" });
        await expect(v21).toBeVisible();
        const color = await v21.evaluate((el) => getComputedStyle(el).color);
        const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        expect(match).not.toBeNull();
        const r = Number(match![1]);
        const g = Number(match![2]);
        const b = Number(match![3]);
        expect(r).toBeGreaterThan(200);
        expect(b).toBeGreaterThan(150);
        expect(r).toBeGreaterThan(g);
      } finally {
        await close();
      }
    });

    test("T1-F01-04 header renders cybernetic Eye icon badge", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const iconSvg = page.locator("header svg").first();
        await expect(iconSvg).toBeVisible();
        const box = await iconSvg.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(8);
        expect(box!.height).toBeGreaterThan(8);
      } finally {
        await close();
      }
    });

    test("T1-F01-05 header stays visible during loading-model and ready states", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialStatus: "loading-model",
        streamInitialFrames: false,
      });
      try {
        await expect(page.locator("header")).toBeVisible();
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        server.sendStatus("ready", undefined, "GPU");
        server.startStream(() => makeCenterGaze());
        await expect(page.getByTestId("status-overlay")).toHaveCount(0);
        await expect(page.locator("header")).toBeVisible();
      } finally {
        await close();
      }
    });
  });

  test.describe("F02: Live Gaze Zone Badge", () => {
    test("T1-F02-01 displays NO LOCK before first face frame arrives", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialStatus: "ready",
        streamInitialFrames: false,
      });
      try {
        server.sendFrame({ data: makeNoFaceFrame() });
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
      } finally {
        await close();
      }
    });

    test("T1-F02-02 displays CENTER with cyan styling on centered gaze", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const badge = page.getByTestId("hud-gaze-zone");
        await expect(badge).toHaveText("CENTER");
        const color = await badge.evaluate((el) => getComputedStyle(el).color);
        const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        expect(m).not.toBeNull();
        expect(Number(m![3])).toBeGreaterThan(180);
      } finally {
        await close();
      }
    });

    test("T1-F02-03 cycles and displays all 8 outer gaze zones", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const outerZones: GazeZone[] = [
          "UP-LEFT",
          "UP",
          "UP-RIGHT",
          "LEFT",
          "RIGHT",
          "DOWN-LEFT",
          "DOWN",
          "DOWN-RIGHT",
        ];
        const badge = page.getByTestId("hud-gaze-zone");
        for (const zone of outerZones) {
          server.setStreamGenerator(() => makeZoneGaze(zone));
          await expect(badge).toHaveText(zone);
        }
      } finally {
        await close();
      }
    });

    test("T1-F02-04 displays BLINK with amber styling during bilateral blink", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const badge = page.getByTestId("hud-gaze-zone");
        await expect(badge).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(badge).toHaveText("BLINK");
        const color = await badge.evaluate((el) => getComputedStyle(el).color);
        const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThan(200);
        expect(Number(m![3])).toBeLessThan(170);
      } finally {
        await close();
      }
    });

    test("T1-F02-05 returns to CENTER after eyes reopen from blink", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const badge = page.getByTestId("hud-gaze-zone");
        await expect(badge).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(badge).toHaveText("BLINK");
        server.setStreamGenerator(() => makeCenterGaze());
        await expect(badge).toHaveText("CENTER");
      } finally {
        await close();
      }
    });
  });

  test.describe("F03: Blink Counter", () => {
    test("T1-F03-01 initializes to 0 BLINKS on session start", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "0 BLINKS",
        );
      } finally {
        await close();
      }
    });

    test("T1-F03-02 increments to 1 BLINKS on open-to-blink rising edge", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
      } finally {
        await close();
      }
    });

    test("T1-F03-03 increments to 3 BLINKS across 3 distinct blink cycles", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const blinkCounter = page.getByTestId("hud-blink-count");
        const zoneBadge = page.getByTestId("hud-gaze-zone");
        await expect(zoneBadge).toHaveText("CENTER");
        for (let i = 1; i <= 3; i++) {
          server.setStreamGenerator(() => makeBlinkFrame());
          await expect(blinkCounter).toHaveText(`${i} BLINKS`);
          server.setStreamGenerator(() => makeCenterGaze());
          await expect(zoneBadge).toHaveText("CENTER");
        }
      } finally {
        await close();
      }
    });

    test("T1-F03-04 blink counter uses emerald text styling", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const color = await page
          .getByTestId("hud-blink-count")
          .evaluate((el) => getComputedStyle(el).color);
        const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        expect(m).not.toBeNull();
        expect(Number(m![2])).toBeGreaterThan(190);
        expect(Number(m![1])).toBeLessThan(150);
      } finally {
        await close();
      }
    });

    test("T1-F03-05 preserves blink count when Clear heatmap/trail is clicked", async ({
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

        await page.getByTestId("clear-heatmap-button").click();
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
      } finally {
        await close();
      }
    });
  });

  test.describe("F04: 5-PT CAL Badge", () => {
    test("T1-F04-01 absent from DOM when uncalibrated", async ({ page }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T1-F04-02 remains absent mid-calibration before step 5 finishes", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(1/5)",
        );
        server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
        await page.getByTestId("calibration-target-button").click();
        await expect(page.getByTestId("calibration-overlay")).toContainText(
          "(2/5)",
        );
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T1-F04-03 appears with 5-PT CAL immediately after 5th target completes", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveText(
          "5-PT CAL",
        );
      } finally {
        await close();
      }
    });

    test("T1-F04-04 5-PT CAL badge uses emerald text styling", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        const color = await page
          .getByTestId("hud-calibrated-badge")
          .evaluate((el) => getComputedStyle(el).color);
        const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        expect(m).not.toBeNull();
        expect(Number(m![2])).toBeGreaterThan(190);
        expect(Number(m![1])).toBeLessThan(150);
      } finally {
        await close();
      }
    });

    test("T1-F04-05 disappears immediately after clicking reset-calibration-button", async ({
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
  });

  test.describe("F05: FPS, Latency & Delegate", () => {
    test("T1-F05-01 hud-fps renders non-negative integer updating during stream", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect
          .poll(async () => {
            const raw = (await page.getByTestId("hud-fps").innerText()).trim();
            return Number(raw);
          })
          .toBeGreaterThan(0);
      } finally {
        await close();
      }
    });

    test("T1-F05-02 hud-inference-ms formats latency to 1 decimal place", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, { inferenceMs: 4.24 });
      try {
        await expect(page.getByTestId("hud-inference-ms")).toHaveText("4.2 ms");
      } finally {
        await close();
      }
    });

    test("T1-F05-03 hud-delegate shows GPU when backend reports GPU", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, { initialDelegate: "GPU" });
      try {
        await waitForDelegate(page, "GPU");
      } finally {
        await close();
      }
    });

    test("T1-F05-04 hud-delegate updates to CPU when backend switches to CPU", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialDelegate: "GPU",
      });
      try {
        await waitForDelegate(page, "GPU");
        server.setStreamMeta({ delegate: "CPU" });
        await waitForDelegate(page, "CPU");
      } finally {
        await close();
      }
    });

    test("T1-F05-05 sidebar header delegate badge mirrors hud-delegate", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialDelegate: "GPU",
      });
      try {
        const panelHeader = page.getByTestId("control-panel");
        await expect(panelHeader).toContainText("GPU");
        server.setStreamMeta({ delegate: "CPU" });
        await waitForDelegate(page, "CPU");
        await expect(panelHeader).toContainText("CPU");
      } finally {
        await close();
      }
    });
  });

  test.describe("F06: Collapsible Panel Toggle", () => {
    test("T1-F06-01 panel starts open with Hide Panel label and aria-expanded=true", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("panel-toggle");
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(toggle).toContainText("Hide Panel");
        await expect(page.getByTestId("control-panel")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T1-F06-02 clicking panel-toggle hides control-panel", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("panel-toggle").click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
      } finally {
        await close();
      }
    });

    test("T1-F06-03 collapsed panel-toggle shows Controls and aria-expanded=false", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("panel-toggle");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(toggle).toContainText("Controls");
      } finally {
        await close();
      }
    });

    test("T1-F06-04 clicking panel-toggle twice restores control-panel visibility", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("panel-toggle");
        await toggle.click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await toggle.click();
        await expect(page.getByTestId("control-panel")).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
      } finally {
        await close();
      }
    });

    test("T1-F06-05 sidebar Collapse control panel chevron collapses panel and syncs header", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page
          .getByTestId("control-panel")
          .getByRole("button", { name: "Collapse control panel" })
          .click();
        await expect(page.getByTestId("control-panel")).toBeHidden();
        await expect(page.getByTestId("panel-toggle")).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      } finally {
        await close();
      }
    });
  });

  test.describe("F07: Aspect-Locked Video/Canvas Stage", () => {
    test("T1-F07-01 mounts eye-stage, eye-video, and eye-canvas inside main", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.locator("main").getByTestId("eye-stage")).toBeVisible();
        await expect(page.locator("main").getByTestId("eye-video")).toBeVisible();
        await expect(page.locator("main").getByTestId("eye-canvas")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T1-F07-02 defaults to 4:3 aspect ratio before 16:9 frame arrives", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "ready",
        streamInitialFrames: false,
      });
      try {
        const box = await page.getByTestId("eye-stage").boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width / box!.height).toBeCloseTo(4 / 3, 1);
      } finally {
        await close();
      }
    });

    test("T1-F07-03 updates stage aspect ratio to 16:9 when 1280x720 frames arrive", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
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
      } finally {
        await close();
      }
    });

    test("T1-F07-04 scales eye-canvas backing buffer with devicePixelRatio", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      const { close } = await bootHudSession(page);
      try {
        await expect
          .poll(async () => {
            return page.evaluate(() => {
              const canvas = document.querySelector<HTMLCanvasElement>(
                '[data-testid="eye-canvas"]',
              );
              if (!canvas) return 0;
              const rect = canvas.getBoundingClientRect();
              return rect.width > 0 ? canvas.width / rect.width : 0;
            });
          })
          .toBeCloseTo(2, 1);
      } finally {
        await close();
        await context.close();
      }
    });

    test("T1-F07-05 stage expands cleanly when right sidebar is collapsed", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const before = await page.getByTestId("eye-stage").boundingBox();
        expect(before).not.toBeNull();
        await page.getByTestId("panel-toggle").click();
        await expect
          .poll(async () => {
            const after = await page.getByTestId("eye-stage").boundingBox();
            return after ? after.width : 0;
          })
          .toBeGreaterThan(before!.width + 100);
      } finally {
        await close();
      }
    });
  });

  test.describe("F08: Camera/Engine Status & Retry", () => {
    test("T1-F08-01 requesting-camera shows Requesting Camera Access without retry-button", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "requesting-camera",
        streamInitialFrames: false,
      });
      try {
        const overlay = page.getByTestId("status-overlay");
        await expect(overlay).toBeVisible();
        await expect(overlay).toContainText("Requesting Camera Access");
        await expect(overlay).toHaveAttribute("role", "status");
        await expect(page.getByTestId("retry-button")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T1-F08-02 loading-model shows Initializing Eye & Iris Engine without retry-button", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page, {
        initialStatus: "loading-model",
        streamInitialFrames: false,
      });
      try {
        const overlay = page.getByTestId("status-overlay");
        await expect(overlay).toBeVisible();
        await expect(overlay).toContainText("Initializing Eye & Iris Engine");
        await expect(overlay).toHaveAttribute("role", "status");
        await expect(page.getByTestId("retry-button")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T1-F08-03 all four error statuses display exact title and retry-button", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialStatus: "permission-denied",
        streamInitialFrames: false,
      });
      try {
        const expected: Array<[
          "permission-denied" | "no-camera" | "camera-busy" | "error",
          string,
        ]> = [
          ["permission-denied", "Camera Permission Denied"],
          ["no-camera", "No Camera Detected"],
          ["camera-busy", "Camera Busy"],
          ["error", "Eye Tracking Pipeline Error"],
        ];

        const overlay = page.getByTestId("status-overlay");
        for (const [status, titleFragment] of expected) {
          server.sendStatus(status);
          await expect(overlay).toHaveAttribute("role", "alert");
          await expect(overlay).toContainText(titleFragment);
          await expect(page.getByTestId("retry-button")).toBeVisible();
        }
      } finally {
        await close();
      }
    });

    test("T1-F08-04 clicking retry-button sends retry_camera command over WebSocket", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialStatus: "camera-busy",
        streamInitialFrames: false,
      });
      try {
        const cmdPromise = server.waitForCommand("retry_camera");
        await page.getByTestId("retry-button").click();
        const cmd = await cmdPromise;
        expect(cmd.type).toBe("retry_camera");
      } finally {
        await close();
      }
    });

    test("T1-F08-05 transitioning to ready unmounts status-overlay", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page, {
        initialStatus: "camera-busy",
        autoRecoverOnRetry: true,
        streamInitialFrames: false,
      });
      try {
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        await page.getByTestId("retry-button").click();
        await expect(page.getByTestId("status-overlay")).toHaveCount(0);
        server.startStream(() => makeCenterGaze());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
      } finally {
        await close();
      }
    });
  });

  test.describe("F09: 5-Point Calibration Overlay", () => {
    test("T1-F09-01 opens calibration-overlay on step 1/5 Merkez (Center) at (50%, 50%)", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        const overlay = page.getByTestId("calibration-overlay");
        await expect(overlay).toBeVisible();
        await expect(overlay).toContainText(
          "5-Point Gaze Calibration (1/5) — Merkez (Center)",
        );
        const target = page.getByTestId("calibration-target-button");
        await expect(target).toHaveAttribute("style", /left:\s*50%.*top:\s*50%/);
      } finally {
        await close();
      }
    });

    test("T1-F09-02 clicking target button steps sequentially through all 5 positions", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const expectedSteps = [
          { label: "Merkez (Center)", left: "50%", top: "50%" },
          { label: "Sol Üst (Top-Left)", left: "14%", top: "16%" },
          { label: "Sağ Üst (Top-Right)", left: "86%", top: "16%" },
          { label: "Sağ Alt (Bottom-Right)", left: "86%", top: "84%" },
          { label: "Sol Alt (Bottom-Left)", left: "14%", top: "84%" },
        ];
        await page.getByTestId("start-calibration-button").click();

        for (let i = 0; i < expectedSteps.length; i++) {
          const step = expectedSteps[i]!;
          server.setStreamGenerator(() => makeCalibrationTargetGaze(i));
          await expect(page.getByTestId("calibration-overlay")).toContainText(
            `(${i + 1}/5) — ${step.label}`,
          );
          const target = page.getByTestId("calibration-target-button");
          const style = (await target.getAttribute("style")) ?? "";
          expect(style).toContain(`left: ${step.left}`);
          expect(style).toContain(`top: ${step.top}`);
          await page.waitForTimeout(100);
          await target.click();
        }
        await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
        await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T1-F09-03 pressing Space captures targets and completes calibration", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "space");
        await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
      } finally {
        await close();
      }
    });

    test("T1-F09-04 pressing Escape cancels calibration overlay", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        await expect(page.getByTestId("calibration-overlay")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
      } finally {
        await close();
      }
    });

    test("T1-F09-05 clicking calibration-cancel-button cancels overlay", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("start-calibration-button").click();
        const cancelBtn = page.getByTestId("calibration-cancel-button");
        await expect(cancelBtn).toHaveText("Cancel (ESC)");
        await cancelBtn.click();
        await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F10: Base Ocular Wireframe", () => {
    test("T1-F10-01 renders non-transparent iris and eyelid pixels in overlay mode", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        // Disable extra HUD layers so only base ocular wireframe remains
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const stats = await sampleCanvasRegion(page, {
          x1: 0.3,
          y1: 0.3,
          x2: 0.7,
          y2: 0.55,
        });
        expect(stats.nonEmptyPixels).toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T1-F10-02 renders ocular wireframe and face oval in blackout mode", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("mode-blackout").click();
        const stats = await sampleCanvasRegion(page);
        expect(stats.darkBgPixels).toBeGreaterThan(1000);
        expect(stats.cyanPixels).toBeGreaterThan(50);
        expect(stats.pinkPixels).toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T1-F10-03 renders pink right-eye and cyan left-eye wireframe pixels", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const eyeBand = await sampleCanvasRegion(page, {
          x1: 0.3,
          y1: 0.32,
          x2: 0.7,
          y2: 0.52,
        });
        expect(eyeBand.cyanPixels).toBeGreaterThan(15);
        expect(eyeBand.pinkPixels).toBeGreaterThan(15);
      } finally {
        await close();
      }
    });

    test("T1-F10-04 renders bright #f8fafc pupil cores at iris centers", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const eyeBand = await sampleCanvasRegion(page, {
          x1: 0.32,
          y1: 0.36,
          x2: 0.68,
          y2: 0.48,
        });
        expect(eyeBand.brightWhitePixels).toBeGreaterThan(4);
      } finally {
        await close();
      }
    });

    test("T1-F10-05 clears ocular wireframe pixels when faceDetected drops to false", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page);
            return s.nonEmptyPixels;
          })
          .toBe(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F11: Layer 1 - Rays & Reticle", () => {
    test("T1-F11-01 defaults to aria-pressed=true with bullet label", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showGazeRays");
        await expect(btn).toHaveAttribute("aria-pressed", "true");
        await expect(btn).toHaveText("● Rays & Reticle");
      } finally {
        await close();
      }
    });

    test("T1-F11-02 toggling off updates aria-pressed=false and hollow circle label", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showGazeRays");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        await expect(btn).toHaveText("○ Rays & Reticle");
      } finally {
        await close();
      }
    });

    test("T1-F11-03 renders reticle and upright pill near gaze target when ON", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();
        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.7,
              y1: 0.7,
              x2: 0.99,
              y2: 0.99,
            });
            return s.cyanPixels + s.brightWhitePixels;
          })
          .toBeGreaterThan(25);
      } finally {
        await close();
      }
    });

    test("T1-F11-04 removes reticle pixels in target sector when toggled OFF", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();
        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        await page.getByTestId("toggle-showGazeRays").click();
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.7,
              y1: 0.7,
              x2: 0.99,
              y2: 0.99,
            });
            return s.nonEmptyPixels;
          })
          .toBe(0);
      } finally {
        await close();
      }
    });

    test("T1-F11-05 reticle accent shifts cyan -> emerald when calibrated -> amber when blinking", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        await completeCalibration(page, server, "click");
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.35,
              y1: 0.35,
              x2: 0.65,
              y2: 0.65,
            });
            return s.emeraldPixels;
          })
          .toBeGreaterThan(15);

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
          .toBeGreaterThan(15);
      } finally {
        await close();
      }
    });
  });

  test.describe("F12: Layer 2 - 3x3 Zone Grid", () => {
    test("T1-F12-01 defaults to aria-pressed=true with bullet label", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showZoneGrid");
        await expect(btn).toHaveAttribute("aria-pressed", "true");
        await expect(btn).toHaveText("● 3x3 Zone Grid");
      } finally {
        await close();
      }
    });

    test("T1-F12-02 toggling off updates aria-pressed=false and label", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showZoneGrid");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        await expect(btn).toHaveText("○ 3x3 Zone Grid");
      } finally {
        await close();
      }
    });

    test("T1-F12-03 renders active sector highlight inside 3x3 grid when ON", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        // Top-right corner of center cell (0.65, 0.35) has border + fill only when zone grid is ON
        const onStats = await sampleCanvasRegion(page, {
          x1: 0.34,
          y1: 0.6,
          x2: 0.66,
          y2: 0.66,
        });
        expect(onStats.cyanPixels).toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T1-F12-04 active sector highlight moves from CENTER to UP-RIGHT", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeZoneGaze("UP-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-RIGHT");

        await expect
          .poll(async () => {
            const topRight = await sampleCanvasRegion(page, {
              x1: 0.68,
              y1: 0.02,
              x2: 0.98,
              y2: 0.32,
            });
            return topRight.cyanPixels;
          })
          .toBeGreaterThan(40);
      } finally {
        await close();
      }
    });

    test("T1-F12-05 clears 3x3 grid border and fill pixels when toggled OFF", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();
        server.setStreamGenerator(() => makeZoneGaze("UP-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-RIGHT");

        await page.getByTestId("toggle-showZoneGrid").click();
        await expect
          .poll(async () => {
            const topRight = await sampleCanvasRegion(page, {
              x1: 0.68,
              y1: 0.02,
              x2: 0.98,
              y2: 0.32,
            });
            return topRight.nonEmptyPixels;
          })
          .toBe(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F13: Layer 3 - Thermal Heatmap", () => {
    test("T1-F13-01 defaults to aria-pressed=true with ● Heatmap", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showHeatmap");
        await expect(btn).toHaveAttribute("aria-pressed", "true");
        await expect(btn).toHaveText("● Heatmap");
      } finally {
        await close();
      }
    });

    test("T1-F13-02 toggling off updates aria-pressed=false and ○ Heatmap", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showHeatmap");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        await expect(btn).toHaveText("○ Heatmap");
      } finally {
        await close();
      }
    });

    test("T1-F13-03 dwelling in LEFT zone paints hot red thermal cell", async ({
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

        await expect
          .poll(async () => {
            const leftBand = await sampleCanvasRegion(page, {
              x1: 0.05,
              y1: 0.42,
              x2: 0.25,
              y2: 0.58,
            });
            return leftBand.redPixels;
          })
          .toBeGreaterThan(50);
      } finally {
        await close();
      }
    });

    test("T1-F13-04 toggling OFF hides heatmap while preserving accumulated counts", async ({
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
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.05,
              y1: 0.42,
              x2: 0.25,
              y2: 0.58,
            });
            return s.redPixels;
          })
          .toBeGreaterThan(50);

        await page.getByTestId("toggle-showHeatmap").click();
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.05,
              y1: 0.42,
              x2: 0.25,
              y2: 0.58,
            });
            return s.redPixels;
          })
          .toBe(0);

        await page.getByTestId("toggle-showHeatmap").click();
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.05,
              y1: 0.42,
              x2: 0.25,
              y2: 0.58,
            });
            return s.redPixels;
          })
          .toBeGreaterThan(50);
      } finally {
        await close();
      }
    });

    test("T1-F13-05 clicking clear-heatmap-button wipes accumulated thermal pixels", async ({
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
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.05,
              y1: 0.42,
              x2: 0.25,
              y2: 0.58,
            });
            return s.redPixels;
          })
          .toBeGreaterThan(50);

        // Move gaze elsewhere and clear heatmap so LEFT sector becomes completely empty
        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("NO LOCK");
        await page.getByTestId("clear-heatmap-button").click();
        await expect
          .poll(async () => {
            const s = await sampleCanvasRegion(page, {
              x1: 0.05,
              y1: 0.42,
              x2: 0.25,
              y2: 0.58,
            });
            return s.nonEmptyPixels;
          })
          .toBe(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F14: Layer 4 - Saccade Trail", () => {
    test("T1-F14-01 defaults to aria-pressed=true with ● Saccade Trail", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showTrail");
        await expect(btn).toHaveAttribute("aria-pressed", "true");
        await expect(btn).toHaveText("● Saccade Trail");
      } finally {
        await close();
      }
    });

    test("T1-F14-02 toggling off updates aria-pressed=false and ○ Saccade Trail", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showTrail");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        await expect(btn).toHaveText("○ Saccade Trail");
      } finally {
        await close();
      }
    });

    test("T1-F14-03 sweeping gaze LEFT to RIGHT renders cyan trail segments", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeZoneGaze("DOWN-LEFT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("DOWN-LEFT");
        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        await expect
          .poll(async () => {
            const lowerBridge = await sampleCanvasRegion(page, {
              x1: 0.25,
              y1: 0.72,
              x2: 0.75,
              y2: 0.92,
            });
            return lowerBridge.cyanPixels;
          })
          .toBeGreaterThan(20);
      } finally {
        await close();
      }
    });

    test("T1-F14-04 toggling OFF hides trail strokes", async ({ page }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        server.setStreamGenerator(() => makeZoneGaze("DOWN-LEFT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("DOWN-LEFT");
        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText(
          "DOWN-RIGHT",
        );

        await page.getByTestId("toggle-showTrail").click();
        await expect
          .poll(async () => {
            const lowerBridge = await sampleCanvasRegion(page, {
              x1: 0.25,
              y1: 0.72,
              x2: 0.75,
              y2: 0.92,
            });
            return lowerBridge.nonEmptyPixels;
          })
          .toBe(0);
      } finally {
        await close();
      }
    });

    test("T1-F14-05 exported trail array caps at <= 28 points after 50+ frames", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await server.pumpFrames(
          50,
          (seq) =>
            makeSyntheticFace({
              dirX: Math.sin(seq * 0.25),
              dirY: Math.cos(seq * 0.25),
            }),
          15,
        );
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.trail.length).toBeGreaterThan(10);
        expect(payload.trail.length).toBeLessThanOrEqual(28);
      } finally {
        await close();
      }
    });
  });

  test.describe("F15: Layer 5 - Ocular Scope", () => {
    test("T1-F15-01 defaults to aria-pressed=true with ● Ocular Scope", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showEyeMagnifier");
        await expect(btn).toHaveAttribute("aria-pressed", "true");
        await expect(btn).toHaveText("● Ocular Scope");
      } finally {
        await close();
      }
    });

    test("T1-F15-02 toggling off updates aria-pressed=false and ○ Ocular Scope", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showEyeMagnifier");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        await expect(btn).toHaveText("○ Ocular Scope");
      } finally {
        await close();
      }
    });

    test("T1-F15-03 renders Ocular Scope HUD in bottom-left box when ON", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        const stats = await sampleCanvasRegion(page, {
          x1: 12,
          y1: box!.height - 86,
          x2: 204,
          y2: box!.height - 12,
          normalized: false,
        });
        expect(stats.cyanPixels).toBeGreaterThan(30);
        expect(stats.darkBgPixels).toBeGreaterThan(200);
      } finally {
        await close();
      }
    });

    test("T1-F15-04 removes bottom-left Ocular Scope HUD when toggled OFF", async ({
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
        await page.getByTestId("toggle-showEyeMagnifier").click();

        await expect
          .poll(async () => {
            const stats = await sampleCanvasRegion(page, {
              x1: 12,
              y1: box!.height - 86,
              x2: 204,
              y2: box!.height - 12,
              normalized: false,
            });
            return stats.nonEmptyPixels;
          })
          .toBe(0);
      } finally {
        await close();
      }
    });

    test("T1-F15-05 reducing eye openness visibly alters scope ellipse rendering", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");

        const box = await page.getByTestId("eye-canvas").boundingBox();
        expect(box).not.toBeNull();
        const region = {
          x1: 12,
          y1: box!.height - 86,
          x2: 204,
          y2: box!.height - 12,
          normalized: false,
        };
        const openActivity = await measureCanvasActivity(page, region);

        server.setStreamGenerator(() =>
          makeSyntheticFace({ leftOpenness: 30, rightOpenness: 30 }),
        );
        await expect
          .poll(async () => readBiometricTile(page, "LEFT IRIS (hx, hy)"))
          .toMatch(/•\s*(3\d|40)%/);

        const squintActivity = await measureCanvasActivity(page, region);
        expect(squintActivity.rgbSum).not.toBe(openActivity.rgbSum);
      } finally {
        await close();
      }
    });
  });

  test.describe("F16: Layer 6 - Face Mesh", () => {
    test("T1-F16-01 defaults to aria-pressed=false with ○ Face Mesh", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showFaceMesh");
        await expect(btn).toHaveAttribute("aria-pressed", "false");
        await expect(btn).toHaveText("○ Face Mesh");
      } finally {
        await close();
      }
    });

    test("T1-F16-02 toggling ON sets aria-pressed=true and ● Face Mesh", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("toggle-showFaceMesh");
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "true");
        await expect(btn).toHaveText("● Face Mesh");
      } finally {
        await close();
      }
    });

    test("T1-F16-03 toggling ON renders tesselation wireframe pixels across face region", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const lowerFaceRegion = { x1: 0.38, y1: 0.56, x2: 0.62, y2: 0.74 };
        const before = await sampleCanvasRegion(page, lowerFaceRegion);
        expect(before.nonEmptyPixels).toBe(0);

        await page.getByTestId("toggle-showFaceMesh").click();
        await expect
          .poll(async () => {
            const after = await sampleCanvasRegion(page, lowerFaceRegion);
            return after.cyanPixels;
          })
          .toBeGreaterThan(40);
      } finally {
        await close();
      }
    });

    test("T1-F16-04 toggling OFF removes tesselation pixels while preserving eyelids", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const lowerFaceRegion = { x1: 0.38, y1: 0.56, x2: 0.62, y2: 0.74 };
        await page.getByTestId("toggle-showFaceMesh").click();
        await expect
          .poll(async () => (await sampleCanvasRegion(page, lowerFaceRegion)).cyanPixels)
          .toBeGreaterThan(40);

        await page.getByTestId("toggle-showFaceMesh").click();
        await expect
          .poll(async () => (await sampleCanvasRegion(page, lowerFaceRegion)).nonEmptyPixels)
          .toBe(0);
        const eyes = await sampleCanvasRegion(page, {
          x1: 0.32,
          y1: 0.36,
          x2: 0.68,
          y2: 0.48,
        });
        expect(eyes.nonEmptyPixels).toBeGreaterThan(15);
      } finally {
        await close();
      }
    });

    test("T1-F16-05 Face Mesh renders visibly in both overlay and blackout modes", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await page.getByTestId("toggle-showGazeRays").click();
        await page.getByTestId("toggle-showZoneGrid").click();
        await page.getByTestId("toggle-showHeatmap").click();
        await page.getByTestId("toggle-showTrail").click();
        await page.getByTestId("toggle-showEyeMagnifier").click();

        const chinRegion = { x1: 0.42, y1: 0.56, x2: 0.58, y2: 0.72 };
        await page.getByTestId("mode-blackout").click();
        const baselineBlackout = await measureCanvasActivity(page, chinRegion);

        await page.getByTestId("toggle-showFaceMesh").click();
        await expect
          .poll(async () => {
            const withMesh = await measureCanvasActivity(page, chinRegion);
            return withMesh.rgbSum - baselineBlackout.rgbSum;
          })
          .toBeGreaterThan(500);
      } finally {
        await close();
      }
    });
  });

  test.describe("F17: Live 2D Gaze Radar", () => {
    test("T1-F17-01 renders 9 matrix cells UPLEFT through CTR to DOWNRIGHT", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const section = page.getByTestId("gaze-lab-section");
        for (const label of [
          "UPLEFT",
          "UP",
          "UPRIGHT",
          "LEFT",
          "CTR",
          "RIGHT",
          "DOWNLEFT",
          "DOWN",
          "DOWNRIGHT",
        ]) {
          await expect(section.getByText(label, { exact: true })).toBeVisible();
        }
      } finally {
        await close();
      }
    });

    test("T1-F17-02 gaze-zone-badge reflects CENTER, UP-RIGHT, BLINK, and NO LOCK", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const badge = page.getByTestId("gaze-zone-badge");
        await expect(badge).toHaveText("CENTER");

        server.setStreamGenerator(() => makeZoneGaze("UP-RIGHT"));
        await expect(badge).toHaveText("UP-RIGHT");

        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(badge).toHaveText("BLINK");

        server.setStreamGenerator(() => makeNoFaceFrame());
        await expect(badge).toHaveText("NO LOCK");
      } finally {
        await close();
      }
    });

    test("T1-F17-03 active radar cell highlights with cyan background matching zone", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const section = page.getByTestId("gaze-lab-section");
        await expect(section.getByText("CTR", { exact: true })).toHaveClass(
          /bg-cyan-500\/20/,
        );

        server.setStreamGenerator(() => makeZoneGaze("DOWN-LEFT"));
        await expect(section.getByText("DOWNLEFT", { exact: true })).toHaveClass(
          /bg-cyan-500\/20/,
        );
        await expect(
          section.getByText("CTR", { exact: true }),
        ).not.toHaveClass(/bg-cyan-500\/20/);
      } finally {
        await close();
      }
    });

    test("T1-F17-04 gaze-radar-dot left% and top% track gaze movement", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const dot = page.getByTestId("gaze-radar-dot");
        await expect(dot).toBeVisible();

        server.setStreamGenerator(() => makeZoneGaze("UP-LEFT"));
        await expect(page.getByTestId("gaze-zone-badge")).toHaveText("UP-LEFT");
        const upLeftStyle = (await dot.getAttribute("style")) ?? "";
        const left1 = Number(upLeftStyle.match(/left:\s*([\d.]+)%/)?.[1]);
        const top1 = Number(upLeftStyle.match(/top:\s*([\d.]+)%/)?.[1]);

        server.setStreamGenerator(() => makeZoneGaze("DOWN-RIGHT"));
        await expect(page.getByTestId("gaze-zone-badge")).toHaveText(
          "DOWN-RIGHT",
        );
        await expect
          .poll(async () => {
            const s = (await dot.getAttribute("style")) ?? "";
            return Number(s.match(/left:\s*([\d.]+)%/)?.[1] ?? 0);
          })
          .toBeGreaterThan(left1 + 30);

        const downRightStyle = (await dot.getAttribute("style")) ?? "";
        const top2 = Number(downRightStyle.match(/top:\s*([\d.]+)%/)?.[1]);
        expect(top2).toBeGreaterThan(top1 + 30);
      } finally {
        await close();
      }
    });

    test("T1-F17-05 radar dot shifts cyan -> emerald when calibrated -> amber on blink", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const dot = page.getByTestId("gaze-radar-dot");
        await expect(dot).toHaveClass(/bg-cyan-400/);

        await completeCalibration(page, server, "click");
        await expect(dot).toHaveClass(/bg-emerald-400/);

        server.setStreamGenerator(() => makeBlinkFrame());
        await expect(dot).toHaveClass(/bg-amber-400/);
      } finally {
        await close();
      }
    });
  });

  test.describe("F18: Calibration & Clear Actions", () => {
    test("T1-F18-01 start-calibration-button label transitions 5-Pt Calibrate -> Calibrating... -> Recalibrate 5-Pt", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const btn = page.getByTestId("start-calibration-button");
        await expect(btn).toContainText("5-Pt Calibrate");
        await btn.click();
        await expect(btn).toContainText("Calibrating...");
        await page.keyboard.press("Escape");
        await expect(btn).toContainText("5-Pt Calibrate");

        await completeCalibration(page, server, "click");
        await expect(btn).toContainText("Recalibrate 5-Pt");
      } finally {
        await close();
      }
    });

    test("T1-F18-02 reset-calibration-button starts disabled and enables after calibration", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const resetBtn = page.getByTestId("reset-calibration-button");
        await expect(resetBtn).toBeDisabled();
        await completeCalibration(page, server, "click");
        await expect(resetBtn).toBeEnabled();
      } finally {
        await close();
      }
    });

    test("T1-F18-03 clicking Reset removes 5-PT CAL and reverts sensitivity badge to MANUAL", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await completeCalibration(page, server, "click");
        await expect(page.getByTestId("control-panel")).toContainText(
          "CALIBRATED",
        );
        await page.getByTestId("reset-calibration-button").click();
        await expect(page.getByTestId("hud-calibrated-badge")).toHaveCount(0);
        await expect(page.getByTestId("control-panel")).toContainText("MANUAL");
        await expect(
          page.getByTestId("reset-calibration-button"),
        ).toBeDisabled();
      } finally {
        await close();
      }
    });

    test("T1-F18-04 clear-heatmap-button empties trail in snapshot and clears heatmap", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await server.pumpFrames(12, () => makeZoneGaze("RIGHT"), 20);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");

        server.stopStream();
        await page.getByTestId("clear-heatmap-button").click();
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.trail).toEqual([]);
      } finally {
        await close();
      }
    });

    test("T1-F18-05 both Reset and Clear preserve accumulated blinkCount", async ({
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
        await page.getByTestId("clear-heatmap-button").click();
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
        await page.getByTestId("reset-calibration-button").click();
        await expect(page.getByTestId("hud-blink-count")).toHaveText(
          "1 BLINKS",
        );
      } finally {
        await close();
      }
    });
  });

  test.describe("F19: Ocular Biometrics Grid", () => {
    test("T1-F19-01 formats LEFT IRIS and RIGHT IRIS as hx, hy • openness%", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const left = await readBiometricTile(page, "LEFT IRIS (hx, hy)");
        const right = await readBiometricTile(page, "RIGHT IRIS (hx, hy)");
        expect(left).toMatch(/^\d+\.\d{2},\s*\d+\.\d{2}\s*•\s*\d+%$/);
        expect(right).toMatch(/^\d+\.\d{2},\s*\d+\.\d{2}\s*•\s*\d+%$/);
      } finally {
        await close();
      }
    });

    test("T1-F19-02 formats BLINKS / FIXATION as N blinks • S.Ss", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const tile = await readBiometricTile(page, "BLINKS / FIXATION");
        expect(tile).toMatch(/^\d+ blinks • \d+\.\ds$/);
      } finally {
        await close();
      }
    });

    test("T1-F19-03 fixation timer increments while steady and resets on zone change", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        await expect
          .poll(async () => {
            const t = await readBiometricTile(page, "BLINKS / FIXATION");
            const m = t.match(/(\d+\.\d)s$/);
            return m ? Number(m[1]) : 0;
          })
          .toBeGreaterThanOrEqual(0.4);

        server.setStreamGenerator(() => makeZoneGaze("UP-LEFT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("UP-LEFT");
        const afterSwitch = await readBiometricTile(page, "BLINKS / FIXATION");
        const secAfter = Number(afterSwitch.match(/(\d+\.\d)s$/)?.[1] ?? 99);
        expect(secAfter).toBeLessThan(0.4);
      } finally {
        await close();
      }
    });

    test("T1-F19-04 formats GAZE COORD (X, Y) percentages matching zone", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const center = await readGazeCoordPercent(page);
        expect(center).not.toBeNull();
        expect(center!.x).toBeGreaterThanOrEqual(40);
        expect(center!.x).toBeLessThanOrEqual(60);

        server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");
        await expect
          .poll(async () => (await readGazeCoordPercent(page))?.x ?? 0)
          .toBeGreaterThan(70);
      } finally {
        await close();
      }
    });

    test("T1-F19-05 displays HEAD POSE (YAW / PITCH / ROLL) matching injected angles", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeHeadPoseFrame(-20, 15, 10));
        await expect
          .poll(async () => readBiometricTile(page, "HEAD POSE (YAW / PITCH / ROLL)"))
          .toMatch(/^-20\.0°\s*\/\s*15\.0°\s*\/\s*10\.0°$/);
      } finally {
        await close();
      }
    });
  });

  test.describe("F20: Sensitivity & Head-Pose Assist", () => {
    test("T1-F20-01 defaults to Horizontal Gain 2.2x, Vertical Gain 2.4x, Head-Pose Assist 40%", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("gaze-sensitivity-x")).toHaveValue("2.2");
        await expect(page.getByTestId("gaze-sensitivity-y")).toHaveValue("2.4");
        await expect(page.getByTestId("gaze-head-comp")).toHaveValue("0.4");
        const panel = page.getByTestId("control-panel");
        await expect(panel).toContainText("2.2x");
        await expect(panel).toContainText("2.4x");
        await expect(panel).toContainText("40%");
      } finally {
        await close();
      }
    });

    test("T1-F20-02 adjusting Horizontal Gain X scales horizontal gaze excursion", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeSyntheticFace({ dirX: 0.45, dirY: 0 }));
        await setRangeValue(page, "gaze-sensitivity-x", 0.8);
        await expect(page.getByTestId("control-panel")).toContainText("0.8x");
        await page.waitForTimeout(220);
        const lowGain = await readGazeCoordPercent(page);

        await setRangeValue(page, "gaze-sensitivity-x", 4.0);
        await expect(page.getByTestId("control-panel")).toContainText("4.0x");
        await expect
          .poll(async () => (await readGazeCoordPercent(page))?.x ?? 0)
          .toBeGreaterThan((lowGain?.x ?? 50) + 15);
      } finally {
        await close();
      }
    });

    test("T1-F20-03 adjusting Vertical Gain Y scales vertical gaze excursion", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeSyntheticFace({ dirX: 0, dirY: 0.45 }));
        await setRangeValue(page, "gaze-sensitivity-y", 0.8);
        await page.waitForTimeout(220);
        const lowGain = await readGazeCoordPercent(page);

        await setRangeValue(page, "gaze-sensitivity-y", 4.0);
        await expect
          .poll(async () => (await readGazeCoordPercent(page))?.y ?? 0)
          .toBeGreaterThan((lowGain?.y ?? 50) + 15);
      } finally {
        await close();
      }
    });

    test("T1-F20-04 adjusting Head-Pose Assist steers gaze when head yaw is non-zero", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeHeadPoseFrame(-25, 0, 0));
        await setRangeValue(page, "gaze-head-comp", 0);
        await page.waitForTimeout(220);
        const zeroComp = await readGazeCoordPercent(page);
        expect(zeroComp?.x).toBeGreaterThanOrEqual(45);
        expect(zeroComp?.x).toBeLessThanOrEqual(55);

        await setRangeValue(page, "gaze-head-comp", 1);
        await expect(page.getByTestId("control-panel")).toContainText("100%");
        await expect
          .poll(async () => (await readGazeCoordPercent(page))?.x ?? 50)
          .toBeGreaterThan(75);
      } finally {
        await close();
      }
    });

    test("T1-F20-05 sensitivity header badge switches MANUAL <-> CALIBRATED", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        const panel = page.getByTestId("control-panel");
        await expect(panel).toContainText("MANUAL");
        await completeCalibration(page, server, "click");
        await expect(panel).toContainText("CALIBRATED");
        await page.getByTestId("reset-calibration-button").click();
        await expect(panel).toContainText("MANUAL");
      } finally {
        await close();
      }
    });
  });

  test.describe("F21: Display Mode & Mirror", () => {
    test("T1-F21-01 defaults to overlay mode with visible eye-video", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("mode-overlay")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(page.getByTestId("mode-blackout")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        const opacity = await page
          .getByTestId("eye-video")
          .evaluate((el) => getComputedStyle(el).opacity);
        expect(Number(opacity)).toBe(1);
      } finally {
        await close();
      }
    });

    test("T1-F21-02 switching to Blackout hides eye-video and paints #05080f grid on canvas", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("mode-blackout").click();
        await expect(page.getByTestId("mode-blackout")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(page.getByTestId("control-panel")).toContainText(
          "blackout",
        );
        await expect
          .poll(async () =>
            page
              .getByTestId("eye-video")
              .evaluate((el) => Number(getComputedStyle(el).opacity)),
          )
          .toBe(0);
        const stats = await sampleCanvasRegion(page);
        expect(stats.darkBgPixels).toBeGreaterThan(1000);
      } finally {
        await close();
      }
    });

    test("T1-F21-03 switching back to Overlay restores eye-video opacity 1", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("mode-blackout").click();
        await expect
          .poll(async () =>
            page
              .getByTestId("eye-video")
              .evaluate((el) => Number(getComputedStyle(el).opacity)),
          )
          .toBe(0);
        await page.getByTestId("mode-overlay").click();
        await expect
          .poll(async () =>
            page
              .getByTestId("eye-video")
              .evaluate((el) => Number(getComputedStyle(el).opacity)),
          )
          .toBe(1);
      } finally {
        await close();
      }
    });

    test("T1-F21-04 Mirror Mode defaults ON with horizontal flip transform on eye-video", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("mirror-toggle");
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(toggle).toHaveText("ON");
        const transform = await page
          .getByTestId("eye-video")
          .evaluate((el) => getComputedStyle(el).transform);
        expect(transform).toContain("-1");
      } finally {
        await close();
      }
    });

    test("T1-F21-05 toggling Mirror OFF removes flip transform and inverts horizontal gaze", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        server.setStreamGenerator(() => makeZoneGaze("RIGHT"));
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("RIGHT");

        const toggle = page.getByTestId("mirror-toggle");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await expect(toggle).toHaveText("OFF");

        const transform = await page
          .getByTestId("eye-video")
          .evaluate((el) => getComputedStyle(el).transform);
        expect(transform).not.toContain("-1");
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("LEFT");
      } finally {
        await close();
      }
    });
  });

  test.describe("F22: Gaze Smoothing (One-Euro)", () => {
    test("T1-F22-01 defaults to smoothing ON at 0.55 (55%)", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("smoothing-toggle");
        const slider = page.getByTestId("smoothing-slider");
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(toggle).toHaveText("ON");
        await expect(slider).toHaveValue("0.55");
        await expect(slider).toBeEnabled();
        await expect(page.getByTestId("control-panel")).toContainText("55%");
      } finally {
        await close();
      }
    });

    test("T1-F22-02 toggling smoothing OFF disables slider and updates label", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const toggle = page.getByTestId("smoothing-toggle");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await expect(toggle).toHaveText("OFF");
        await expect(page.getByTestId("smoothing-slider")).toBeDisabled();
      } finally {
        await close();
      }
    });

    test("T1-F22-03 step change jumps immediately with smoothing OFF vs damped with strength 0.95", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "smoothing-slider", 0.95);
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        server.stopStream();

        // Send a single RIGHT frame while smoothing is at 0.95 -> heavily damped first step
        server.sendFrame({ data: makeZoneGaze("RIGHT") });
        await page.waitForTimeout(140);
        const damped = await readGazeCoordPercent(page);
        expect(damped).not.toBeNull();
        expect(damped!.x).toBeLessThan(80);

        // Turn smoothing OFF, reset to CENTER, then send single RIGHT frame -> instant jump
        await page.getByTestId("smoothing-toggle").click();
        server.sendFrame({ data: makeCenterGaze() });
        await page.waitForTimeout(130);
        server.sendFrame({ data: makeZoneGaze("RIGHT") });
        await page.waitForTimeout(130);
        const rawStep = await readGazeCoordPercent(page);
        expect(rawStep).not.toBeNull();
        expect(rawStep!.x).toBeGreaterThanOrEqual(82);
      } finally {
        await close();
      }
    });

    test("T1-F22-04 adjusting smoothing-slider updates percentage readout", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await setRangeValue(page, "smoothing-slider", 0.85);
        await expect(page.getByTestId("control-panel")).toContainText("85%");
      } finally {
        await close();
      }
    });

    test("T1-F22-05 re-enabling smoothing re-enables slider", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("smoothing-toggle").click();
        await expect(page.getByTestId("smoothing-slider")).toBeDisabled();
        await page.getByTestId("smoothing-toggle").click();
        await expect(page.getByTestId("smoothing-slider")).toBeEnabled();
      } finally {
        await close();
      }
    });
  });

  test.describe("F23: Export Gaze Snapshot (JSON)", () => {
    test("T1-F23-01 clicking export-snapshot downloads eye-gaze-snapshot-<ms>.json", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const { filename } = await triggerExportSnapshot(page);
        expect(filename).toMatch(/^eye-gaze-snapshot-\d+\.json$/);
      } finally {
        await close();
      }
    });

    test("T1-F23-02 snapshot includes app, version, and finite timestampMs", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.app).toBe("eye-gaze-hud");
        expect(payload.version).toBe("2.1.0");
        expect(Number.isFinite(payload.timestampMs)).toBe(true);
        expect(payload.timestampMs).toBeGreaterThan(0);
      } finally {
        await close();
      }
    });

    test("T1-F23-03 snapshot captures live mirrored, smoothing, and gazeSettings state", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await page.getByTestId("mirror-toggle").click();
        await page.getByTestId("toggle-showFaceMesh").click();
        await setRangeValue(page, "smoothing-slider", 0.75);

        const { payload } = await triggerExportSnapshot(page);
        expect(payload.mirrored).toBe(false);
        expect(payload.smoothing).toEqual({ enabled: true, strength: 0.75 });
        expect(payload.gazeSettings.showFaceMesh).toBe(true);
      } finally {
        await close();
      }
    });

    test("T1-F23-04 snapshot captures calibrated affine coefficients and blinkCount", async ({
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
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.calibrated).toBe(true);
        expect(payload.calibration).not.toBeNull();
        expect(payload.calibration!.sampleCount).toBe(5);
        expect(payload.blinkCount).toBe(1);
      } finally {
        await close();
      }
    });

    test("T1-F23-05 snapshot captures live gaze estimate and non-empty trail array", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        await expect(page.getByTestId("hud-gaze-zone")).toHaveText("CENTER");
        const { payload } = await triggerExportSnapshot(page);
        expect(payload.gaze).not.toBeNull();
        expect(payload.gaze!.zone).toBe("CENTER");
        expect(Array.isArray(payload.trail)).toBe(true);
        expect(payload.trail.length).toBeGreaterThan(0);
      } finally {
        await close();
      }
    });
  });

  test.describe("F24: Copyright Footer", () => {
    test("T1-F24-01 app-copyright-footer visible with exact copyright text", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const footer = page.getByTestId("app-copyright-footer");
        await expect(footer).toBeVisible();
        await expect(footer).toContainText(
          /© 2025–202\d hamzafpv\.com\.tr • All rights reserved\./,
        );
      } finally {
        await close();
      }
    });

    test("T1-F24-02 control-panel contains matching copyright block", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const panel = page.getByTestId("control-panel");
        await expect(panel).toContainText("hamzafpv.com.tr");
        await expect(panel).toContainText("All rights reserved.");
      } finally {
        await close();
      }
    });

    test("T1-F24-03 footer link points to https://hamzafpv.com.tr", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const link = page.getByTestId("app-copyright-footer").locator("a");
        await expect(link).toHaveAttribute("href", "https://hamzafpv.com.tr");
      } finally {
        await close();
      }
    });

    test("T1-F24-04 footer and panel links enforce target=_blank and rel=noopener noreferrer", async ({
      page,
    }) => {
      const { close } = await bootHudSession(page);
      try {
        const footerLink = page
          .getByTestId("app-copyright-footer")
          .locator("a");
        const panelLink = page
          .getByTestId("control-panel")
          .locator('a[href="https://hamzafpv.com.tr"]');
        for (const link of [footerLink, panelLink]) {
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        }
      } finally {
        await close();
      }
    });

    test("T1-F24-05 footer remains visible when sidebar collapsed and during status-overlay", async ({
      page,
    }) => {
      const { server, close } = await bootHudSession(page);
      try {
        await page.getByTestId("panel-toggle").click();
        await expect(page.getByTestId("app-copyright-footer")).toBeVisible();

        server.sendStatus("camera-busy");
        await expect(page.getByTestId("status-overlay")).toBeVisible();
        await expect(page.getByTestId("app-copyright-footer")).toBeVisible();
      } finally {
        await close();
      }
    });
  });
});
