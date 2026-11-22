"""Integration tests for backend.server HTTP /health, WebSocket /ws, and watchdogs."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import pytest
import websockets

from backend import REPO_ROOT
from backend.protocol import decode_frame_packet
from backend.server import EyeGazeServer, ServerConfig


def _http_get(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=3.0) as resp:
            return int(resp.status), resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        return int(err.code), err.read().decode("utf-8")


async def test_server_health_ws_status_and_delegate_switch() -> None:
    config = ServerConfig(
        host="127.0.0.1",
        port=0,
        delegate="cpu",
        no_camera=True,
        enable_stdin_watchdog=False,
        enable_ppid_watchdog=False,
        emit_stdout_ready=False,
    )
    server = EyeGazeServer(config)
    run_task = asyncio.create_task(server.run())
    try:
        await asyncio.wait_for(server.ready_event.wait(), timeout=5.0)
        assert server.bound_port > 0

        # Wait for startup pipeline to transition to no-camera.
        async with websockets.connect(server.ws_url) as ws:
            seen_statuses: list[str] = []
            for _ in range(5):
                raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                assert isinstance(raw, str)
                msg = json.loads(raw)
                assert msg["type"] == "status"
                seen_statuses.append(msg["status"])
                if msg["status"] == "no-camera":
                    break
            assert "no-camera" in seen_statuses

            code, body = await asyncio.to_thread(_http_get, server.health_url)
            assert code == 200
            health = json.loads(body)
            assert health["status"] == "ok"
            assert health["delegate"] == "CPU"
            assert health["cameraState"] == "no-camera"
            assert isinstance(health["pid"], int)

            not_found_url = f"http://127.0.0.1:{server.bound_port}/does-not-exist"
            code_404, _ = await asyncio.to_thread(_http_get, not_found_url)
            assert code_404 == 404

            await ws.send(json.dumps({"type": "set_delegate", "delegate": "auto"}))
            updated = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            assert updated["type"] == "status"
            assert updated["delegate"] in ("GPU", "CPU")

            await ws.send(json.dumps({"type": "retry_camera"}))
            retry_statuses: list[str] = []
            for _ in range(5):
                raw_retry = await asyncio.wait_for(ws.recv(), timeout=5.0)
                assert isinstance(raw_retry, str)
                retry_msg = json.loads(raw_retry)
                assert retry_msg["type"] == "status"
                retry_statuses.append(retry_msg["status"])
                if retry_msg["status"] == "no-camera":
                    break
            assert "no-camera" in retry_statuses

            await ws.send(json.dumps({"type": "shutdown"}))

        exit_code = await asyncio.wait_for(run_task, timeout=5.0)
        assert exit_code == 0
    finally:
        if not run_task.done():
            server.request_shutdown()
            await asyncio.wait_for(run_task, timeout=5.0)


async def test_server_streams_binary_frame_packets_with_mock_video(tmp_path: Path) -> None:
    video_path = tmp_path / "mock.avi"
    writer = cv2.VideoWriter(
        str(video_path),
        cv2.VideoWriter.fourcc("M", "J", "P", "G"),
        30.0,
        (640, 480),
    )
    assert writer.isOpened()
    for i in range(6):
        frame = np.full((480, 640, 3), 50 + i * 20, dtype=np.uint8)
        writer.write(frame)
    writer.release()

    config = ServerConfig(
        host="127.0.0.1",
        port=0,
        delegate="cpu",
        width=640,
        height=480,
        fps=30,
        mock_video=str(video_path),
        enable_stdin_watchdog=False,
        enable_ppid_watchdog=False,
        emit_stdout_ready=False,
    )
    server = EyeGazeServer(config)
    run_task = asyncio.create_task(server.run())
    try:
        await asyncio.wait_for(server.ready_event.wait(), timeout=5.0)
        async with websockets.connect(server.ws_url) as ws:
            binary_packets: list[bytes] = []
            for _ in range(15):
                item = await asyncio.wait_for(ws.recv(), timeout=5.0)
                if isinstance(item, bytes):
                    binary_packets.append(item)
                    if len(binary_packets) >= 2:
                        break

            assert len(binary_packets) >= 2
            header, jpeg_bytes = decode_frame_packet(binary_packets[-1])
            assert header["type"] == "frame"
            assert header["width"] == 640
            assert header["height"] == 480
            assert header["delegate"] == "CPU"
            assert header["faceDetected"] is False
            assert header["landmarks"] == []
            assert header["blendshapes"] is None
            assert jpeg_bytes.startswith(b"\xff\xd8\xff")

            await ws.send(json.dumps({"type": "shutdown"}))
        assert await asyncio.wait_for(run_task, timeout=5.0) == 0
    finally:
        if not run_task.done():
            server.request_shutdown()
            await asyncio.wait_for(run_task, timeout=5.0)


@pytest.mark.parametrize("shutdown_mode", ["stdin_eof", "sigterm"])
def test_server_subprocess_ready_and_clean_exit(shutdown_mode: str) -> None:
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "backend.server",
            "--port",
            "0",
            "--delegate",
            "cpu",
            "--no-camera",
        ],
        cwd=str(REPO_ROOT),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert proc.stdout is not None
        ready_line = proc.stdout.readline().strip()
        ready = json.loads(ready_line)
        assert ready["type"] == "ready"
        assert ready["port"] > 0
        assert ready["wsUrl"].startswith("ws://127.0.0.1:")
        assert ready["healthUrl"].startswith("http://127.0.0.1:")

        code, body = _http_get(ready["healthUrl"])
        assert code == 200
        health = json.loads(body)
        assert health["status"] == "ok"
        assert health["pid"] == proc.pid

        if shutdown_mode == "stdin_eof":
            assert proc.stdin is not None
            proc.stdin.close()
        else:
            proc.terminate()

        returncode = proc.wait(timeout=5.0)
        assert returncode == 0
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=2.0)
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()
