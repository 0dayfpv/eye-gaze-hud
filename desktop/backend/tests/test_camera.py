"""Unit tests for backend.camera V4L2 capture and error taxonomy."""

from __future__ import annotations

import errno
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from backend.camera import (
    CameraCapture,
    CameraState,
    classify_v4l2_failure,
    find_video_device_holders,
)


class FakeCapture:
    """Thread-safe mock cv2.VideoCapture for testing V4L2 config and capture loop."""

    def __init__(
        self,
        *,
        opened: bool = True,
        frames: list[np.ndarray[Any, Any]] | None = None,
        fail_after: int | None = None,
    ) -> None:
        self._opened = opened
        self._frames = frames if frames is not None else []
        self._fail_after = fail_after
        self._idx = 0
        self.props: dict[int, float] = {}
        self.released = False

    def isOpened(self) -> bool:  # noqa: N802
        return self._opened

    def set(self, prop_id: int, value: float) -> bool:
        self.props[prop_id] = value
        return True

    def read(self) -> tuple[bool, np.ndarray[Any, Any] | None]:
        if self.released:
            return False, None
        if self._fail_after is not None and self._idx >= self._fail_after:
            return False, None
        if not self._frames:
            return False, None
        frame = self._frames[min(self._idx, len(self._frames) - 1)]
        self._idx += 1
        time.sleep(0.002)
        return True, frame

    def release(self) -> None:
        self.released = True


def test_find_video_device_holders_scans_proc_fd(tmp_path: Path) -> None:
    dev_file = tmp_path / "video0"
    dev_file.write_text("", encoding="utf-8")

    proc_root = tmp_path / "proc"
    proc_45507 = proc_root / "45507"
    (proc_45507 / "fd").mkdir(parents=True)
    (proc_45507 / "comm").write_text("firefox\n", encoding="utf-8")
    (proc_45507 / "fd" / "42").symlink_to(dev_file)

    # Unrelated process should not be reported.
    proc_999 = proc_root / "999"
    (proc_999 / "fd").mkdir(parents=True)
    (proc_999 / "comm").write_text("bash\n", encoding="utf-8")
    (proc_999 / "fd" / "0").symlink_to(tmp_path / "other")

    holders = find_video_device_holders(dev_file, proc_root=proc_root)
    assert holders == [(45507, "firefox")]


