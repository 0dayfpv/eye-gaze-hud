import { describe, expect, it, vi } from "vitest";
import { EyeEngine, type FaceLandmarkerLike } from "./eyeEngine";

function createMockVideo(): HTMLVideoElement {
  return {
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
  } as unknown as HTMLVideoElement;
}

describe("EyeEngine", () => {
  it("initializes FaceLandmarker with outputFaceBlendshapes enabled on GPU", async () => {
    const close = vi.fn();
    const detectForVideo = vi.fn(() => ({
      faceLandmarks: [
        Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 })),
      ],
      faceBlendshapes: [
        {
          categories: [
            { categoryName: "eyeLookInLeft", score: 0.2 },
            { categoryName: "eyeBlinkLeft", score: 0.1 },
          ],
        },
      ],
    }));
    const createFaceFromOptions = vi.fn(
      async (): Promise<FaceLandmarkerLike> => ({
        detectForVideo: detectForVideo as unknown as FaceLandmarkerLike["detectForVideo"],
        close,
      }),
    );

    const engine = new EyeEngine({
      forVisionTasks: vi.fn(async () => ({}) as never),
      createFaceFromOptions,
      now: (() => {
        let t = 100;
        return () => (t += 5);
      })(),
    });

    const delegate = await engine.init();
    expect(delegate).toBe("GPU");
    expect(engine.isReady()).toBe(true);
    expect(createFaceFromOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      }),
    );

    const frame = engine.detectFrame(createMockVideo(), 1000);
    expect(frame.faceLandmarks).toHaveLength(478);
    expect(frame.faceBlendshapes?.eyeLookInLeft).toBeCloseTo(0.2, 4);
    expect(frame.delegate).toBe("GPU");
    expect(frame.inferenceMs).toBeGreaterThanOrEqual(0);

    engine.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    expect(engine.isReady()).toBe(false);
  });

  it("falls back to CPU delegate when GPU initialization fails", async () => {
    const close = vi.fn();
    const createFaceFromOptions = vi
      .fn()
      .mockRejectedValueOnce(new Error("WebGL unavailable"))
      .mockResolvedValueOnce({
        detectForVideo: vi.fn(() => ({ faceLandmarks: [], faceBlendshapes: [] })),
        close,
      });

    const engine = new EyeEngine({
      forVisionTasks: vi.fn(async () => ({}) as never),
      createFaceFromOptions,
    });

    const delegate = await engine.init();
    expect(delegate).toBe("CPU");
    expect(engine.getActiveDelegate()).toBe("CPU");
    expect(createFaceFromOptions).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("enforces strictly monotonic timestamps passed to detectForVideo", async () => {
    const timestamps: number[] = [];
    const engine = new EyeEngine({
      forVisionTasks: vi.fn(async () => ({}) as never),
      createFaceFromOptions: vi.fn(async () => ({
        detectForVideo: ((_: HTMLVideoElement, ts: number) => {
          timestamps.push(ts);
          return { faceLandmarks: [], faceBlendshapes: [] };
        }) as unknown as FaceLandmarkerLike["detectForVideo"],
        close: vi.fn(),
      })),
    });

    await engine.init();
    const video = createMockVideo();
    engine.detectFrame(video, 500);
    engine.detectFrame(video, 500);
    engine.detectFrame(video, 400);

    expect(timestamps).toEqual([500, 501, 502]);
    engine.dispose();
  });
});
