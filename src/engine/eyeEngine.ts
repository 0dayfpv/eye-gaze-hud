import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerOptions,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { DelegateType, Point3D } from "./geometry";
import { extractEyeBlendshapes, type EyeBlendshapes } from "./gazeEngine";

export type VisionWasmFileset = Awaited<
  ReturnType<typeof FilesetResolver.forVisionTasks>
>;

export const DEFAULT_WASM_BASE_PATH = "/wasm";

export const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MAX_SAFE_TIMESTAMP_MS = Number.MAX_SAFE_INTEGER - 1_000_000_000;

let mediaPipeConsoleFilterInstalled = false;

/**
 * Redirects benign MediaPipe Emscripten C++ ABSL_LOG(INFO) stderr lines
 * to console.info while preserving genuine console.error logs.
 */
function ensureMediaPipeConsoleFilter(): void {
  if (mediaPipeConsoleFilterInstalled || typeof console === "undefined") {
    return;
  }
  mediaPipeConsoleFilterInstalled = true;
  const originalConsoleError = console.error.bind(console);
  const originalConsoleInfo =
    typeof console.info === "function"
      ? console.info.bind(console)
      : originalConsoleError;

  console.error = (...args: unknown[]): void => {
    if (args.length > 0 && typeof args[0] === "string") {
      const msg = args[0].trim();
      if (
        msg.startsWith("INFO: Created TensorFlow Lite") ||
        /^I\d{4}\s/.test(msg) ||
        /^W\d{4}\s.*feedback manager/i.test(msg)
      ) {
        originalConsoleInfo(...args);
        return;
      }
    }
    originalConsoleError(...args);
  };
}

export interface EyeEngineOptions {
  minFaceDetectionConfidence?: number;
  minFacePresenceConfidence?: number;
  minTrackingConfidence?: number;
  wasmBasePath?: string;
}

export interface EyeFrameResult {
  faceLandmarks: Point3D[] | null;
  faceBlendshapes: EyeBlendshapes | null;
  inferenceMs: number;
  delegate: DelegateType;
}

export interface FaceLandmarkerLike {
  setOptions?(options: FaceLandmarkerOptions): Promise<void>;
  detectForVideo(
    videoFrame: HTMLVideoElement,
    timestamp: number,
  ): FaceLandmarkerResult;
  close(): void;
}

export interface EyeEngineDeps {
  forVisionTasks?: (basePath?: string) => Promise<VisionWasmFileset>;
  createFaceFromOptions?: (
    wasmFileset: VisionWasmFileset,
    options: FaceLandmarkerOptions,
  ) => Promise<FaceLandmarkerLike>;
  now?: () => number;
}

export class EyeEngineCancelledError extends Error {
  constructor(message = "EyeEngine operation was superseded or disposed") {
    super(message);
    this.name = "EyeEngineCancelledError";
  }
}

export function isEyeEngineCancelledError(error: unknown): boolean {
  return (
    error instanceof EyeEngineCancelledError ||
    (error instanceof Error && error.name === "EyeEngineCancelledError")
  );
}

function clampConfidence(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0.1, Math.min(0.95, value));
}

