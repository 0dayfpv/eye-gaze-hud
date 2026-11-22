"""V4L2 zero-lag webcam capture with structured Linux error taxonomy."""

from __future__ import annotations

import errno
import os
import struct
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore[assignment]

import cv2
import numpy as np
from numpy.typing import NDArray

CameraStatusCode = Literal[
    "requesting-camera",
    "ready",
    "no-camera",
    "camera-busy",
    "permission-denied",
    "error",
]


@dataclass(frozen=True, slots=True)
class CameraState:
    """Structured camera lifecycle state reported to UI/clients."""

    status: CameraStatusCode
    message: str
    device_index: int


@dataclass(slots=True)
class CapturedFrame:
    """Single captured BGR video frame with monotonic sequence and timing."""

    seq: int
    timestamp_ms: float
    frame_bgr: NDArray[np.uint8]
    width: int
    height: int
    fps: float


def find_video_device_holders(
    dev_path: Path,
    proc_root: Path = Path("/proc"),
) -> list[tuple[int, str]]:
    """Scan /proc/<pid>/fd for other processes holding the given video device."""
    real_dev = os.path.realpath(dev_path)
    dev_str = str(dev_path)
    self_pid = os.getpid()
    holders: list[tuple[int, str]] = []

    if not proc_root.is_dir():
        return holders

    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return holders

    for entry in entries:
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == self_pid:
            continue

        fd_dir = entry / "fd"
        try:
            fd_entries = list(fd_dir.iterdir())
        except OSError:
            continue

        matched = False
        for fd_path in fd_entries:
            try:
                target = os.readlink(fd_path)
            except OSError:
                continue
            if target == real_dev or target == dev_str:
                matched = True
                break

        if matched:
            try:
                comm = (entry / "comm").read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                comm = ""
            holders.append((pid, comm or "unknown"))

    holders.sort(key=lambda item: item[0])
    return holders


def classify_v4l2_failure(
    device_index: int,
    exc: BaseException | None = None,
    *,
    dev_root: Path = Path("/dev"),
    proc_root: Path = Path("/proc"),
) -> CameraState:
    """Classify why opening /dev/video<index> failed on Linux V4L2."""
    dev_path = dev_root / f"video{device_index}"

    if isinstance(exc, OSError):
        if exc.errno in (errno.ENOENT, errno.ENODEV):
            return CameraState(
                status="no-camera",
                message=f"No camera device found at {dev_path}.",
                device_index=device_index,
            )
        if exc.errno in (errno.EACCES, errno.EPERM):
            return CameraState(
                status="permission-denied",
                message=f"Permission denied accessing {dev_path}.",
                device_index=device_index,
            )
        if exc.errno == errno.EBUSY:
            holders = find_video_device_holders(dev_path, proc_root=proc_root)
            if holders:
                pid, comm = holders[0]
                return CameraState(
                    status="camera-busy",
                    message=f"Camera {dev_path} is in use by {comm} (PID {pid}).",
                    device_index=device_index,
                )
            return CameraState(
                status="camera-busy",
                message=f"Camera {dev_path} is busy.",
                device_index=device_index,
            )

    if not dev_path.exists():
        return CameraState(
            status="no-camera",
            message=f"No camera device found at {dev_path}.",
            device_index=device_index,
        )

    if not os.access(dev_path, os.R_OK | os.W_OK):
        return CameraState(
            status="permission-denied",
            message=f"Permission denied accessing {dev_path}.",
            device_index=device_index,
        )

    holders = find_video_device_holders(dev_path, proc_root=proc_root)
    if holders:
        pid, comm = holders[0]
        return CameraState(
            status="camera-busy",
            message=f"Camera {dev_path} is in use by {comm} (PID {pid}).",
            device_index=device_index,
        )

    detail = f" ({exc})" if exc is not None else ""
    return CameraState(
        status="error",
        message=f"Failed to open camera at {dev_path}{detail}.",
        device_index=device_index,
    )


