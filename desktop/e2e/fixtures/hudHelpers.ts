import fs from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import {
  startMockWsServer,
  type AppStatus,
  type DelegateType,
  type FrameGenerator,
  type MockWsServer,
  type StartMockWsOptions,
} from "./mockWsServer";
import {
  makeCalibrationTargetGaze,
  makeCenterGaze,
} from "./syntheticFace";

export interface HudSession {
  server: MockWsServer;
  close: () => Promise<void>;
}

export interface CanvasSampleStats {
  width: number;
  height: number;
  totalSampled: number;
  nonEmptyPixels: number;
  cyanPixels: number;
  pinkPixels: number;
  emeraldPixels: number;
  amberPixels: number;
  yellowPixels: number;
  redPixels: number;
  brightWhitePixels: number;
  darkBgPixels: number;
}

export interface SnapshotPayload {
  app: string;
  version: string;
  timestampMs: number;
  mirrored: boolean;
  smoothing: { enabled: boolean; strength: number };
  gazeSettings: {
    sensitivityX: number;
    sensitivityY: number;
    headCompensation: number;
    showGazeRays: boolean;
    showZoneGrid: boolean;
    showTrail: boolean;
    showHeatmap: boolean;
    showFaceMesh: boolean;
    showEyeMagnifier: boolean;
  };
  calibrated: boolean;
  calibration: {
    ax0: number;
    ax1: number;
    ax2: number;
    ay0: number;
    ay1: number;
    ay2: number;
    sampleCount: number;
  } | null;
  blinkCount: number;
  gaze: {
    rawGazeX: number;
    rawGazeY: number;
    screenX: number;
    screenY: number;
    zone: string;
    isBlinking: boolean;
    calibrated: boolean;
    confidence: number;
    leftEye: unknown;
    rightEye: unknown;
    headMetrics: unknown;
  } | null;
  trail: Array<{ x: number; y: number; timestampMs: number }>;
}

export async function bootHudSession(
  page: Page,
  options: StartMockWsOptions & {
    streamInitialFrames?: boolean;
    initialGenerator?: FrameGenerator;
    fps?: number;
    width?: number;
    height?: number;
    inferenceMs?: number;
  } = {},
): Promise<HudSession> {
  const initialStatus: AppStatus = options.initialStatus ?? "ready";
  const server = await startMockWsServer({
    ...options,
    initialStatus,
  });

  await page.goto(`/?wsUrl=${encodeURIComponent(server.wsUrl)}`);
  await server.waitForClient(8000);

  if (options.streamInitialFrames !== false && initialStatus === "ready") {
    server.startStream(options.initialGenerator ?? (() => makeCenterGaze()), {
      fps: options.fps ?? 30,
      width: options.width ?? 1280,
      height: options.height ?? 720,
      delegate: options.initialDelegate ?? "GPU",
      inferenceMs: options.inferenceMs ?? 4.2,
    });
    await expect(page.getByTestId("status-overlay")).toHaveCount(0);
  }

  return {
    server,
    close: () => server.close(),
  };
}

/**
 * Samples actual rendered RGBA pixels from `[data-testid="eye-canvas"]`.
 * Region can be normalized `[0..1]` (`normalized: true`, default) or CSS px.
 */
