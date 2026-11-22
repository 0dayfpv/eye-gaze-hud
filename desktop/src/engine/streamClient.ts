import type {
  AppStatus,
  ClientCommand,
  DecodedFramePacket,
  DelegateType,
  EyeBlendshapes,
  NativeFrameHeader,
  NativeStatusMessage,
  Point3D,
} from "./types";

export type {
  ClientCommand,
  DecodedFramePacket,
  NativeFrameHeader,
  NativeStatusMessage,
} from "./types";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

const VALID_APP_STATUSES: ReadonlySet<AppStatus> = new Set<AppStatus>([
  "loading-model",
  "requesting-camera",
  "ready",
  "permission-denied",
  "no-camera",
  "camera-busy",
  "error",
]);

function clamp01(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeBlendshapes(raw: unknown): EyeBlendshapes | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  return {
    eyeLookInLeft: clamp01(obj.eyeLookInLeft),
    eyeLookOutLeft: clamp01(obj.eyeLookOutLeft),
    eyeLookUpLeft: clamp01(obj.eyeLookUpLeft),
    eyeLookDownLeft: clamp01(obj.eyeLookDownLeft),
    eyeLookInRight: clamp01(obj.eyeLookInRight),
    eyeLookOutRight: clamp01(obj.eyeLookOutRight),
    eyeLookUpRight: clamp01(obj.eyeLookUpRight),
    eyeLookDownRight: clamp01(obj.eyeLookDownRight),
    eyeBlinkLeft: clamp01(obj.eyeBlinkLeft),
    eyeBlinkRight: clamp01(obj.eyeBlinkRight),
  };
}

function parseDelegate(raw: unknown): DelegateType {
  return raw === "GPU" ? "GPU" : "CPU";
}

export function decodeFramePacket(
  data: ArrayBuffer | Uint8Array,
): DecodedFramePacket {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4) {
    throw new Error(
      `Invalid frame packet: expected at least 4 bytes, got ${bytes.byteLength}`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(0, false);
  if (headerLen === 0 || 4 + headerLen > bytes.byteLength) {
    throw new Error(
      `Invalid frame packet header length ${headerLen} for packet size ${bytes.byteLength}`,
    );
  }

  const headerSlice = bytes.subarray(4, 4 + headerLen);
  let parsed: unknown;
  try {
    const jsonText = textDecoder.decode(headerSlice);
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Failed to parse frame packet JSON header: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid frame packet header: expected JSON object");
  }

  const rawHeader = parsed as Record<string, unknown>;
  if (rawHeader.type !== "frame") {
    throw new Error(
      `Invalid frame packet type: expected "frame", got ${String(rawHeader.type)}`,
    );
  }

  const faceDetected = Boolean(rawHeader.faceDetected);
  const rawLandmarks = Array.isArray(rawHeader.landmarks)
    ? rawHeader.landmarks
    : [];

  let faceLandmarks: Point3D[] | null = null;
  const normalizedTuples: [number, number, number][] = [];

  if (faceDetected && rawLandmarks.length > 0) {
    faceLandmarks = [];
    for (let i = 0; i < rawLandmarks.length; i++) {
      const tuple = rawLandmarks[i];
      if (Array.isArray(tuple)) {
        const x = toFiniteNumber(tuple[0], 0);
        const y = toFiniteNumber(tuple[1], 0);
        const z = toFiniteNumber(tuple[2], 0);
        normalizedTuples.push([x, y, z]);
        faceLandmarks.push({ x, y, z });
      } else {
        normalizedTuples.push([0, 0, 0]);
        faceLandmarks.push({ x: 0, y: 0, z: 0 });
      }
    }
  }

  const faceBlendshapes = faceDetected
    ? sanitizeBlendshapes(rawHeader.blendshapes)
    : null;

  const header: NativeFrameHeader = {
    type: "frame",
    timestampMs: toFiniteNumber(rawHeader.timestampMs, 0),
    frameSeq: toFiniteNumber(rawHeader.frameSeq, 0),
    width: toFiniteNumber(rawHeader.width, 0),
    height: toFiniteNumber(rawHeader.height, 0),
    cameraFps: toFiniteNumber(rawHeader.cameraFps, 0),
    inferenceMs: toFiniteNumber(rawHeader.inferenceMs, 0),
    delegate: parseDelegate(rawHeader.delegate),
    faceDetected,
    landmarks: normalizedTuples,
    blendshapes: faceBlendshapes,
  };

  return {
    header,
    faceLandmarks,
    faceBlendshapes,
    jpegBytes: bytes.subarray(4 + headerLen),
  };
}

export function parseStatusMessage(raw: string): NativeStatusMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "status") {
    return null;
  }

  const rawStatus = obj.status;
  const status: AppStatus =
    typeof rawStatus === "string" &&
    VALID_APP_STATUSES.has(rawStatus as AppStatus)
      ? (rawStatus as AppStatus)
      : "error";

  const result: NativeStatusMessage = {
    type: "status",
    status,
  };

  if (typeof obj.message === "string") {
    result.message = obj.message;
  }
  if (obj.delegate === "GPU" || obj.delegate === "CPU") {
    result.delegate = obj.delegate;
  }

  return result;
}

