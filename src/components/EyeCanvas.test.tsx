import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EyeCanvas, drawEyeFrame } from "./EyeCanvas";
import type { GazeEstimate } from "../engine/gazeEngine";

function createMockCtx() {
  const fillTextCalls: string[] = [];
  const clearRectCalls: number[][] = [];
  const fillRectCalls: number[][] = [];
  let saveCount = 0;
  let restoreCount = 0;

  const ctx = {
    save: () => {
      saveCount += 1;
    },
    restore: () => {
      restoreCount += 1;
    },
    clearRect: (x: number, y: number, w: number, h: number) => {
      clearRectCalls.push([x, y, w, h]);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push([x, y, w, h]);
    },
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    fillText: (text: string) => {
      fillTextCalls.push(text);
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    lineCap: "butt",
    lineJoin: "miter",
  } as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    fillTextCalls,
    clearRectCalls,
    fillRectCalls,
    getCounts: () => ({ saveCount, restoreCount }),
  };
}

const sampleGaze: GazeEstimate = {
  rawGazeX: 0.4,
  rawGazeY: -0.3,
  screenX: 0.8,
  screenY: 0.2,
  zone: "UP-RIGHT",
  leftEye: {
    hx: 0.35,
    hy: 0.4,
    center: { x: 0.56, y: 0.42, z: 0 },
    radius: 0.015,
    openness: 92,
    isBlinking: false,
  },
  rightEye: {
    hx: 0.36,
    hy: 0.41,
    center: { x: 0.44, y: 0.42, z: 0 },
    radius: 0.015,
    openness: 94,
    isBlinking: false,
  },
  isBlinking: false,
  confidence: 0.95,
  calibrated: true,
  headMetrics: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("drawEyeFrame", () => {
  it("renders gaze reticle, zone grid, heatmap, saccade trail, and ocular scope HUD", () => {
    const mock = createMockCtx();
    const heatmap = new Array<number>(12 * 9).fill(0);
    heatmap[20] = 5;

    drawEyeFrame(mock.ctx, 800, 600, {
      faceLandmarks: null,
      gaze: sampleGaze,
      gazeTrail: [
        { x: 0.5, y: 0.5, timestampMs: 10 },
        { x: 0.8, y: 0.2, timestampMs: 40 },
      ],
      gazeHeatmap: heatmap,
      viewMode: "overlay",
      mirrored: true,
    });

    expect(mock.clearRectCalls).toEqual([[0, 0, 800, 600]]);
    expect(mock.fillTextCalls.some((t) => t.includes("UP-RIGHT"))).toBe(true);
    expect(mock.fillTextCalls.some((t) => t.includes("OCULAR SCOPE"))).toBe(true);
    expect(mock.getCounts().saveCount).toBe(mock.getCounts().restoreCount);
  });

  it("draws blackout backdrop when viewMode is blackout", () => {
    const mock = createMockCtx();
    drawEyeFrame(mock.ctx, 640, 480, {
      faceLandmarks: null,
      gaze: null,
      viewMode: "blackout",
      mirrored: true,
    });

    expect(mock.fillRectCalls).toContainEqual([0, 0, 640, 480]);
    expect(mock.getCounts().saveCount).toBe(mock.getCounts().restoreCount);
  });
});

describe("<EyeCanvas />", () => {
  it("renders video, canvas, and calibration overlay interactions", () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();

    render(
      <EyeCanvas
        videoRef={createRef()}
        canvasRef={createRef()}
        faceLandmarks={null}
        gaze={sampleGaze}
        viewMode="overlay"
        mirrored={true}
        status="ready"
        calibrationOverlay={{
          x: 0.5,
          y: 0.5,
          label: "Center",
          progress: 0,
          stepIndex: 0,
          totalSteps: 5,
          capturing: false,
        }}
        onCalibrationCapture={onCapture}
        onCalibrationCancel={onCancel}
      />,
    );

    expect(screen.getByTestId("eye-video").className).toContain(
      "[transform:scaleX(-1)]",
    );
    expect(screen.getByTestId("calibration-overlay")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("calibration-target-button"));
    expect(onCapture).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("calibration-cancel-button"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders status overlay with Retry button on error", () => {
    const onRetry = vi.fn();
    render(
      <EyeCanvas
        videoRef={createRef()}
        canvasRef={createRef()}
        faceLandmarks={null}
        gaze={null}
        viewMode="overlay"
        mirrored={true}
        status="permission-denied"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId("status-overlay")).toHaveTextContent(
      /permission denied/i,
    );
    fireEvent.click(screen.getByTestId("retry-button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
