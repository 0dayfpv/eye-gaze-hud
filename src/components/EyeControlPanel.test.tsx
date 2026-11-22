import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EyeControlPanel } from "./EyeControlPanel";
import { DEFAULT_GAZE_SETTINGS } from "../engine/gazeEngine";

afterEach(() => {
  cleanup();
});

describe("<EyeControlPanel />", () => {
  it("renders gaze radar, calibration actions, sliders, toggles, and triggers callbacks", () => {
    const onStartCalibration = vi.fn();
    const onClearHeatmap = vi.fn();
    const onGazeSettingsChange = vi.fn();
    const onViewModeChange = vi.fn();
    const onMirroredChange = vi.fn();
    const onExportSnapshot = vi.fn();

    render(
      <EyeControlPanel
        isOpen={true}
        onToggleOpen={vi.fn()}
        telemetry={{ fps: 60, inferenceMs: 8.2, delegate: "GPU", irisLocked: true }}
        viewMode="overlay"
        onViewModeChange={onViewModeChange}
        mirrored={true}
        onMirroredChange={onMirroredChange}
        smoothing={{ enabled: true, strength: 0.55 }}
        onSmoothingChange={vi.fn()}
        gaze={{
          rawGazeX: 0.1,
          rawGazeY: 0.0,
          screenX: 0.52,
          screenY: 0.49,
          zone: "CENTER",
          leftEye: {
            hx: 0.5,
            hy: 0.5,
            center: { x: 0.55, y: 0.45, z: 0 },
            radius: 0.015,
            openness: 95,
            isBlinking: false,
          },
          rightEye: {
            hx: 0.5,
            hy: 0.5,
            center: { x: 0.45, y: 0.45, z: 0 },
            radius: 0.015,
            openness: 95,
            isBlinking: false,
          },
          isBlinking: false,
          confidence: 0.98,
          calibrated: false,
          headMetrics: null,
        }}
        gazeSettings={DEFAULT_GAZE_SETTINGS}
        onGazeSettingsChange={onGazeSettingsChange}
        blinkCount={4}
        fixationSec={1.8}
        isCalibrating={false}
        isCalibrated={false}
        onStartCalibration={onStartCalibration}
        onResetCalibration={vi.fn()}
        onClearHeatmap={onClearHeatmap}
        onExportSnapshot={onExportSnapshot}
      />,
    );

    expect(screen.getByTestId("gaze-zone-badge")).toHaveTextContent("CENTER");
    expect(screen.getByTestId("gaze-radar-dot")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("start-calibration-button"));
    expect(onStartCalibration).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("clear-heatmap-button"));
    expect(onClearHeatmap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("toggle-showHeatmap"));
    expect(onGazeSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ showHeatmap: false }),
    );

    fireEvent.click(screen.getByTestId("mode-blackout"));
    expect(onViewModeChange).toHaveBeenCalledWith("blackout");

    fireEvent.click(screen.getByTestId("mirror-toggle"));
    expect(onMirroredChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByTestId("export-snapshot"));
    expect(onExportSnapshot).toHaveBeenCalledTimes(1);
  });
});
