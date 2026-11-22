import { describe, expect, it, vi } from "vitest";
import {
  NativeStreamClient,
  decodeFramePacket,
  parseStatusMessage,
  type DecodedFramePacket,
  type NativeFrameHeader,
  type NativeStatusMessage,
  type WebSocketLike,
} from "./streamClient";

function encodePacket(header: object, payloadBytes: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + jsonBytes.byteLength + payloadBytes.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, jsonBytes.byteLength, false);
  out.set(jsonBytes, 4);
  out.set(payloadBytes, 4 + jsonBytes.byteLength);
  return out;
}

class MockWebSocket implements WebSocketLike {
  binaryType = "blob";
  readyState = 0; // CONNECTING
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose:
    | ((ev: { code?: number; reason?: string; wasClean?: boolean }) => void)
    | null = null;
  readonly sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3; // CLOSED
    this.closedWith = { code, reason };
  }

  triggerOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  triggerMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  triggerError(err: unknown): void {
    this.onerror?.(err);
  }

  triggerClose(ev: { code?: number; reason?: string; wasClean?: boolean }): void {
    this.readyState = 3;
    this.onclose?.(ev);
  }
}

describe("decodeFramePacket", () => {
  it("decodes a valid 478-landmark + 10-blendshape + JPEG binary packet", () => {
    const landmarks: [number, number, number][] = Array.from(
      { length: 478 },
      (_, idx) => [0.25 + idx * 0.001, 0.35 + idx * 0.0005, -0.02],
    );
    const header: NativeFrameHeader = {
      type: "frame",
      timestampMs: 12345.67,
      frameSeq: 42,
      width: 1280,
      height: 720,
      cameraFps: 30,
      inferenceMs: 4.2,
      delegate: "GPU",
      faceDetected: true,
      landmarks,
      blendshapes: {
        eyeLookInLeft: 0.1,
        eyeLookOutLeft: 0.2,
        eyeLookUpLeft: 0.05,
        eyeLookDownLeft: 0.02,
        eyeLookInRight: 0.15,
        eyeLookOutRight: 0.18,
        eyeLookUpRight: 0.06,
        eyeLookDownRight: 0.03,
        eyeBlinkLeft: 0.01,
        eyeBlinkRight: 0.02,
      },
    };
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const packetBytes = encodePacket(header, jpeg);

    const decoded = decodeFramePacket(packetBytes.buffer);
    expect(decoded.header.frameSeq).toBe(42);
    expect(decoded.header.delegate).toBe("GPU");
    expect(decoded.header.faceDetected).toBe(true);
    expect(decoded.faceLandmarks).toHaveLength(478);
    expect(decoded.faceLandmarks?.[0]).toEqual({
      x: 0.25,
      y: 0.35,
      z: -0.02,
    });
    expect(decoded.faceLandmarks?.[477]?.x).toBeCloseTo(0.25 + 477 * 0.001, 6);
    expect(decoded.faceBlendshapes).toEqual(header.blendshapes);
    expect(Array.from(decoded.jpegBytes)).toEqual(Array.from(jpeg));
    expect(decoded.jpegBytes[0]).toBe(0xff);
    expect(decoded.jpegBytes[1]).toBe(0xd8);
  });

  it("handles faceDetected=false with empty landmarks and null blendshapes", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const packetBytes = encodePacket(
      {
        type: "frame",
        timestampMs: 99,
        frameSeq: 1,
        width: 1280,
        height: 720,
        cameraFps: 30,
        inferenceMs: 5.1,
        delegate: "CPU",
        faceDetected: false,
        landmarks: [],
        blendshapes: null,
      },
      jpeg,
    );

    const decoded = decodeFramePacket(packetBytes);
    expect(decoded.header.faceDetected).toBe(false);
    expect(decoded.header.delegate).toBe("CPU");
    expect(decoded.faceLandmarks).toBeNull();
    expect(decoded.faceBlendshapes).toBeNull();
    expect(Array.from(decoded.jpegBytes)).toEqual(Array.from(jpeg));
  });

  it("decodes Uint8Array subarrays with non-zero byteOffset accurately", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
    const rawPacket = encodePacket(
      {
        type: "frame",
        timestampMs: 500,
        frameSeq: 7,
        width: 640,
        height: 480,
        cameraFps: 29.9,
        inferenceMs: 3.3,
        delegate: "CPU",
        faceDetected: false,
        landmarks: [],
        blendshapes: null,
      },
      jpeg,
    );

    const padded = new Uint8Array(rawPacket.byteLength + 16);
    padded.fill(0xaa);
    padded.set(rawPacket, 9);
    const sub = padded.subarray(9, 9 + rawPacket.byteLength);

    const decoded = decodeFramePacket(sub);
    expect(decoded.header.frameSeq).toBe(7);
    expect(Array.from(decoded.jpegBytes)).toEqual(Array.from(jpeg));
  });

  it("rejects malformed packets cleanly", () => {
    expect(() => decodeFramePacket(new Uint8Array([1, 2, 3]))).toThrow();

    const zeroLen = new Uint8Array([0, 0, 0, 0, 123, 125]);
    expect(() => decodeFramePacket(zeroLen)).toThrow();

    const overflowLen = new Uint8Array([0, 0, 0, 100, 123, 125]);
    expect(() => decodeFramePacket(overflowLen)).toThrow();

    const badJson = new Uint8Array([0, 0, 0, 4, 0x6e, 0x6f, 0x70, 0x65]);
    expect(() => decodeFramePacket(badJson)).toThrow();

    const wrongType = encodePacket({ type: "status", status: "ready" }, new Uint8Array(0));
    expect(() => decodeFramePacket(wrongType)).toThrow();
  });
});

