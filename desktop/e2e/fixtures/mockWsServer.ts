import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { makeCenterGaze, type SyntheticFrameData } from "./syntheticFace";

export type AppStatus =
  | "requesting-camera"
  | "loading-model"
  | "ready"
  | "permission-denied"
  | "no-camera"
  | "camera-busy"
  | "error";

export type DelegateType = "GPU" | "CPU";

export interface FrameHeader {
  type: "frame";
  timestampMs: number;
  frameSeq: number;
  width: number;
  height: number;
  cameraFps: number;
  inferenceMs: number;
  delegate: DelegateType;
  faceDetected: boolean;
  landmarks: SyntheticFrameData["landmarks"];
  blendshapes: SyntheticFrameData["blendshapes"];
}

export interface StatusMessage {
  type: "status";
  status: AppStatus;
  message?: string;
  delegate?: DelegateType;
}

export interface ClientCommand {
  type: "retry_camera" | "set_delegate" | "shutdown" | string;
  delegate?: string;
  [key: string]: unknown;
}

export interface SendFrameOptions {
  data?: SyntheticFrameData;
  width?: number;
  height?: number;
  cameraFps?: number;
  inferenceMs?: number;
  delegate?: DelegateType;
  timestampMs?: number;
  jpegBytes?: Buffer;
}

export type FrameGenerator = (seq: number) => SendFrameOptions | SyntheticFrameData;

export interface StartMockWsOptions {
  initialStatus?: AppStatus;
  initialMessage?: string;
  initialDelegate?: DelegateType;
  autoRecoverOnRetry?: boolean;
  recoverDelegate?: DelegateType;
}

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SYNTHETIC_JPEG_1280X720: Buffer = fs.readFileSync(
  path.join(FIXTURE_DIR, "frame_1280x720.jpg"),
);

export const SYNTHETIC_JPEG_640X480: Buffer = fs.readFileSync(
  path.join(FIXTURE_DIR, "frame_640x480.jpg"),
);

export function encodeFramePacket(
  header: FrameHeader,
  jpegBytes: Buffer = SYNTHETIC_JPEG_1280X720,
): Buffer {
  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return Buffer.concat([lenBuf, headerBuf, jpegBytes]);
}

function isSyntheticFrameData(
  val: SendFrameOptions | SyntheticFrameData,
): val is SyntheticFrameData {
  return "faceDetected" in val && "landmarks" in val;
}

export interface MockWsServer {
  readonly port: number;
  readonly wsUrl: string;
  readonly healthUrl: string;
  sendStatus: (
    status: AppStatus,
    message?: string,
    delegate?: DelegateType,
  ) => void;
  sendFrame: (options?: SendFrameOptions) => void;
  startStream: (
    generator?: FrameGenerator,
    options?: { fps?: number; width?: number; height?: number; delegate?: DelegateType; inferenceMs?: number },
  ) => void;
  setStreamGenerator: (generator: FrameGenerator) => void;
  setStreamMeta: (meta: {
    width?: number;
    height?: number;
    delegate?: DelegateType;
    inferenceMs?: number;
    cameraFps?: number;
    jpegBytes?: Buffer;
  }) => void;
  stopStream: () => void;
  pumpFrames: (
    count: number,
    generator: FrameGenerator,
    intervalMs?: number,
  ) => Promise<void>;
  waitForClient: (timeoutMs?: number) => Promise<void>;
  waitForCommand: (type: string, timeoutMs?: number) => Promise<ClientCommand>;
  getReceivedCommands: () => ClientCommand[];
  clearCommands: () => void;
  getClientsCount: () => number;
  disconnectClients: () => void;
  close: () => Promise<void>;
}