export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose:
    | ((ev: { code?: number; reason?: string; wasClean?: boolean }) => void)
    | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface NativeStreamClientOptions {
  wsUrl: string;
  onFrame?: (packet: DecodedFramePacket) => void;
  onStatus?: (status: NativeStatusMessage) => void;
  onOpen?: () => void;
  onClose?: (ev: { code?: number; reason?: string; wasClean?: boolean }) => void;
  onError?: (error: Error) => void;
  webSocketFactory?: (url: string) => WebSocketLike;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;

export class NativeStreamClient {
  private readonly options: NativeStreamClientOptions;
  private ws: WebSocketLike | null = null;
  private sessionToken = 0;

  constructor(options: NativeStreamClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.disconnect();
    const token = ++this.sessionToken;
    const factory =
      this.options.webSocketFactory ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const socket = factory(this.options.wsUrl);
    socket.binaryType = "arraybuffer";
    this.ws = socket;

    socket.onopen = () => {
      if (this.sessionToken !== token) return;
      this.options.onOpen?.();
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (this.sessionToken !== token) return;
      const payload = ev.data;

      if (typeof payload === "string") {
        const status = parseStatusMessage(payload);
        if (status) {
          this.options.onStatus?.(status);
        }
        return;
      }

      if (payload instanceof ArrayBuffer) {
        this.handleBinaryPayload(payload);
        return;
      }

      if (ArrayBuffer.isView(payload)) {
        const viewBytes = new Uint8Array(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength,
        );
        this.handleBinaryPayload(viewBytes);
        return;
      }

      if (typeof Blob !== "undefined" && payload instanceof Blob) {
        void payload
          .arrayBuffer()
          .then((buf) => {
            if (this.sessionToken !== token) return;
            this.handleBinaryPayload(buf);
          })
          .catch((err) => {
            if (this.sessionToken !== token) return;
            this.options.onError?.(
              err instanceof Error ? err : new Error(String(err)),
            );
          });
      }
    };

    socket.onerror = (ev: unknown) => {
      if (this.sessionToken !== token) return;
      const err =
        ev instanceof Error ? ev : new Error("WebSocket stream error");
      this.options.onError?.(err);
    };

    socket.onclose = (ev: {
      code?: number;
      reason?: string;
      wasClean?: boolean;
    }) => {
      if (this.sessionToken !== token) return;
      this.ws = null;
      this.options.onClose?.(ev);
    };
  }

  private handleBinaryPayload(data: ArrayBuffer | Uint8Array): void {
    try {
      const packet = decodeFramePacket(data);
      this.options.onFrame?.(packet);
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  sendCommand(command: ClientCommand): boolean {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(command));
    return true;
  }

  retryCamera(): boolean {
    return this.sendCommand({ type: "retry_camera" });
  }

  setDelegate(delegate: "auto" | "gpu" | "cpu"): boolean {
    return this.sendCommand({ type: "set_delegate", delegate });
  }

  shutdown(): boolean {
    return this.sendCommand({ type: "shutdown" });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  disconnect(code = 1000, reason = "client_disconnect"): void {
    this.sessionToken += 1;
    const socket = this.ws;
    this.ws = null;
    if (!socket) {
      return;
    }
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN) {
      socket.close(code, reason);
    }
  }
}