describe("parseStatusMessage", () => {
  it("parses all 7 AppStatus values including camera-busy, falls back on unknown status, and rejects invalid JSON", () => {
    const statuses = [
      "loading-model",
      "requesting-camera",
      "ready",
      "permission-denied",
      "no-camera",
      "camera-busy",
      "error",
    ] as const;

    for (const status of statuses) {
      const parsed = parseStatusMessage(
        JSON.stringify({
          type: "status",
          status,
          message: `detail:${status}`,
          delegate: "GPU",
        }),
      );
      expect(parsed).toEqual({
        type: "status",
        status,
        message: `detail:${status}`,
        delegate: "GPU",
      });
    }

    const unknown = parseStatusMessage(
      JSON.stringify({ type: "status", status: "unexpected-state" }),
    );
    expect(unknown).toEqual({ type: "status", status: "error" });

    expect(parseStatusMessage("{invalid")).toBeNull();
    expect(parseStatusMessage(JSON.stringify({ type: "frame" }))).toBeNull();
  });
});

describe("NativeStreamClient", () => {
  it("connects, receives status and frame packets, sends commands, reports errors, and disconnects cleanly", () => {
    const sockets: MockWebSocket[] = [];
    const frames: DecodedFramePacket[] = [];
    const statuses: NativeStatusMessage[] = [];
    const errors: Error[] = [];
    const onOpen = vi.fn();
    const onClose = vi.fn();

    const client = new NativeStreamClient({
      wsUrl: "ws://127.0.0.1:41234/ws",
      onFrame: (f) => frames.push(f),
      onStatus: (s) => statuses.push(s),
      onOpen,
      onClose,
      onError: (e) => errors.push(e),
      webSocketFactory: () => {
        const ws = new MockWebSocket();
        sockets.push(ws);
        return ws;
      },
    });

    expect(client.isConnected()).toBe(false);
    expect(client.retryCamera()).toBe(false);

    client.connect();
    expect(sockets).toHaveLength(1);
    const ws = sockets[0]!;
    expect(ws.binaryType).toBe("arraybuffer");

    ws.triggerOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(true);

    expect(client.retryCamera()).toBe(true);
    expect(client.setDelegate("cpu")).toBe(true);
    expect(client.shutdown()).toBe(true);
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([
      { type: "retry_camera" },
      { type: "set_delegate", delegate: "cpu" },
      { type: "shutdown" },
    ]);

    ws.triggerMessage(
      JSON.stringify({ type: "status", status: "ready", delegate: "GPU" }),
    );
    expect(statuses).toEqual([
      { type: "status", status: "ready", delegate: "GPU" },
    ]);

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const validBinary = encodePacket(
      {
        type: "frame",
        timestampMs: 100,
        frameSeq: 1,
        width: 1280,
        height: 720,
        cameraFps: 30,
        inferenceMs: 3.1,
        delegate: "GPU",
        faceDetected: false,
        landmarks: [],
        blendshapes: null,
      },
      jpeg,
    );
    ws.triggerMessage(validBinary.buffer);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.header.frameSeq).toBe(1);

    // Malformed binary packet triggers onError without throwing
    ws.triggerMessage(new Uint8Array([0, 0]).buffer);
    expect(errors).toHaveLength(1);

    ws.triggerError(new Error("socket_failure"));
    expect(errors).toHaveLength(2);
    expect(errors[1]?.message).toBe("socket_failure");

    ws.triggerClose({ code: 1006, reason: "abnormal", wasClean: false });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);

    // Reconnect then disconnect cleanly
    client.connect();
    const ws2 = sockets[1]!;
    ws2.triggerOpen();
    expect(client.isConnected()).toBe(true);

    client.disconnect(1000, "test_done");
    expect(client.isConnected()).toBe(false);
    expect(ws2.closedWith).toEqual({ code: 1000, reason: "test_done" });
    expect(ws2.onopen).toBeNull();
    expect(ws2.onmessage).toBeNull();
    expect(ws2.onerror).toBeNull();
    expect(ws2.onclose).toBeNull();
    expect(client.shutdown()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