export async function sampleCanvasRegion(
  page: Page,
  region: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    normalized?: boolean;
  } = { x1: 0, y1: 0, x2: 1, y2: 1, normalized: true },
): Promise<CanvasSampleStats> {
  // Wait a rAF so pending canvas draw commits
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  return page.evaluate((reg) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="eye-canvas"]',
    );
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return {
        width: 0,
        height: 0,
        totalSampled: 0,
        nonEmptyPixels: 0,
        cyanPixels: 0,
        pinkPixels: 0,
        emeraldPixels: 0,
        amberPixels: 0,
        yellowPixels: 0,
        redPixels: 0,
        brightWhitePixels: 0,
        darkBgPixels: 0,
      };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get 2d context on eye-canvas");
    }

    const rect = canvas.getBoundingClientRect();
    const dprX = rect.width > 0 ? canvas.width / rect.width : 1;
    const dprY = rect.height > 0 ? canvas.height / rect.height : 1;

    const useNorm = reg.normalized !== false;
    const px1 = Math.max(
      0,
      Math.floor(useNorm ? reg.x1 * canvas.width : reg.x1 * dprX),
    );
    const py1 = Math.max(
      0,
      Math.floor(useNorm ? reg.y1 * canvas.height : reg.y1 * dprY),
    );
    const px2 = Math.min(
      canvas.width,
      Math.ceil(useNorm ? reg.x2 * canvas.width : reg.x2 * dprX),
    );
    const py2 = Math.min(
      canvas.height,
      Math.ceil(useNorm ? reg.y2 * canvas.height : reg.y2 * dprY),
    );

    const w = Math.max(1, px2 - px1);
    const h = Math.max(1, py2 - py1);
    const data = ctx.getImageData(px1, py1, w, h).data;

    let nonEmptyPixels = 0;
    let cyanPixels = 0;
    let pinkPixels = 0;
    let emeraldPixels = 0;
    let amberPixels = 0;
    let yellowPixels = 0;
    let redPixels = 0;
    let brightWhitePixels = 0;
    let darkBgPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;

      if (a > 10) {
        nonEmptyPixels += 1;
      }
      if (a > 220 && r <= 12 && g <= 16 && b <= 24) {
        darkBgPixels += 1;
      }
      if (a > 25 && b > 170 && g > 140 && r < 110) {
        cyanPixels += 1;
      }
      if (a > 25 && r > 200 && b > 140 && g < 165) {
        pinkPixels += 1;
      }
      if (a > 25 && g > 150 && b > 95 && b < 175 && r < 80) {
        emeraldPixels += 1;
      }
      if (a > 25 && r > 200 && g > 120 && g < 185 && b < 70) {
        amberPixels += 1;
      }
      if (a > 25 && r > 200 && g > 180 && b < 90) {
        yellowPixels += 1;
      }
      if (a > 25 && r > 200 && g < 110 && b < 130) {
        redPixels += 1;
      }
      if (a > 200 && r > 225 && g > 225 && b > 225) {
        brightWhitePixels += 1;
      }
    }

    return {
      width: canvas.width,
      height: canvas.height,
      totalSampled: w * h,
      nonEmptyPixels,
      cyanPixels,
      pinkPixels,
      emeraldPixels,
      amberPixels,
      yellowPixels,
      redPixels,
      brightWhitePixels,
      darkBgPixels,
    };
  }, region);
}

/**
 * Computes pixel count above blackout background (#05080f) and a deterministic byte sum
 * for comparing canvas states across layer toggles without false positives.
 */
export async function measureCanvasActivity(
  page: Page,
  region: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    normalized?: boolean;
  } = { x1: 0, y1: 0, x2: 1, y2: 1, normalized: true },
): Promise<{
  width: number;
  height: number;
  nonZeroAlphaPixels: number;
  aboveBlackoutPixels: number;
  rgbSum: number;
}> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  return page.evaluate((reg) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="eye-canvas"]',
    );
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return {
        width: 0,
        height: 0,
        nonZeroAlphaPixels: 0,
        aboveBlackoutPixels: 0,
        rgbSum: 0,
      };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get 2d context on eye-canvas");
    }

    const rect = canvas.getBoundingClientRect();
    const dprX = rect.width > 0 ? canvas.width / rect.width : 1;
    const dprY = rect.height > 0 ? canvas.height / rect.height : 1;
    const useNorm = reg.normalized !== false;
    const px1 = Math.max(
      0,
      Math.floor(useNorm ? reg.x1 * canvas.width : reg.x1 * dprX),
    );
    const py1 = Math.max(
      0,
      Math.floor(useNorm ? reg.y1 * canvas.height : reg.y1 * dprY),
    );
    const px2 = Math.min(
      canvas.width,
      Math.ceil(useNorm ? reg.x2 * canvas.width : reg.x2 * dprX),
    );
    const py2 = Math.min(
      canvas.height,
      Math.ceil(useNorm ? reg.y2 * canvas.height : reg.y2 * dprY),
    );

    const w = Math.max(1, px2 - px1);
    const h = Math.max(1, py2 - py1);
    const data = ctx.getImageData(px1, py1, w, h).data;

    let nonZeroAlphaPixels = 0;
    let aboveBlackoutPixels = 0;
    let rgbSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;
      if (a > 5) nonZeroAlphaPixels += 1;
      if (a > 20 && (r > 18 || g > 22 || b > 32)) {
        aboveBlackoutPixels += 1;
      }
      rgbSum += r + g + b + a;
    }

    return {
      width: canvas.width,
      height: canvas.height,
      nonZeroAlphaPixels,
      aboveBlackoutPixels,
      rgbSum,
    };
  }, region);
}

