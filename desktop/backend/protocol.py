"""Binary WebSocket frame packet encoder/decoder and JSON control schemas."""

from __future__ import annotations

import json
import struct
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

VALID_CLIENT_COMMANDS = frozenset({"retry_camera", "set_delegate", "shutdown"})
VALID_DELEGATES = frozenset({"auto", "gpu", "cpu"})


def encode_jpeg(frame_bgr: NDArray[np.uint8], quality: int = 80) -> bytes:
    """Encode a BGR uint8 frame to JPEG bytes."""
    if frame_bgr.ndim != 3 or frame_bgr.shape[2] != 3 or frame_bgr.size == 0:
        raise ValueError("Expected non-empty HxWx3 BGR frame for JPEG encoding.")
    clamped_quality = max(1, min(100, int(quality)))
    ok, encoded = cv2.imencode(
        ".jpg",
        frame_bgr,
        [int(cv2.IMWRITE_JPEG_QUALITY), clamped_quality],
    )
    if not ok:
        raise ValueError("cv2.imencode('.jpg', ...) failed.")
    return encoded.tobytes()


def build_frame_header(
    *,
    timestamp_ms: float,
    frame_seq: int,
    width: int,
    height: int,
    camera_fps: float,
    inference_ms: float,
    delegate: str,
    face_detected: bool,
    landmarks: list[list[float]],
    blendshapes: dict[str, float] | None,
) -> dict[str, Any]:
    """Build the telemetry JSON header matching PROJECT.md Interface Contract #2."""
    return {
        "type": "frame",
        "timestampMs": round(float(timestamp_ms), 3),
        "frameSeq": int(frame_seq),
        "width": int(width),
        "height": int(height),
        "cameraFps": round(float(camera_fps), 2),
        "inferenceMs": round(float(inference_ms), 3),
        "delegate": str(delegate),
        "faceDetected": bool(face_detected),
        "landmarks": landmarks if face_detected else [],
        "blendshapes": blendshapes if face_detected else None,
    }


def encode_frame_packet(header: dict[str, Any], jpeg_bytes: bytes) -> bytes:
    """Pack [4-byte uint32 BE headerLen][UTF-8 JSON header][JPEG bytes]."""
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(header_bytes)) + header_bytes + jpeg_bytes


def decode_frame_packet(packet: bytes) -> tuple[dict[str, Any], bytes]:
    """Decode a binary frame packet into (header_dict, jpeg_bytes)."""
    if len(packet) < 4:
        raise ValueError("Packet too short to contain 4-byte header length.")
    (header_len,) = struct.unpack(">I", packet[:4])
    if 4 + header_len > len(packet):
        raise ValueError(
            f"Truncated frame packet: header_len={header_len}, total={len(packet)}."
        )
    header_raw = packet[4 : 4 + header_len]
    header = json.loads(header_raw.decode("utf-8"))
    if not isinstance(header, dict):
        raise ValueError("Frame packet header JSON must be an object.")
    jpeg_bytes = packet[4 + header_len :]
    return header, jpeg_bytes


def encode_status_message(status: str, delegate: str, message: str = "") -> str:
    """Serialize a server status/error text message."""
    return json.dumps(
        {
            "type": "status",
            "status": status,
            "message": message,
            "delegate": delegate,
        },
        separators=(",", ":"),
    )


def parse_client_command(raw: str | bytes) -> dict[str, Any] | None:
    """Parse and validate a client->server JSON text command."""
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        data = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None

    if not isinstance(data, dict):
        return None

    cmd_type = data.get("type")
    if cmd_type not in VALID_CLIENT_COMMANDS:
        return None

    if cmd_type == "set_delegate":
        delegate = data.get("delegate")
        if not isinstance(delegate, str) or delegate not in VALID_DELEGATES:
            return None
        return {"type": "set_delegate", "delegate": delegate}

    return {"type": str(cmd_type)}
