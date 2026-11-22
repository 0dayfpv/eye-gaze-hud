"""Offline 1280x720 MediaPipe FaceLandmarker latency benchmark."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend import DEFAULT_MODEL_PATH
from backend.inference import DelegateMode, NativeEyeEngine


def compute_sha256(path: Path) -> str:
    """Compute SHA256 hex digest of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_synthetic_frame(width: int, height: int) -> np.ndarray:
    """Create a deterministic synthetic 1280x720 BGR uint8 test frame (offline)."""
    y_grad = np.linspace(20, 220, height, dtype=np.uint8)[:, None]
    x_grad = np.linspace(15, 235, width, dtype=np.uint8)[None, :]
    b = np.broadcast_to(x_grad, (height, width))
    g = np.broadcast_to(y_grad, (height, width))
    r = ((b.astype(np.uint16) + g.astype(np.uint16)) // 2).astype(np.uint8)
    return np.ascontiguousarray(np.stack((b, g, r), axis=-1))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark offline FaceLandmarker latency on a 1280x720 synthetic frame."
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=DEFAULT_MODEL_PATH,
        help="Path to face_landmarker.task model file.",
    )
    parser.add_argument(
        "--delegate",
        choices=("auto", "gpu", "cpu"),
        default="auto",
        help="MediaPipe delegate preference (default: auto).",
    )
    parser.add_argument("--width", type=int, default=1280, help="Frame width (default: 1280).")
    parser.add_argument("--height", type=int, default=720, help="Frame height (default: 720).")
    parser.add_argument("--warmup", type=int, default=5, help="Warmup frames (default: 5).")
    parser.add_argument("--frames", type=int, default=50, help="Measured frames (default: 50).")
    parser.add_argument(
        "--threshold-ms",
        type=float,
        default=20.0,
        help="Maximum allowed average per-frame latency in ms (default: 20.0).",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    model_path: Path = args.model.resolve()
    if not model_path.is_file():
        print(f"ERROR: Offline model file not found: {model_path}", file=sys.stderr)
        return 1

    model_size = model_path.stat().st_size
    model_sha256 = compute_sha256(model_path)

    engine = NativeEyeEngine(model_path=model_path)
    delegate_mode: DelegateMode = args.delegate
    t_init_start = time.perf_counter()
    active_delegate = engine.init(delegate=delegate_mode)
    init_ms = (time.perf_counter() - t_init_start) * 1000.0

    frame_bgr = make_synthetic_frame(args.width, args.height)
    ts_ms = 1000

    try:
        for _ in range(max(0, args.warmup)):
            engine.detect(frame_bgr, timestamp_ms=ts_ms)
            ts_ms += 33

        latencies_ms: list[float] = []
        for _ in range(max(1, args.frames)):
            t0 = time.perf_counter()
            res = engine.detect(frame_bgr, timestamp_ms=ts_ms)
            wall_ms = (time.perf_counter() - t0) * 1000.0
            latencies_ms.append(res.inference_ms if res.inference_ms > 0.0 else wall_ms)
            ts_ms += 33
    finally:
        engine.close()

    sorted_lat = sorted(latencies_ms)
    avg_ms = statistics.fmean(sorted_lat)
    min_ms = sorted_lat[0]
    max_ms = sorted_lat[-1]
    p50_ms = statistics.median(sorted_lat)
    p95_idx = min(len(sorted_lat) - 1, round(0.95 * (len(sorted_lat) - 1)))
    p95_ms = sorted_lat[p95_idx]
    passed = avg_ms <= float(args.threshold_ms)

    summary = {
        "model": str(model_path),
        "modelBytes": model_size,
        "modelSha256": model_sha256,
        "resolution": f"{args.width}x{args.height}",
        "requestedDelegate": delegate_mode,
        "delegate": active_delegate,
        "initMs": round(init_ms, 3),
        "warmupFrames": max(0, args.warmup),
        "measuredFrames": len(sorted_lat),
        "avg_ms": round(avg_ms, 3),
        "min_ms": round(min_ms, 3),
        "p50_ms": round(p50_ms, 3),
        "p95_ms": round(p95_ms, 3),
        "max_ms": round(max_ms, 3),
        "threshold_ms": float(args.threshold_ms),
        "passed": passed,
    }

    if args.json:
        print(json.dumps(summary))
    else:
        print(
            f"model={model_path} bytes={model_size} sha256={model_sha256}\n"
            f"resolution={args.width}x{args.height} delegate={active_delegate} "
            f"init_ms={init_ms:.2f}\n"
            f"frames={len(sorted_lat)} avg_ms={avg_ms:.3f} min_ms={min_ms:.3f} "
            f"p50_ms={p50_ms:.3f} p95_ms={p95_ms:.3f} max_ms={max_ms:.3f} "
            f"threshold_ms={args.threshold_ms:.1f} passed={passed}"
        )

    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
