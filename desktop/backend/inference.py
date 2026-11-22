"""Native MediaPipe FaceLandmarker wrapper with NVIDIA EGL and CPU XNNPACK support."""

from __future__ import annotations

import math
import os
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from backend import DEFAULT_MODEL_PATH

NVIDIA_EGL_VENDOR = Path("/usr/share/glvnd/egl_vendor.d/10_nvidia.json")


def _configure_egl_vendor() -> None:
    """Select NVIDIA EGL ICD before importing mediapipe so GPU delegate uses RTX GPU."""
    if NVIDIA_EGL_VENDOR.exists():
        os.environ.setdefault("__EGL_VENDOR_LIBRARY_FILENAMES", str(NVIDIA_EGL_VENDOR))


_configure_egl_vendor()

import mediapipe as mp  # type: ignore[import-untyped]  # noqa: E402
from mediapipe.tasks.python import BaseOptions  # type: ignore[import-untyped]  # noqa: E402
from mediapipe.tasks.python.vision import (  # type: ignore[import-untyped]  # noqa: E402
    FaceLandmarker,
    FaceLandmarkerOptions,
    RunningMode,
)

DelegateMode = Literal["auto", "gpu", "cpu"]
ActiveDelegate = Literal["GPU", "CPU"]

EYE_BLENDSHAPE_KEYS: tuple[str, ...] = (
    "eyeLookInLeft",
    "eyeLookOutLeft",
    "eyeLookUpLeft",
    "eyeLookDownLeft",
    "eyeLookInRight",
    "eyeLookOutRight",
    "eyeLookUpRight",
    "eyeLookDownRight",
    "eyeBlinkLeft",
    "eyeBlinkRight",
)


@dataclass(frozen=True, slots=True)
class InferenceResult:
    """Structured MediaPipe FaceLandmarker per-frame output."""

    face_detected: bool
    landmarks: list[list[float]]
    blendshapes: dict[str, float] | None
    inference_ms: float
    delegate: ActiveDelegate


def extract_eye_blendshapes(categories: Sequence[Any] | None) -> dict[str, float] | None:
    """Extract and clamp the 10 eye blendshape scores to [0.0, 1.0]."""
    if not categories:
        return None

    raw_map: dict[str, float] = {}
    for category in categories:
        name = getattr(category, "category_name", None)
        score = getattr(category, "score", None)
        if (
            isinstance(name, str)
            and name in EYE_BLENDSHAPE_KEYS
            and isinstance(score, (int, float))
        ):
            val = float(score)
            raw_map[name] = min(1.0, max(0.0, val)) if math.isfinite(val) else 0.0

    if not raw_map:
        return None

    return {key: raw_map.get(key, 0.0) for key in EYE_BLENDSHAPE_KEYS}