export async function startMockWsServer(
  options: StartMockWsOptions = {},
): Promise<MockWsServer> {
  const clients = new Set<WebSocket>();
  const receivedCommands: ClientCommand[] = [];
  const commandWaiters: Array<{
    type: string;
    resolve: (cmd: ClientCommand) => void;
  }> = [];
  const clientWaiters: Array<() => void> = [];

  let currentDelegate: DelegateType = options.initialDelegate ?? "GPU";
  let currentCameraState: string = options.initialStatus ?? "ready";
  let frameSeq = 0;
  let lastTimestampMs = 1000;
  let streamTimer: NodeJS.Timeout | null = null;
  let activeGenerator: FrameGenerator = () => makeCenterGaze();
  let streamMeta: {
    width: number;
    height: number;
    delegate: DelegateType;
    inferenceMs: number;
    cameraFps: number;
    jpegBytes?: Buffer;
  } = {
    width: 1280,
    height: 720,
    delegate: currentDelegate,
    inferenceMs: 4.2,
    cameraFps: 30,
  };

  const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          delegate: currentDelegate,
          cameraState: currentCameraState,
          pid: process.pid,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const broadcastText = (payload: StatusMessage): void => {
    const raw = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(raw);
      }
    }
  };

  const broadcastBinary = (buf: Buffer): void => {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(buf);
      }
    }
  };

  const sendStatus = (
    status: AppStatus,
    message?: string,
    delegate?: DelegateType,
  ): void => {
    currentCameraState = status;
    if (delegate) {
      currentDelegate = delegate;
      streamMeta.delegate = delegate;
    }
    const payload: StatusMessage = {
      type: "status",
      status,
      ...(message !== undefined ? { message } : {}),
      delegate: delegate ?? currentDelegate,
    };
    broadcastText(payload);
  };

  const sendFrame = (opts: SendFrameOptions = {}): void => {
    frameSeq += 1;
    const width = opts.width ?? streamMeta.width;
    const height = opts.height ?? streamMeta.height;
    const delegate = opts.delegate ?? streamMeta.delegate;
    currentDelegate = delegate;
    const timestampMs =
      opts.timestampMs !== undefined ? opts.timestampMs : lastTimestampMs + 33;
    lastTimestampMs = timestampMs;

    const frameData = opts.data ?? makeCenterGaze();
    const defaultJpeg =
      width === 640 && height === 480
        ? SYNTHETIC_JPEG_640X480
        : SYNTHETIC_JPEG_1280X720;
    const jpeg = opts.jpegBytes ?? streamMeta.jpegBytes ?? defaultJpeg;

    const header: FrameHeader = {
      type: "frame",
      timestampMs,
      frameSeq,
      width,
      height,
      cameraFps: opts.cameraFps ?? streamMeta.cameraFps,
      inferenceMs: opts.inferenceMs ?? streamMeta.inferenceMs,
      delegate,
      faceDetected: frameData.faceDetected,
      landmarks: frameData.landmarks,
      blendshapes: frameData.blendshapes,
    };

    broadcastBinary(encodeFramePacket(header, jpeg));
  };

  wss.on("connection", (ws) => {
    clients.add(ws);
    while (clientWaiters.length > 0) {
      const resolve = clientWaiters.shift();
      resolve?.();
    }

    if (options.initialStatus) {
      const initPayload: StatusMessage = {
        type: "status",
        status: options.initialStatus,
        ...(options.initialMessage !== undefined
          ? { message: options.initialMessage }
          : {}),
        delegate: currentDelegate,
      };
      ws.send(JSON.stringify(initPayload));
    }

    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString("utf8")) as ClientCommand;
        receivedCommands.push(parsed);

        for (let i = commandWaiters.length - 1; i >= 0; i--) {
          const waiter = commandWaiters[i]!;
          if (waiter.type === parsed.type) {
            commandWaiters.splice(i, 1);
            waiter.resolve(parsed);
          }
        }

        if (parsed.type === "retry_camera" && options.autoRecoverOnRetry) {
          const recDel = options.recoverDelegate ?? currentDelegate;
          setTimeout(() => sendStatus("requesting-camera", undefined, recDel), 20);
          setTimeout(() => sendStatus("loading-model", undefined, recDel), 45);
          setTimeout(() => sendStatus("ready", undefined, recDel), 75);
        }
      } catch {
        // Ignore malformed client text messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Mock WS server failed to bind ephemeral port");
  }
  const port = addr.port;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const healthUrl = `http://127.0.0.1:${port}/health`;

  const stopStream = (): void => {
    if (streamTimer) {
      clearInterval(streamTimer);
      streamTimer = null;
    }
  };

  const startStream = (
    generator?: FrameGenerator,
    streamOpts: {
      fps?: number;
      width?: number;
      height?: number;
      delegate?: DelegateType;
      inferenceMs?: number;
    } = {},
  ): void => {
    stopStream();
    if (generator) {
      activeGenerator = generator;
    }
    if (streamOpts.width !== undefined) streamMeta.width = streamOpts.width;
    if (streamOpts.height !== undefined) streamMeta.height = streamOpts.height;
    if (streamOpts.delegate !== undefined) {
      streamMeta.delegate = streamOpts.delegate;
      currentDelegate = streamOpts.delegate;
    }
    if (streamOpts.inferenceMs !== undefined) {
      streamMeta.inferenceMs = streamOpts.inferenceMs;
    }
    const fps = streamOpts.fps ?? 30;
    streamMeta.cameraFps = fps;
    const intervalMs = Math.max(10, Math.round(1000 / fps));

    const emitNext = (): void => {
      const generated = activeGenerator(frameSeq + 1);
      if (isSyntheticFrameData(generated)) {
        sendFrame({ data: generated });
      } else {
        sendFrame(generated);
      }
    };

    emitNext();
    streamTimer = setInterval(emitNext, intervalMs);
  };

  const pumpFrames = async (
    count: number,
    generator: FrameGenerator,
    intervalMs = 25,
  ): Promise<void> => {
    for (let i = 0; i < count; i++) {
      const generated = generator(i);
      if (isSyntheticFrameData(generated)) {
        sendFrame({ data: generated });
      } else {
        sendFrame(generated);
      }
      if (intervalMs > 0 && i < count - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  };

  const waitForClient = (timeoutMs = 5000): Promise<void> => {
    if (clients.size > 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = clientWaiters.indexOf(onConnect);
        if (idx >= 0) clientWaiters.splice(idx, 1);
        reject(new Error(`Timed out waiting for WS client after ${timeoutMs}ms`));
      }, timeoutMs);
      const onConnect = (): void => {
        clearTimeout(timer);
        resolve();
      };
      clientWaiters.push(onConnect);
    });
  };

  const waitForCommand = (
    type: string,
    timeoutMs = 5000,
  ): Promise<ClientCommand> => {
    const existing = receivedCommands.find((c) => c.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise<ClientCommand>((resolve, reject) => {
      const entry = {
        type,
        resolve: (cmd: ClientCommand) => {
          clearTimeout(timer);
          resolve(cmd);
        },
      };
      const timer = setTimeout(() => {
        const idx = commandWaiters.indexOf(entry);
        if (idx >= 0) commandWaiters.splice(idx, 1);
        reject(
          new Error(`Timed out waiting for WS command "${type}" after ${timeoutMs}ms`),
        );
      }, timeoutMs);
      commandWaiters.push(entry);
    });
  };

  const disconnectClients = (): void => {
    for (const ws of clients) {
      ws.close();
    }
  };

  const close = async (): Promise<void> => {
    stopStream();
    for (const ws of clients) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
    clients.clear();
    await new Promise<void>((resolve) => {
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });
  };

  return {
    port,
    wsUrl,
    healthUrl,
    sendStatus,
    sendFrame,
    startStream,
    setStreamGenerator: (gen) => {
      activeGenerator = gen;
    },
    setStreamMeta: (meta) => {
      streamMeta = { ...streamMeta, ...meta };
      if (meta.delegate) currentDelegate = meta.delegate;
    },
    stopStream,
    pumpFrames,
    waitForClient,
    waitForCommand,
    getReceivedCommands: () => [...receivedCommands],
    clearCommands: () => {
      receivedCommands.length = 0;
    },
    getClientsCount: () => clients.size,
    disconnectClients,
    close,
  };
}