/**
 * Runs a complete 5-point calibration sequence via mouse clicks or Space key.
 */
export async function completeCalibration(
  page: Page,
  server: MockWsServer,
  mode: "click" | "space" | "mixed" = "click",
): Promise<void> {
  server.setStreamGenerator(() => makeCalibrationTargetGaze(0));
  await page.getByTestId("start-calibration-button").click();
  await expect(page.getByTestId("calibration-overlay")).toBeVisible();

  for (let step = 0; step < 5; step++) {
    server.setStreamGenerator(() => makeCalibrationTargetGaze(step));
    await expect(page.getByTestId("calibration-overlay")).toContainText(
      `(${step + 1}/5)`,
    );
    // Allow incoming frames for this target to reach the renderer before starting 10-frame capture
    await page.waitForTimeout(120);

    const useSpace = mode === "space" || (mode === "mixed" && step % 2 === 1);
    if (useSpace) {
      await page.keyboard.press("Space");
    } else {
      await page.getByTestId("calibration-target-button").click();
    }

    if (step < 4) {
      await expect(page.getByTestId("calibration-overlay")).toContainText(
        `(${step + 2}/5)`,
      );
    } else {
      await expect(page.getByTestId("calibration-overlay")).toHaveCount(0);
    }
  }

  await expect(page.getByTestId("hud-calibrated-badge")).toBeVisible();
  server.setStreamGenerator(() => makeCenterGaze());
}

export async function readBiometricTile(
  page: Page,
  tileHeading:
    | "LEFT IRIS (hx, hy)"
    | "RIGHT IRIS (hx, hy)"
    | "BLINKS / FIXATION"
    | "GAZE COORD (X, Y)"
    | "HEAD POSE (YAW / PITCH / ROLL)",
): Promise<string> {
  const section = page.getByTestId("gaze-lab-section");
  const valueDiv = section
    .getByText(tileHeading, { exact: true })
    .locator("xpath=following-sibling::div[1]");
  return (await valueDiv.innerText()).trim();
}

export async function readGazeCoordPercent(
  page: Page,
): Promise<{ x: number; y: number } | null> {
  const txt = await readBiometricTile(page, "GAZE COORD (X, Y)");
  const m = txt.match(/(-?\d+)%\s*,\s*(-?\d+)%/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export async function triggerExportSnapshot(
  page: Page,
): Promise<{ filename: string; payload: SnapshotPayload }> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-snapshot").click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  const filePath = await download.path();
  if (!filePath) {
    throw new Error("Download path unavailable");
  }
  const raw = await fs.readFile(filePath, "utf8");
  const payload = JSON.parse(raw) as SnapshotPayload;
  return { filename, payload };
}

export async function setRangeValue(
  page: Page,
  testId: string,
  value: number,
): Promise<void> {
  const slider = page.getByTestId(testId);
  await slider.fill(String(value));
}

export function attachErrorCollectors(page: Page): {
  pageErrors: string[];
  consoleErrors: string[];
} {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  return { pageErrors, consoleErrors };
}

export async function waitForDelegate(
  page: Page,
  delegate: DelegateType,
): Promise<void> {
  await expect(page.getByTestId("hud-delegate")).toHaveText(delegate);
}