class NativeEyeEngine:
    """Thread-safe MediaPipe FaceLandmarker VIDEO-mode inference engine."""

    def __init__(
        self,
        model_path: Path | str = DEFAULT_MODEL_PATH,
        min_face_detection_confidence: float = 0.45,
        min_face_presence_confidence: float = 0.45,
        min_tracking_confidence: float = 0.45,
    ) -> None:
        self.model_path = Path(model_path)
        self.min_face_detection_confidence = min_face_detection_confidence
        self.min_face_presence_confidence = min_face_presence_confidence
        self.min_tracking_confidence = min_tracking_confidence

        self._lock = threading.Lock()
        self._landmarker: FaceLandmarker | None = None
        self._active_delegate: ActiveDelegate = "CPU"
        self._last_ts_ms: int = -1

    @property
    def active_delegate(self) -> ActiveDelegate:
        with self._lock:
            return self._active_delegate

    def init(self, delegate: DelegateMode = "auto") -> ActiveDelegate:
        """Load the offline FaceLandmarker model with GPU->CPU fallback."""
        if delegate not in ("auto", "gpu", "cpu"):
            raise ValueError(f"Unsupported delegate mode: {delegate!r}")

        if not self.model_path.is_file():
            raise FileNotFoundError(f"Model file not found: {self.model_path}")

        if delegate in ("auto", "gpu"):
            candidates: list[tuple[ActiveDelegate, Any]] = [
                ("GPU", BaseOptions.Delegate.GPU),
                ("CPU", BaseOptions.Delegate.CPU),
            ]
        else:
            candidates = [("CPU", BaseOptions.Delegate.CPU)]

        with self._lock:
            last_exc: Exception | None = None
            for label, delegate_enum in candidates:
                try:
                    options = FaceLandmarkerOptions(
                        base_options=BaseOptions(
                            model_asset_path=str(self.model_path),
                            delegate=delegate_enum,
                        ),
                        running_mode=RunningMode.VIDEO,
                        num_faces=1,
                        min_face_detection_confidence=self.min_face_detection_confidence,
                        min_face_presence_confidence=self.min_face_presence_confidence,
                        min_tracking_confidence=self.min_tracking_confidence,
                        output_face_blendshapes=True,
                        output_facial_transformation_matrixes=True,
                    )
                    new_landmarker = FaceLandmarker.create_from_options(options)
                except Exception as exc:
                    last_exc = exc
                    continue

                old_landmarker = self._landmarker
                self._landmarker = new_landmarker
                self._active_delegate = label
                self._last_ts_ms = -1
                if old_landmarker is not None:
                    try:
                        old_landmarker.close()
                    except Exception:
                        pass
                return label

            raise RuntimeError(
                f"Failed to initialize FaceLandmarker for delegate={delegate!r}: {last_exc}"
            ) from last_exc

    def detect(
        self,
        frame_bgr: NDArray[Any] | None,
        timestamp_ms: int | float | None = None,
    ) -> InferenceResult:
        """Run FaceLandmarker on a BGR uint8 frame with monotonic timestamp enforcement."""
        with self._lock:
            if (
                frame_bgr is None
                or not isinstance(frame_bgr, np.ndarray)
                or frame_bgr.ndim != 3
                or frame_bgr.size == 0
                or frame_bgr.shape[0] <= 0
                or frame_bgr.shape[1] <= 0
                or frame_bgr.shape[2] != 3
                or frame_bgr.dtype != np.uint8
            ):
                return InferenceResult(
                    face_detected=False,
                    landmarks=[],
                    blendshapes=None,
                    inference_ms=0.0,
                    delegate=self._active_delegate,
                )

            if self._landmarker is None:
                raise RuntimeError("NativeEyeEngine is not initialized. Call init() first.")

            if timestamp_ms is not None and math.isfinite(float(timestamp_ms)):
                candidate_ms = int(round(float(timestamp_ms)))
            else:
                candidate_ms = int(round(time.perf_counter() * 1000.0))

            ts_ms = max(candidate_ms, self._last_ts_ms + 1)
            self._last_ts_ms = ts_ms

            rgb = np.ascontiguousarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            t0 = time.perf_counter()
            result = self._landmarker.detect_for_video(mp_image, ts_ms)
            inference_ms = (time.perf_counter() - t0) * 1000.0

            if result.face_landmarks:
                raw_landmarks = result.face_landmarks[0]
                landmarks = [
                    [float(lm.x), float(lm.y), float(lm.z)] for lm in raw_landmarks
                ]
                categories = (
                    result.face_blendshapes[0]
                    if getattr(result, "face_blendshapes", None)
                    else None
                )
                blendshapes = extract_eye_blendshapes(categories)
                return InferenceResult(
                    face_detected=True,
                    landmarks=landmarks,
                    blendshapes=blendshapes,
                    inference_ms=inference_ms,
                    delegate=self._active_delegate,
                )

            return InferenceResult(
                face_detected=False,
                landmarks=[],
                blendshapes=None,
                inference_ms=inference_ms,
                delegate=self._active_delegate,
            )

    def close(self) -> None:
        """Close the underlying FaceLandmarker cleanly."""
        with self._lock:
            landmarker = self._landmarker
            self._landmarker = None
            self._last_ts_ms = -1
            if landmarker is not None:
                try:
                    landmarker.close()
                except Exception:
                    pass