function normalizeWasmBasePath(wasmBasePath: string | undefined): string {
  const trimmed = wasmBasePath?.trim();
  if (!trimmed || trimmed.length === 0) {
    return DEFAULT_WASM_BASE_PATH;
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

function toPoint3DArray(raw: readonly NormalizedLandmark[]): Point3D[] {
  const out = new Array<Point3D>(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const lm = raw[i]!;
    out[i] = {
      x: lm.x,
      y: lm.y,
      z: lm.z,
      visibility: lm.visibility,
    };
  }
  return out;
}

function safeClose(instance: FaceLandmarkerLike | null | undefined): void {
  if (!instance) return;
  try {
    instance.close();
  } catch {
    /* ignore cleanup errors */
  }
}

/**
 * Lightweight, dedicated MediaPipe FaceLandmarker + Iris + Eye Blendshapes engine.
 * Loads ONLY face_landmarker.task (no pose/hand overhead) for maximum eye-tracking FPS.
 */
export class EyeEngine {
  private readonly forVisionTasks: (
    basePath?: string,
  ) => Promise<VisionWasmFileset>;
  private readonly createFaceFromOptions: (
    wasmFileset: VisionWasmFileset,
    options: FaceLandmarkerOptions,
  ) => Promise<FaceLandmarkerLike>;
  private readonly now: () => number;

  private faceLandmarker: FaceLandmarkerLike | null = null;
  private activeDelegate: DelegateType | null = null;
  private wasmFileset: VisionWasmFileset | null = null;
  private wasmBasePath: string = DEFAULT_WASM_BASE_PATH;
  private loadToken = 0;
  private disposed = false;
  private lastTimestampMs = -1;
  private lastError: Error | null = null;

  constructor(deps: EyeEngineDeps = {}) {
    ensureMediaPipeConsoleFilter();
    this.forVisionTasks =
      deps.forVisionTasks ??
      ((basePath) => FilesetResolver.forVisionTasks(basePath));
    this.createFaceFromOptions =
      deps.createFaceFromOptions ??
      ((wasmFileset, options) =>
        FaceLandmarker.createFromOptions(wasmFileset, options));
    this.now = deps.now ?? (() => performance.now());
  }

  async init(options: EyeEngineOptions = {}): Promise<DelegateType> {
    this.disposed = false;
    this.lastError = null;
    const token = ++this.loadToken;
    const wasmBasePath = normalizeWasmBasePath(options.wasmBasePath);
    const minDet = clampConfidence(options.minFaceDetectionConfidence, 0.45);
    const minPres = clampConfidence(options.minFacePresenceConfidence, minDet);
    const minTrack = clampConfidence(options.minTrackingConfidence, 0.45);

    this.disposeLandmarker();

    try {
      const fileset =
        this.wasmFileset && this.wasmBasePath === wasmBasePath
          ? this.wasmFileset
          : await this.forVisionTasks(wasmBasePath);

      if (this.isStale(token)) {
        throw new EyeEngineCancelledError();
      }
      this.wasmFileset = fileset;
      this.wasmBasePath = wasmBasePath;

      const delegates: DelegateType[] = ["GPU", "CPU"];
      let lastErr: unknown = null;

      for (const delegate of delegates) {
        let instance: FaceLandmarkerLike | null = null;
        try {
          instance = await this.createFaceFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: FACE_MODEL_URL,
              delegate,
            },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: minDet,
            minFacePresenceConfidence: minPres,
            minTrackingConfidence: minTrack,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
          });

          if (this.isStale(token)) {
            safeClose(instance);
            throw new EyeEngineCancelledError();
          }

          this.faceLandmarker = instance;
          this.activeDelegate = delegate;
          this.lastTimestampMs = -1;
          return delegate;
        } catch (err) {
          safeClose(instance);
          if (this.isStale(token) || isEyeEngineCancelledError(err)) {
            throw new EyeEngineCancelledError();
          }
          lastErr = err;
        }
      }

      throw lastErr instanceof Error
        ? lastErr
        : new Error("Failed to initialize MediaPipe FaceLandmarker on GPU and CPU");
    } catch (error) {
      if (!isEyeEngineCancelledError(error)) {
        this.lastError =
          error instanceof Error ? error : new Error(String(error));
      }
      throw error;
    }
  }

  detectFrame(
    video: HTMLVideoElement,
    timestampMs: number,
  ): EyeFrameResult {
    if (this.disposed || !this.faceLandmarker || !this.activeDelegate) {
      return {
        faceLandmarks: null,
        faceBlendshapes: null,
        inferenceMs: 0,
        delegate: this.activeDelegate ?? "GPU",
      };
    }

    if (
      !video ||
      video.readyState < 2 ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      return {
        faceLandmarks: null,
        faceBlendshapes: null,
        inferenceMs: 0,
        delegate: this.activeDelegate,
      };
    }

    let candidateTs: number;
    if (
      Number.isFinite(timestampMs) &&
      timestampMs >= 0 &&
      timestampMs <= MAX_SAFE_TIMESTAMP_MS
    ) {
      candidateTs = timestampMs;
    } else {
      const fallbackNow = this.now();
      candidateTs =
        Number.isFinite(fallbackNow) &&
        fallbackNow >= 0 &&
        fallbackNow <= MAX_SAFE_TIMESTAMP_MS
          ? fallbackNow
          : 0;
    }

    const safeTs =
      candidateTs > this.lastTimestampMs
        ? candidateTs
        : this.lastTimestampMs + 1;
    this.lastTimestampMs = safeTs;

    const delegate = this.activeDelegate;
    const t0 = this.now();

    try {
      const res = this.faceLandmarker.detectForVideo(video, safeTs);
      const rawFace = res?.faceLandmarks?.[0];
      const faceLandmarks =
        rawFace && rawFace.length > 0 ? toPoint3DArray(rawFace) : null;
      const faceBlendshapes = extractEyeBlendshapes(
        res?.faceBlendshapes?.[0]?.categories,
      );
      const t1 = this.now();
      const inferenceMs = Number.isFinite(t1 - t0) ? Math.max(0, t1 - t0) : 0;

      return {
        faceLandmarks,
        faceBlendshapes,
        inferenceMs,
        delegate,
      };
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return {
        faceLandmarks: null,
        faceBlendshapes: null,
        inferenceMs: 0,
        delegate,
      };
    }
  }

  isReady(): boolean {
    return (
      !this.disposed &&
      this.faceLandmarker !== null &&
      this.activeDelegate !== null
    );
  }

  getActiveDelegate(): DelegateType | null {
    return this.disposed ? null : this.activeDelegate;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  dispose(): void {
    this.disposed = true;
    this.loadToken++;
    this.disposeLandmarker();
    this.wasmFileset = null;
  }

  private isStale(token: number): boolean {
    return this.disposed || token !== this.loadToken;
  }

  private disposeLandmarker(): void {
    const prev = this.faceLandmarker;
    this.faceLandmarker = null;
    this.activeDelegate = null;
    this.lastTimestampMs = -1;
    safeClose(prev);
  }
}