def test_classify_v4l2_failure_all_states(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    dev_root = tmp_path / "dev"
    proc_root = tmp_path / "proc"
    dev_root.mkdir()
    proc_root.mkdir()

    # 1. Missing device -> no-camera
    state = classify_v4l2_failure(0, dev_root=dev_root, proc_root=proc_root)
    assert state.status == "no-camera"

    # 2. OSError ENOENT / EACCES / EBUSY
    assert (
        classify_v4l2_failure(
            0, OSError(errno.ENOENT, "missing"), dev_root=dev_root, proc_root=proc_root
        ).status
        == "no-camera"
    )
    assert (
        classify_v4l2_failure(
            0, OSError(errno.EACCES, "denied"), dev_root=dev_root, proc_root=proc_root
        ).status
        == "permission-denied"
    )
    assert (
        classify_v4l2_failure(
            0, OSError(errno.EBUSY, "busy"), dev_root=dev_root, proc_root=proc_root
        ).status
        == "camera-busy"
    )

    # 3. Device exists, permission denied via os.access
    dev0 = dev_root / "video0"
    dev0.write_text("", encoding="utf-8")
    monkeypatch.setattr("backend.camera.os.access", lambda _p, _m: False)
    state_perm = classify_v4l2_failure(0, dev_root=dev_root, proc_root=proc_root)
    assert state_perm.status == "permission-denied"

    # 4. Device exists and accessible, held by another process in /proc -> camera-busy
    monkeypatch.setattr("backend.camera.os.access", lambda _p, _m: True)
    holder_dir = proc_root / "12345"
    (holder_dir / "fd").mkdir(parents=True)
    (holder_dir / "comm").write_text("obs\n", encoding="utf-8")
    (holder_dir / "fd" / "7").symlink_to(dev0)

    state_busy = classify_v4l2_failure(0, dev_root=dev_root, proc_root=proc_root)
    assert state_busy.status == "camera-busy"
    assert "obs" in state_busy.message
    assert "12345" in state_busy.message

    # 5. Accessible and no holder -> generic error
    (holder_dir / "fd" / "7").unlink()
    state_err = classify_v4l2_failure(0, dev_root=dev_root, proc_root=proc_root)
    assert state_err.status == "error"


def test_camera_capture_no_camera_emits_lifecycle() -> None:
    events: list[CameraState] = []
    cam = CameraCapture(no_camera=True, on_state_change=events.append)
    final_state = cam.start()
    assert final_state.status == "no-camera"
    assert [e.status for e in events] == ["requesting-camera", "no-camera"]
    cam.stop()


def test_camera_capture_configures_v4l2_latest_frame_and_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dev_root = tmp_path / "dev"
    proc_root = tmp_path / "proc"
    dev_root.mkdir()
    proc_root.mkdir()
    (dev_root / "video0").write_text("", encoding="utf-8")
    monkeypatch.setattr("backend.camera.os.access", lambda _p, _m: True)

    frames = [
        np.full((720, 1280, 3), i, dtype=np.uint8) for i in range(1, 15)
    ]
    created_caps: list[FakeCapture] = []

    def factory(_index: int, _backend: int) -> FakeCapture:
        cap = FakeCapture(opened=True, frames=frames)
        created_caps.append(cap)
        return cap

    cam = CameraCapture(
        camera_index=0,
        width=1280,
        height=720,
        fps=30,
        capture_factory=factory,
        dev_root=dev_root,
        proc_root=proc_root,
    )
    try:
        state = cam.start()
        assert state.status == "ready"
        assert len(created_caps) == 1
        cap0 = created_caps[0]
        assert cap0.props[cv2.CAP_PROP_FOURCC] == float(cv2.VideoWriter.fourcc("M", "J", "P", "G"))
        assert cap0.props[cv2.CAP_PROP_FRAME_WIDTH] == 1280.0
        assert cap0.props[cv2.CAP_PROP_FRAME_HEIGHT] == 720.0
        assert cap0.props[cv2.CAP_PROP_FPS] == 30.0
        assert cap0.props[cv2.CAP_PROP_BUFFERSIZE] == 1.0

        # Wait until multiple frames have been overwritten into the single-slot buffer.
        deadline = time.monotonic() + 2.0
        latest = None
        while time.monotonic() < deadline:
            latest = cam.read_latest()
            if latest is not None and latest.seq >= 5:
                break
            time.sleep(0.01)

        assert latest is not None
        assert latest.seq >= 5
        assert latest.width == 1280
        assert latest.height == 720
        assert cam.read_latest(latest.seq) is None

        retry_state = cam.retry()
        assert retry_state.status == "ready"
        assert cap0.released is True
        assert len(created_caps) == 2
    finally:
        cam.stop()
        assert all(c.released for c in created_caps)


def test_camera_capture_consecutive_failures_transition(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dev_root = tmp_path / "dev"
    proc_root = tmp_path / "proc"
    dev_root.mkdir()
    proc_root.mkdir()
    (dev_root / "video0").write_text("", encoding="utf-8")
    monkeypatch.setattr("backend.camera.os.access", lambda _p, _m: True)

    cap = FakeCapture(opened=True, frames=[], fail_after=0)
    events: list[CameraState] = []
    cam = CameraCapture(
        capture_factory=lambda _i, _b: cap,
        on_state_change=events.append,
        dev_root=dev_root,
        proc_root=proc_root,
        max_consecutive_failures=2,
    )
    try:
        assert cam.start().status == "ready"
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline and cam.state.status == "ready":
            time.sleep(0.02)
        assert cam.state.status == "error"
    finally:
        cam.stop()
        assert cap.released is True


def test_camera_capture_mock_video_loops(tmp_path: Path) -> None:
    video_path = tmp_path / "sample.avi"
    writer = cv2.VideoWriter(
        str(video_path),
        cv2.VideoWriter.fourcc("M", "J", "P", "G"),
        30.0,
        (320, 240),
    )
    assert writer.isOpened()
    for val in (40, 120, 200):
        writer.write(np.full((240, 320, 3), val, dtype=np.uint8))
    writer.release()

    cam = CameraCapture(width=320, height=240, fps=60, mock_video=str(video_path))
    try:
        state = cam.start()
        assert state.status == "ready"
        deadline = time.monotonic() + 2.0
        latest = None
        while time.monotonic() < deadline:
            latest = cam.read_latest()
            if latest is not None and latest.seq >= 5:
                break
            time.sleep(0.01)
        assert latest is not None
        assert latest.seq >= 5
        assert latest.width == 320
        assert latest.height == 240
    finally:
        cam.stop()
