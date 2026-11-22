"""Async WebSocket + HTTP /health server for native eye gaze inference."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import select
import signal
import stat
import sys
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import websockets
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

from backend import DEFAULT_MODEL_PATH
from backend.camera import CameraCapture, CameraState
from backend.inference import ActiveDelegate, DelegateMode, NativeEyeEngine
from backend.protocol import (
    build_frame_header,
    encode_frame_packet,
    encode_jpeg,
    encode_status_message,
    parse_client_command,
)


@dataclass(slots=True)
class ServerConfig:
    """Runtime configuration for EyeGazeServer."""

    host: str = "127.0.0.1"
    port: int = 0
    delegate: DelegateMode = "auto"
    camera_index: int = 0
    width: int = 1280
    height: int = 720
    fps: int = 60
    jpeg_quality: int = 80
    model_path: Path = DEFAULT_MODEL_PATH
    mock_video: str | None = None
    no_camera: bool = False
    enable_stdin_watchdog: bool = True
    enable_ppid_watchdog: bool = True
    emit_stdout_ready: bool = True


class ClientSession:
    """Per-client output buffers with lossless status queue and latest-frame drop."""

    def __init__(self, ws: ServerConnection) -> None:
        self.ws = ws
        self.wake = asyncio.Event()
        self.control_msgs: deque[str] = deque()
        self.latest_frame: bytes | None = None

    def push_status(self, message: str) -> None:
        self.control_msgs.append(message)
        self.wake.set()

    def push_frame(self, packet: bytes) -> None:
        # Overwrite any unsent frame so slow consumers never build queue lag.
        self.latest_frame = packet
        self.wake.set()


class EyeGazeServer:
    """Coordinates webcam capture, MediaPipe FaceLandmarker, WS broadcast, and watchdogs."""

    def __init__(self, config: ServerConfig) -> None:
        self.config = config
        self.engine = NativeEyeEngine(model_path=config.model_path)
        self.shutdown_event = asyncio.Event()
        self.ready_event = asyncio.Event()

        self._loop: asyncio.AbstractEventLoop | None = None
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="eye-gaze")
        self._clients: set[ClientSession] = set()
        self._ws_server: Server | None = None
        self._stdin_wake_w: int | None = None
        self._stdin_thread: threading.Thread | None = None

        self._status: str = "loading-model"
        self._status_message: str = "Loading FaceLandmarker model..."
        self._active_delegate: ActiveDelegate = (
            "CPU" if config.delegate == "cpu" else "GPU"
        )
        self._bound_host: str = config.host
        self._bound_port: int = config.port
        self._init_lock = asyncio.Lock()

        self.camera = CameraCapture(
            camera_index=config.camera_index,
            width=config.width,
            height=config.height,
            fps=config.fps,
            mock_video=config.mock_video,
            no_camera=config.no_camera,
            on_state_change=self._handle_camera_state_from_thread,
        )

    @property
    def bound_port(self) -> int:
        return self._bound_port

    @property
    def ws_url(self) -> str:
        return f"ws://{self._bound_host}:{self._bound_port}/ws"

    @property
    def health_url(self) -> str:
        return f"http://{self._bound_host}:{self._bound_port}/health"

    def request_shutdown(self) -> None:
        """Signal the server event loop to shut down cleanly."""
        self.shutdown_event.set()
        for client in list(self._clients):
            client.wake.set()

    def _set_status(self, status: str, message: str = "") -> None:
        self._status = status
        self._status_message = message
        payload = encode_status_message(status, self._active_delegate, message)
        for client in list(self._clients):
            client.push_status(payload)

    def _handle_camera_state_from_thread(self, state: CameraState) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self._apply_camera_state, state)

    def _apply_camera_state(self, state: CameraState) -> None:
        self._set_status(state.status, state.message)

    def _process_request(
        self,
        _connection: ServerConnection,
        request: Request,
    ) -> Response | None:
        path = request.path.split("?", 1)[0]
        if path == "/health":
            body = json.dumps(
                {
                    "status": "ok",
                    "delegate": self._active_delegate,
                    "cameraState": self._status,
                    "pid": os.getpid(),
                },
                separators=(",", ":"),
            ).encode("utf-8")
            headers = Headers(
                [
                    ("Content-Type", "application/json"),
                    ("Content-Length", str(len(body))),
                    ("Cache-Control", "no-store"),
                ]
            )
            return Response(200, "OK", headers, body)

        if path in ("/ws", "/"):
            return None

        not_found = b"Not Found"
        return Response(
            404,
            "Not Found",
            Headers(
                [
                    ("Content-Type", "text/plain; charset=utf-8"),
                    ("Content-Length", str(len(not_found))),
                ]
            ),
            not_found,
        )

    async def _client_writer(self, session: ClientSession) -> None:
        try:
            while not self.shutdown_event.is_set():
                await session.wake.wait()
                session.wake.clear()
                while session.control_msgs:
                    msg = session.control_msgs.popleft()
                    await session.ws.send(msg)
                if session.latest_frame is not None:
                    pkt = session.latest_frame
                    session.latest_frame = None
                    await session.ws.send(pkt)
        except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
            return

    async def _handle_client_command(self, cmd: dict[str, Any]) -> None:
        loop = asyncio.get_running_loop()
        cmd_type = cmd["type"]

        if cmd_type == "shutdown":
            self.request_shutdown()
            return

        if cmd_type == "retry_camera":
            async with self._init_lock:
                state = await loop.run_in_executor(self._executor, self.camera.retry)
                self._set_status(state.status, state.message)
            return

        if cmd_type == "set_delegate":
            requested: DelegateMode = cmd["delegate"]
            async with self._init_lock:
                try:
                    active = await loop.run_in_executor(
                        self._executor,
                        self.engine.init,
                        requested,
                    )
                    self._active_delegate = active
                    self._set_status(self._status, self._status_message)
                except Exception as exc:
                    self._set_status("error", f"Failed to switch delegate: {exc}")

    async def _ws_handler(self, ws: ServerConnection) -> None:
        session = ClientSession(ws)
        self._clients.add(session)
        session.push_status(
            encode_status_message(self._status, self._active_delegate, self._status_message)
        )
        writer_task = asyncio.create_task(self._client_writer(session))
        try:
            async for raw in ws:
                cmd = parse_client_command(raw)
                if cmd is not None:
                    await self._handle_client_command(cmd)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._clients.discard(session)
            writer_task.cancel()
            await asyncio.gather(writer_task, return_exceptions=True)

    def _process_frame_sync(
        self,
        frame_bgr: Any,
        timestamp_ms: float,
        frame_seq: int,
        width: int,
        height: int,
        camera_fps: float,
    ) -> bytes:
        inf = self.engine.detect(frame_bgr, timestamp_ms=timestamp_ms)
        jpeg_bytes = encode_jpeg(frame_bgr, quality=self.config.jpeg_quality)
        header = build_frame_header(
            timestamp_ms=timestamp_ms,
            frame_seq=frame_seq,
            width=width,
            height=height,
            camera_fps=camera_fps,
            inference_ms=inf.inference_ms,
            delegate=inf.delegate,
            face_detected=inf.face_detected,
            landmarks=inf.landmarks,
            blendshapes=inf.blendshapes,
        )
        return encode_frame_packet(header, jpeg_bytes)

    async def _startup_pipeline(self) -> None:
        loop = asyncio.get_running_loop()
        async with self._init_lock:
            self._set_status("loading-model", "Loading FaceLandmarker model...")
            try:
                active = await loop.run_in_executor(
                    self._executor,
                    self.engine.init,
                    self.config.delegate,
                )
            except Exception as exc:
                self._set_status("error", f"Failed to load FaceLandmarker model: {exc}")
                return

            self._active_delegate = active
            self._set_status("requesting-camera", "Requesting camera access...")
            cam_state = await loop.run_in_executor(self._executor, self.camera.start)
            self._set_status(cam_state.status, cam_state.message)

    async def _frame_loop(self) -> None:
        loop = asyncio.get_running_loop()
        last_seq = 0
        while not self.shutdown_event.is_set():
            if self._status != "ready":
                await asyncio.sleep(0.02)
                continue

            captured = self.camera.read_latest(last_seq)
            if captured is None:
                await asyncio.sleep(0.002)
                continue

            last_seq = captured.seq
            if not self._clients:
                await asyncio.sleep(0.002)
                continue

            try:
                packet = await loop.run_in_executor(
                    self._executor,
                    self._process_frame_sync,
                    captured.frame_bgr,
                    captured.timestamp_ms,
                    captured.seq,
                    captured.width,
                    captured.height,
                    captured.fps,
                )
            except Exception as exc:
                self._set_status("error", f"Inference pipeline error: {exc}")
                await asyncio.sleep(0.05)
                continue

            for client in list(self._clients):
                client.push_frame(packet)

    async def _ppid_watchdog(self, initial_ppid: int) -> None:
        while not self.shutdown_event.is_set():
            await asyncio.sleep(0.5)
            if os.getppid() != initial_ppid:
                self.request_shutdown()
                return

    def _start_stdin_watchdog(self, loop: asyncio.AbstractEventLoop) -> None:
        try:
            stdin_fd = sys.stdin.fileno()
            mode = os.fstat(stdin_fd).st_mode
        except (OSError, ValueError):
            return
        if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
            return

        wake_r, wake_w = os.pipe()
        self._stdin_wake_w = wake_w

        def _watch_stdin() -> None:
            try:
                while not self.shutdown_event.is_set():
                    readable, _, _ = select.select([stdin_fd, wake_r], [], [])
                    if wake_r in readable:
                        break
                    if stdin_fd in readable:
                        chunk = os.read(stdin_fd, 1)
                        if chunk == b"":
                            if not loop.is_closed():
                                loop.call_soon_threadsafe(self.request_shutdown)
                            break
            except OSError:
                pass
            finally:
                try:
                    os.close(wake_r)
                except OSError:
                    pass

        thread = threading.Thread(
            target=_watch_stdin,
            name="stdin-eof-watchdog",
            daemon=True,
        )
        self._stdin_thread = thread
        thread.start()

    def _stop_stdin_watchdog(self) -> None:
        wake_w = self._stdin_wake_w
        self._stdin_wake_w = None
        if wake_w is not None:
            try:
                os.write(wake_w, b"x")
            except OSError:
                pass
            try:
                os.close(wake_w)
            except OSError:
                pass
        thread = self._stdin_thread
        self._stdin_thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)

    async def run(self) -> int:
        """Start WS/HTTP server, run inference loop, and clean up on shutdown."""
        loop = asyncio.get_running_loop()
        self._loop = loop
        initial_ppid = os.getppid()

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self.request_shutdown)
            except (NotImplementedError, RuntimeError):
                pass

        if self.config.enable_stdin_watchdog:
            self._start_stdin_watchdog(loop)

        ws_server = await serve(
            self._ws_handler,
            self.config.host,
            self.config.port,
            process_request=self._process_request,
            compression=None,
            max_size=1024 * 1024,
        )
        self._ws_server = ws_server

        sockets = ws_server.sockets
        if sockets:
            sockname = sockets[0].getsockname()
            self._bound_host = str(sockname[0])
            self._bound_port = int(sockname[1])

        self.ready_event.set()
        if self.config.emit_stdout_ready:
            ready_payload = {
                "type": "ready",
                "host": self._bound_host,
                "port": self._bound_port,
                "wsUrl": self.ws_url,
                "healthUrl": self.health_url,
            }
            print(json.dumps(ready_payload, separators=(",", ":")), flush=True)

        startup_task = asyncio.create_task(self._startup_pipeline())
        frame_task = asyncio.create_task(self._frame_loop())
        ppid_task = (
            asyncio.create_task(self._ppid_watchdog(initial_ppid))
            if self.config.enable_ppid_watchdog
            else None
        )

        try:
            await self.shutdown_event.wait()
        finally:
            self.request_shutdown()
            tasks: list[asyncio.Task[Any]] = [startup_task, frame_task]
            if ppid_task is not None:
                tasks.append(ppid_task)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

            self._stop_stdin_watchdog()
            self._executor.shutdown(wait=True)
            self.camera.stop()
            self.engine.close()

            ws_server.close()
            await ws_server.wait_closed()
            self._ws_server = None

        return 0


def parse_args(argv: list[str] | None = None) -> ServerConfig:
    parser = argparse.ArgumentParser(description="Eye Gaze HUD native inference WebSocket server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=0, help="Bind port (default: 0 ephemeral)")
    parser.add_argument(
        "--delegate",
        choices=("auto", "gpu", "cpu"),
        default="auto",
        help="MediaPipe inference delegate (default: auto)",
    )
    parser.add_argument("--camera-index", type=int, default=0, help="V4L2 camera index")
    parser.add_argument("--width", type=int, default=1280, help="Capture width")
    parser.add_argument("--height", type=int, default=720, help="Capture height")
    parser.add_argument("--fps", type=int, default=60, help="Target capture FPS")
    parser.add_argument("--jpeg-quality", type=int, default=80, help="JPEG quality 1..100")
    parser.add_argument(
        "--model-path",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help="Path to face_landmarker.task model file",
    )
    parser.add_argument(
        "--mock-video",
        default=None,
        help="Optional video file path for deterministic testing",
    )
    parser.add_argument(
        "--no-camera",
        action="store_true",
        help="Disable physical camera (for camera-less testing)",
    )
    args = parser.parse_args(argv)
    return ServerConfig(
        host=args.host,
        port=args.port,
        delegate=args.delegate,
        camera_index=args.camera_index,
        width=args.width,
        height=args.height,
        fps=args.fps,
        jpeg_quality=args.jpeg_quality,
        model_path=args.model_path,
        mock_video=args.mock_video,
        no_camera=args.no_camera,
    )


def main(argv: list[str] | None = None) -> int:
    config = parse_args(argv)
    server = EyeGazeServer(config)
    return asyncio.run(server.run())


if __name__ == "__main__":
    raise SystemExit(main())