class CameraCapture:
    """Dedicated capture thread maintaining a single-slot latest-frame buffer."""

    def __init__(
        self,
        camera_index: int = 0,
        width: int = 1280,
        height: int = 720,
        fps: int = 60,
        mock_video: str | None = None,
        no_camera: bool = False,
        capture_factory: Callable[..., Any] | None = None,
        on_state_change: Callable[[CameraState], None] | None = None,
        dev_root: Path = Path("/dev"),
        proc_root: Path = Path("/proc"),
        max_consecutive_failures: int = 60,
    ) -> None:
        self.camera_index = camera_index
        self.width = width
        self.height = height
        self.fps = fps
        self.mock_video = mock_video
        self.no_camera = no_camera
        self._capture_factory = capture_factory
        self._on_state_change = on_state_change
        self._dev_root = dev_root
        self._proc_root = proc_root
        self._max_consecutive_failures = max(1, max_consecutive_failures)

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._cap: Any | None = None
        self._seq = 0
        self._latest_frame: CapturedFrame | None = None
        self._state = CameraState(
            status="requesting-camera",
            message="Initializing camera...",
            device_index=camera_index,
        )

    @property
    def state(self) -> CameraState:
        with self._lock:
            return self._state

    def _emit_state(self, new_state: CameraState) -> CameraState:
        with self._lock:
            self._state = new_state
        if self._on_state_change is not None:
            self._on_state_change(new_state)
        return new_state

    def start(self) -> CameraState:
        """Open camera or mock video source and start latest-frame capture thread."""
        self.stop()
        self._emit_state(
            CameraState(
                status="requesting-camera",
                message=f"Requesting camera /dev/video{self.camera_index}...",
                device_index=self.camera_index,
            )
        )

        if self.no_camera:
            return self._emit_state(
                CameraState(
                    status="no-camera",
                    message="Camera disabled (--no-camera).",
                    device_index=self.camera_index,
                )
            )

        factory: Callable[..., Any] = (
            self._capture_factory if self._capture_factory is not None else cv2.VideoCapture
        )

        if self.mock_video is not None:
            try:
                cap = factory(self.mock_video)
            except Exception as exc:
                return self._emit_state(
                    CameraState(
                        status="error",
                        message=f"Failed to open mock video {self.mock_video}: {exc}",
                        device_index=self.camera_index,
                    )
                )
            if cap is None or not cap.isOpened():
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                return self._emit_state(
                    CameraState(
                        status="error",
                        message=f"Failed to open mock video: {self.mock_video}",
                        device_index=self.camera_index,
                    )
                )

            self._cap = cap
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._capture_loop,
                kwargs={"is_mock": True},
                name="camera-mock-capture",
                daemon=True,
            )
            self._thread.start()
            return self._emit_state(
                CameraState(
                    status="ready",
                    message=f"Mock video active: {self.mock_video}",
                    device_index=self.camera_index,
                )
            )

        if sys.platform == "win32":
            try:
                cap = factory(self.camera_index, cv2.CAP_DSHOW)
                if cap is None or not cap.isOpened():
                    if cap is not None:
                        cap.release()
                    cap = factory(self.camera_index, cv2.CAP_ANY)
            except Exception as exc:
                return self._emit_state(
                    CameraState(
                        status="error",
                        message=f"Failed to open camera {self.camera_index}: {exc}",
                        device_index=self.camera_index,
                    )
                )
            if cap is None or not cap.isOpened():
                return self._emit_state(
                    CameraState(
                        status="no-camera",
                        message=f"No camera device found at index {self.camera_index}.",
                        device_index=self.camera_index,
                    )
                )
            fourcc = float(cv2.VideoWriter.fourcc("M", "J", "P", "G"))
            cap.set(cv2.CAP_PROP_FOURCC, fourcc)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(self.width))
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(self.height))
            cap.set(cv2.CAP_PROP_FPS, float(self.fps))
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1.0)
            self._cap = cap
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._capture_loop,
                kwargs={"is_mock": False},
                name="camera-dshow-capture",
                daemon=True,
            )
            self._thread.start()
            return self._emit_state(
                CameraState(
                    status="ready",
                    message=f"Camera {self.camera_index} ready.",
                    device_index=self.camera_index,
                )
            )

        dev_path = self._dev_root / f"video{self.camera_index}"
        if not dev_path.exists() or not os.access(dev_path, os.R_OK | os.W_OK):
            return self._emit_state(
                classify_v4l2_failure(
                    self.camera_index,
                    dev_root=self._dev_root,
                    proc_root=self._proc_root,
                )
            )

        try:
            cap = factory(self.camera_index, cv2.CAP_V4L2)
        except Exception as exc:
            return self._emit_state(
                classify_v4l2_failure(
                    self.camera_index,
                    exc=exc,
                    dev_root=self._dev_root,
                    proc_root=self._proc_root,
                )
            )

        if cap is None or not cap.isOpened():
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            return self._emit_state(
                classify_v4l2_failure(
                    self.camera_index,
                    dev_root=self._dev_root,
                    proc_root=self._proc_root,
                )
            )

        # Configure V4L2 MJPG and minimal buffer queue for low latency.
        fourcc = float(cv2.VideoWriter.fourcc("M", "J", "P", "G"))
        cap.set(cv2.CAP_PROP_FOURCC, fourcc)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, float(self.width))
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, float(self.height))
        cap.set(cv2.CAP_PROP_FPS, float(self.fps))
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1.0)
        # Disable V4L2 dynamic framerate (V4L2_CID_EXPOSURE_AUTO_PRIORITY=0) so low light
        # doesn't throttle webcam hardware from 30 FPS down to 9-13 FPS.
        self._disable_v4l2_dynamic_framerate(dev_path)

        self._cap = cap
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._capture_loop,
            kwargs={"is_mock": False},
            name="camera-v4l2-capture",
            daemon=True,
        )
        self._thread.start()
        return self._emit_state(
            CameraState(
                status="ready",
                message=f"Camera /dev/video{self.camera_index} ready.",
                device_index=self.camera_index,
            )
        )

    def _capture_loop(self, *, is_mock: bool) -> None:
        cap = self._cap
        if cap is None:
            return

        consecutive_failures = 0
        last_frame_t = time.perf_counter()
        ema_fps = float(max(1, self.fps))
        mock_interval = 1.0 / float(max(1, self.fps))

        while not self._stop_event.is_set():
            loop_start = time.perf_counter()
            try:
                ok, frame = cap.read()
            except Exception as exc:
                if self._stop_event.is_set():
                    break
                consecutive_failures += 1
                if consecutive_failures >= self._max_consecutive_failures:
                    err_state = (
                        CameraState(
                            status="error",
                            message=f"Mock video read error: {exc}",
                            device_index=self.camera_index,
                        )
                        if is_mock
                        else classify_v4l2_failure(
                            self.camera_index,
                            exc=exc,
                            dev_root=self._dev_root,
                            proc_root=self._proc_root,
                        )
                    )
                    self._emit_state(err_state)
                    break
                time.sleep(0.03)
                continue

            if not ok or frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
                if is_mock:
                    try:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        ok, frame = cap.read()
                    except Exception:
                        ok, frame = False, None

                if not ok or frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
                    consecutive_failures += 1
                    if consecutive_failures >= self._max_consecutive_failures:
                        err_state = (
                            CameraState(
                                status="error",
                                message=f"Mock video ended or failed: {self.mock_video}",
                                device_index=self.camera_index,
                            )
                            if is_mock
                            else classify_v4l2_failure(
                                self.camera_index,
                                dev_root=self._dev_root,
                                proc_root=self._proc_root,
                            )
                        )
                        self._emit_state(err_state)
                        break
                    time.sleep(0.03)
                    continue

            consecutive_failures = 0
            now = time.perf_counter()
            dt = now - last_frame_t
            last_frame_t = now
            if dt > 1e-4:
                inst_fps = min(120.0, 1.0 / dt)
                ema_fps = 0.85 * ema_fps + 0.15 * inst_fps

            frame_u8: NDArray[np.uint8] = (
                frame if frame.dtype == np.uint8 else frame.astype(np.uint8, copy=False)
            )
            with self._lock:
                self._seq += 1
                self._latest_frame = CapturedFrame(
                    seq=self._seq,
                    timestamp_ms=now * 1000.0,
                    frame_bgr=frame_u8,
                    width=int(frame_u8.shape[1]),
                    height=int(frame_u8.shape[0]),
                    fps=ema_fps,
                )

            if is_mock:
                elapsed = time.perf_counter() - loop_start
                remaining = mock_interval - elapsed
                if remaining > 0.0:
                    self._stop_event.wait(remaining)

    def read_latest(self, last_seq: int = 0) -> CapturedFrame | None:
        """Return newest frame if its sequence exceeds last_seq, else None."""
        with self._lock:
            if self._latest_frame is not None and self._latest_frame.seq > last_seq:
                return self._latest_frame
            return None

    def retry(self) -> CameraState:
        """Cleanly release existing capture resources and retry opening camera."""
        self.stop()
        return self.start()

    def stop(self) -> None:
        """Stop capture thread and release VideoCapture resources."""
        self._stop_event.set()
        thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.5)
        self._thread = None

        cap = self._cap
        self._cap = None
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass

    @staticmethod
    def _disable_v4l2_dynamic_framerate(dev_path: Path) -> None:
        """Set V4L2_CID_EXPOSURE_AUTO_PRIORITY=0 so low light doesn't throttle FPS to ~10."""
        if fcntl is None or sys.platform != "linux":
            return
        vidioc_s_ctrl = 0xC008561C
        v4l2_cid_exposure_auto_priority = 0x009A0903
        fd: int | None = None
        try:
            fd = os.open(str(dev_path), os.O_RDWR)
            ctrl = struct.pack("Ii", v4l2_cid_exposure_auto_priority, 0)
            fcntl.ioctl(fd, vidioc_s_ctrl, ctrl)
        except OSError:
            pass
        finally:
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
