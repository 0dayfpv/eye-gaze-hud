"""Unit tests for backend.inference MediaPipe FaceLandmarker wrapper."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from backend import DEFAULT_MODEL_PATH
from backend.inference import EYE_BLENDSHAPE_KEYS, NativeEyeEngine, extract_eye_blendshapes


@dataclass
class FakeCategory:
    category_name: str
    score: float


def test_default_model_asset_exists() -> None:
    assert DEFAULT_MODEL_PATH.is_file()
    assert DEFAULT_MODEL_PATH.stat().st_size == 3758596


def test_extract_eye_blendshapes_clamps_and_validates() -> None:
    assert extract_eye_blendshapes(None) is None
    assert extract_eye_blendshapes([]) is None
    assert extract_eye_blendshapes([FakeCategory("jawOpen", 0.5)]) is None

    extracted = extract_eye_blendshapes(
        [
            FakeCategory("eyeBlinkLeft", 1.5),
            FakeCategory("eyeBlinkRight", -0.2),
            FakeCategory("eyeLookInLeft", float("nan")),
            FakeCategory("eyeLookOutRight", 0.42),
            FakeCategory("jawOpen", 0.9),
        ]
    )
    assert extracted is not None
    assert set(extracted.keys()) == set(EYE_BLENDSHAPE_KEYS)
    assert extracted["eyeBlinkLeft"] == 1.0
    assert extracted["eyeBlinkRight"] == 0.0
    assert extracted["eyeLookInLeft"] == 0.0
    assert extracted["eyeLookOutRight"] == pytest.approx(0.42)


def test_engine_init_validation_and_guards(tmp_path: Path) -> None:
    missing_engine = NativeEyeEngine(model_path=tmp_path / "missing.task")
    with pytest.raises(FileNotFoundError):
        missing_engine.init("cpu")

    engine = NativeEyeEngine()
    with pytest.raises(ValueError):
        engine.init("invalid")  # type: ignore[arg-type]

    with pytest.raises(RuntimeError):
        engine.detect(np.zeros((720, 1280, 3), dtype=np.uint8), timestamp_ms=10)

    delegate = engine.init("cpu")
    assert delegate == "CPU"
    try:
        bad_frames: list[Any] = [
            None,
            np.zeros((0, 0, 3), dtype=np.uint8),
            np.zeros((64, 64), dtype=np.uint8),
            np.zeros((64, 64, 4), dtype=np.uint8),
            np.zeros((64, 64, 3), dtype=np.float32),
        ]
        for bad_frame in bad_frames:
            res = engine.detect(bad_frame)
            assert res.face_detected is False
            assert res.landmarks == []
            assert res.blendshapes is None
    finally:
        engine.close()


def test_engine_monotonic_timestamps_and_720p_latency() -> None:
    engine = NativeEyeEngine()
    delegate = engine.init("auto")
    assert delegate in ("GPU", "CPU")
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    try:
        # Warmup
        for ts in (1000, 1033, 1066):
            engine.detect(frame, timestamp_ms=ts)

        # Out-of-order decreasing timestamp must be clamped monotonically without crashing.
        res_decreasing = engine.detect(frame, timestamp_ms=500)
        assert res_decreasing.delegate == delegate
        assert res_decreasing.face_detected is False

        latencies = [
            engine.detect(frame, timestamp_ms=2000 + i * 33).inference_ms
            for i in range(10)
        ]
        avg_ms = sum(latencies) / len(latencies)
        assert avg_ms <= 20.0
    finally:
        engine.close()
