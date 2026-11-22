import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./engine/eyeEngine", () => {
  class MockEyeEngine {
    async init() {
      return "GPU" as const;
    }
    isReady() {
      return true;
    }
    getActiveDelegate() {
      return "GPU" as const;
    }
    detectFrame() {
      return {
        faceLandmarks: null,
        faceBlendshapes: null,
        inferenceMs: 5,
        delegate: "GPU" as const,
      };
    }
    dispose() {}
  }
  return {
    EyeEngine: MockEyeEngine,
    isEyeEngineCancelledError: () => false,
  };
});

import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<App /> Eye Gaze HUD", () => {
  it("transitions to ready when camera and EyeEngine succeed, and supports panel collapse & calibration", async () => {
    const fakeStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => fakeStream),
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId("status-overlay")).toBeNull();
    });

    expect(screen.getByTestId("hud-gaze-zone")).toBeInTheDocument();
    expect(screen.getByTestId("hud-blink-count")).toHaveTextContent("0 BLINKS");
    expect(screen.getByTestId("gaze-lab-section")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("start-calibration-button"));
    expect(screen.getByTestId("calibration-overlay")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("calibration-cancel-button"));
    expect(screen.queryByTestId("calibration-overlay")).toBeNull();

    fireEvent.click(screen.getByTestId("panel-toggle"));
    expect(screen.getByTestId("control-panel").className).toContain("hidden");
  });

  it("shows permission-denied overlay when camera permission is rejected", async () => {
    const err = new Error("Permission denied");
    err.name = "NotAllowedError";

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw err;
        }),
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("status-overlay")).toHaveTextContent(
        /permission denied/i,
      );
    });
    expect(screen.getByTestId("retry-button")).toBeInTheDocument();
  });
});
