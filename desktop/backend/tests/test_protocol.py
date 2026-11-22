"""Unit tests for backend.protocol binary packet encoding and JSON schemas."""

from __future__ import annotations

import json
import struct

import cv2
import numpy as np
import pytest

from backend.protocol import (
    build_frame_header,
    decode_frame_packet,
    encode_frame_packet,
    encode_jpeg,
    encode_status_message,
    parse_client_command,
)


def test_encode_jpeg_preserves_bgr_color_order() -> None:
    # Solid blue frame in BGR: B=240, G=10, R=10.
    bgr = np.zeros((64, 64, 3), dtype=np.uint8)
    bgr[:, :] = (240, 10, 10)
    jpeg = encode_jpeg(bgr, quality=90)
    assert jpeg.startswith(b"\xff\xd8\xff")

    decoded = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None
    mean_b, mean_g, mean_r = decoded.mean(axis=(0, 1))
    assert mean_b > 200.0
    assert mean_r < 40.0
    assert mean_g < 40.0


def test_frame_packet_round_trip_and_schema() -> None:
    bgr = np.full((120, 160, 3), 128, dtype=np.uint8)
    jpeg = encode_jpeg(bgr, quality=80)
    landmarks = [[0.5, 0.5, 0.0]] * 478
    blendshapes = {"eyeBlinkLeft": 0.1, "eyeBlinkRight": 0.2}

    header = build_frame_header(
        timestamp_ms=1234.5678,
        frame_seq=7,
        width=160,
        height=120,
        camera_fps=29.97,
        inference_ms=4.1234,
        delegate="GPU",
        face_detected=True,
        landmarks=landmarks,
        blendshapes=blendshapes,
    )
    packet = encode_frame_packet(header, jpeg)

    (prefix_len,) = struct.unpack(">I", packet[:4])
    assert prefix_len > 0
    decoded_header, decoded_jpeg = decode_frame_packet(packet)
    assert decoded_jpeg == jpeg
    assert decoded_header["type"] == "frame"
    assert decoded_header["frameSeq"] == 7
    assert decoded_header["width"] == 160
    assert decoded_header["height"] == 120
    assert decoded_header["delegate"] == "GPU"
    assert decoded_header["faceDetected"] is True
    assert len(decoded_header["landmarks"]) == 478
    assert decoded_header["blendshapes"] == blendshapes


def test_frame_header_no_face_clears_landmarks_and_blendshapes() -> None:
    header = build_frame_header(
        timestamp_ms=100.0,
        frame_seq=1,
        width=1280,
        height=720,
        camera_fps=30.0,
        inference_ms=2.0,
        delegate="CPU",
        face_detected=False,
        landmarks=[[0.1, 0.2, 0.3]],
        blendshapes={"eyeBlinkLeft": 0.5},
    )
    assert header["landmarks"] == []
    assert header["blendshapes"] is None


def test_decode_frame_packet_rejects_malformed() -> None:
    with pytest.raises(ValueError):
        decode_frame_packet(b"\x00\x01")
    with pytest.raises(ValueError):
        decode_frame_packet(struct.pack(">I", 100) + b"{}")
    with pytest.raises(ValueError):
        decode_frame_packet(struct.pack(">I", 2) + b"[]")


def test_status_and_client_command_parsing() -> None:
    status = json.loads(encode_status_message("camera-busy", "GPU", "Busy by firefox"))
    assert status == {
        "type": "status",
        "status": "camera-busy",
        "message": "Busy by firefox",
        "delegate": "GPU",
    }

    assert parse_client_command('{"type":"retry_camera"}') == {"type": "retry_camera"}
    assert parse_client_command(b'{"type":"shutdown"}') == {"type": "shutdown"}
    assert parse_client_command('{"type":"set_delegate","delegate":"cpu"}') == {
        "type": "set_delegate",
        "delegate": "cpu",
    }
    assert parse_client_command('{"type":"set_delegate","delegate":"tpu"}') is None
    assert parse_client_command('{"type":"unknown"}') is None
    assert parse_client_command("not-json") is None
