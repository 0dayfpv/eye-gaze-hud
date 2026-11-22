# Project: Eye Gaze HUD Desktop Application

## Overview
Production-quality Linux desktop application for **Eye Gaze HUD** delivering **1:1 visual, layout, and functional parity** with the web application at `/home/hamzafpv/teamwork_projects/pose_skeleton_hud_v2_1` (READ-ONLY reference), powered by a native Python 3.11 (`uv`) MediaPipe `FaceLandmarker` + V4L2 MJPG webcam sidecar and packaged in an Electron desktop shell with one-click `.desktop` launchers (`Terminal=false`).

## Architecture
- **Desktop Shell (`electron/`)**: Electron (`45.x`) main process + secure `contextBridge` preload script. Spawns the Python 3.11 native sidecar on an ephemeral `127.0.0.1` port, forwards backend connection info to the renderer, provides native JSON snapshot saving, and guarantees zero-orphan child termination on window close (`SIGTERM` -> timeout `SIGKILL`).
- **Native Eye & Iris Inference Sidecar (`backend/`)**: Python 3.11 (`uv` venv) running:
  - Dedicated `V4L2` capture thread (`/dev/video0`, `MJPG`, `1280x720@30fps`, `CAP_PROP_BUFFERSIZE=1`, latest-frame overwrite) with structured error states (`no-camera`, `camera-busy`, `permission-denied`, `error`) and `retry_camera` support.
  - Native `mediapipe.tasks.python.vision.FaceLandmarker` (`running_mode=VIDEO`, `num_faces=1`, `output_face_blendshapes=True`, `output_facial_transformation_matrixes=True`) using locally bundled `assets/face_landmarker.task` (fully offline). Supports `--delegate auto|gpu|cpu`: `auto` probes `Delegate.GPU` (leveraging NVIDIA RTX 5050 EGL via `10_nvidia.json` when available, ~2–4 ms) with automatic fallback to `Delegate.CPU` XNNPACK (~6.3 ms), both well under the `<= 20 ms` target.
  - Localhost WebSocket server (`127.0.0.1:<port>/ws`) + `/health` HTTP endpoint streaming binary frames (`[4-byte uint32 BE json_len][UTF-8 JSON telemetry][JPEG frame bytes]`) with latest-frame backpressure dropping.
- **1:1 Cybernetic HUD Frontend (`src/`)**: React 19 + TypeScript 5.8 + Tailwind CSS v4 + Vite 8 + Lucide icons. Consumes the binary WebSocket stream via `NativeStreamClient`, renders the decoded frame onto the aspect-locked stage behind the exact 6-layer Canvas2D renderer (`EyeCanvas.tsx`), runs the exact dual One-Euro filters (`PoseSmoother` + `GazeTrackerState`), iris/blendshape/head-pose gaze fusion, 5-point ridge-regularized affine calibration, blink counter/freeze, `EyeControlPanel.tsx` (`Eye Gaze Lab`), and JSON snapshot export.
- **Opaque-Box E2E Test Suite (`e2e/`)**: Playwright test suite derived from `ORIGINAL_REQUEST.md` and `PROJECT.md` Interface Contracts across Tiers 1–4, plus Electron end-to-end smoke verification.

## Feature Inventory
Every required feature (F01–F24) is assigned to a milestone (F25 legacy pose/hand code in reference `geometry.ts` is unused by V2.1 and out of scope):

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Top Header Branding | `Eye Gaze HUD V2.1` title + Eye icon badge, `#05080f` cybernetic dark header | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F02 | Live Gaze Zone Badge | Header `hud-gaze-zone` (`NO LOCK` / `BLINK` / 9 gaze zones) | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F03 | Blink Counter | Header `hud-blink-count` (`{N} BLINKS`), rising-edge count preserved on Reset/Clear | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F04 | 5-PT CAL Badge | Header `hud-calibrated-badge` shown when 5-point affine calibration is active | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F05 | FPS, Latency & Delegate | Header `hud-fps`, `hud-inference-ms` (`ms`), `hud-delegate` (`GPU`/`CPU`) | M1, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F06 | Collapsible Panel Toggle | Header `panel-toggle` (`Hide Panel`/`Controls`) & sidebar collapse chevron | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F07 | Aspect-Locked Video/Canvas Stage | `computeContainBox`, HiDPI DPR Canvas2D, native frame backdrop | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F08 | Camera/Engine Status & Retry | `requesting-camera`, `loading-model`, `permission-denied`, `no-camera`, `camera-busy`, `error` + working `Retry` | M1, M3 | Survey 1 / ORIGINAL_REQUEST R2 |
| F09 | 5-Point Calibration Overlay | Targets (`Center`, `Top-Left`, `Top-Right`, `Bottom-Right`, `Bottom-Left`), 10 non-blinking frames/pt, click/`SPACE`/`ESC`, OLS affine fit, `Reset` | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F10 | Base Ocular Wireframe | Eyelids, eyebrows, blackout face oval, glowing iris rings + pupil crosshairs (`468..477`) | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F11 | Layer 1: Rays & Reticle | `showGazeRays` dual dashed iris rays, target reticle, upright zone/CAL pill | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F12 | Layer 2: 3x3 Zone Grid | `showZoneGrid` dashed 3x3 matrix + active sector highlight | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F13 | Layer 3: Thermal Heatmap | `showHeatmap` 12x9 thermal grid (cyan -> yellow -> red) | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F14 | Layer 4: Saccade Trail | `showTrail` 28-point fading & widening cyan trail | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F15 | Layer 5: Ocular Scope | `showEyeMagnifier` 192x74 bottom-left `OCULAR SCOPE • IRIS LOCK` dual-eye HUD | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F16 | Layer 6: Face Mesh | `showFaceMesh` full 2556-edge tesselation wireframe (default off) | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F17 | Live 2D Gaze Radar | Sidebar 3x3 matrix (`CTR`, etc.) + moving dot + `gaze-zone-badge` | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F18 | Calibration & Clear Actions | `5-Pt Calibrate` / `Recalibrate 5-Pt`, `Reset`, `Clear` (heatmap + trail) | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F19 | Ocular Biometrics Grid | 5 cards: Left/Right Iris `(hx, hy) • %`, Blinks/Fixation, Gaze Coord `%`, Head Pose Y/P/R | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F20 | Sensitivity & Head Assist | `Horizontal Gain (X)` `[0.8..4.0]`, `Vertical Gain (Y)` `[0.8..4.0]`, `Head-Pose Assist` `[0..1]` | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F21 | Display Mode & Mirror | `Overlay` vs `Blackout` (24px/96px tactical grid), `Mirror Mode` (`ON`/`OFF`) | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F22 | Gaze Smoothing (One-Euro) | Dual One-Euro filters (`PoseSmoother` + `GazeTrackerState`), toggle + strength `[0..1]` | M2, M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F23 | Export Gaze Snapshot (JSON) | Downloads/saves `eye-gaze-snapshot-<ms>.json` with full telemetry, settings, calibration, trail | M3, M4 | Survey 1 / ORIGINAL_REQUEST AC3 |
| F24 | Copyright Footer | `© 2025–2026 hamzafpv.com.tr • All rights reserved.` in panel & app footer | M3 | Survey 1 / ORIGINAL_REQUEST R1 |
| F25 | Native Offline Backend & Benchmark | Bundled `face_landmarker.task`, zero-lag MJPG capture, `<= 20 ms` 1280x720 inference benchmark | M1 | ORIGINAL_REQUEST R2 / AC4 |
| F26 | Desktop Launch & Clean Shutdown | Electron shell, custom icon, `launch.sh`, `.desktop` in `~/.local/share/applications/` & `~/Desktop/` (`Terminal=false`), 0 orphans, `README.md` | M4 | ORIGINAL_REQUEST R3 / AC6-8 |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Native Inference & Camera Backend | `backend/` Python 3.11 (`uv`), bundled `assets/face_landmarker.task`, V4L2 MJPG capture, `FaceLandmarker` (`GPU`/`CPU`), binary WS server, `scripts/benchmark_inference.py`, `pytest` suite | none | IN_PROGRESS |
| M2 | Gaze Engine, Math & Stream Core | `src/engine/` (`types.ts`, `faceConnections.ts`, `geometry.ts`, `gazeEngine.ts`, `streamClient.ts`) + `vitest` unit tests | none | IN_PROGRESS |
| M3 | 1:1 HUD Canvas, Sidebar & App UI | Vite/React/Tailwind config, `src/components/EyeCanvas.tsx`, `src/components/EyeControlPanel.tsx`, `src/App.tsx`, `src/index.css`, `index.html`, component tests | M2 | IN_PROGRESS |
| M4 | Electron Shell, Launchers & Docs | `electron/main.ts`, `electron/preload.ts`, `assets/icon.svg`, `assets/icon.png`, `launch.sh`, `scripts/install_desktop.sh`, `.desktop` entries, `scripts/smoke_test.mjs`, `README.md` | M1, M3 | PLANNED |
| E2E | Opaque-Box E2E Test Suite | `TEST_INFRA.md`, `playwright.config.ts`, `e2e/` mock WS fixture + Tiers 1–4 Playwright specs + `TEST_READY.md` | none (runs in parallel) | IN_PROGRESS |
| M5 | Final Verification & Hardening | Phase 1: 100% pass of E2E Tiers 1–4; Phase 2: Tier 5 white-box adversarial coverage hardening; full build/lint/typecheck/benchmark/smoke/launcher gate | M1, M2, M3, M4, E2E | PLANNED |

## Interface Contracts

### 1. Native Backend CLI & Startup (`backend/server.py` <-> `electron/main.ts`)
- Command:
  `python -m backend.server --port 0 --delegate auto --camera-index 0 --width 1280 --height 720 --fps 30`
  (Also supports `--mock-video <path>` or `--no-camera` only if explicitly requested in tests; default is real `/dev/video0`.)
- Environment: Launcher / Electron sets `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json` when `/usr/share/glvnd/egl_vendor.d/10_nvidia.json` exists, enabling RTX 5050 EGL acceleration when `delegate=auto|gpu`, with automatic fallback to `Delegate.CPU` if GPU initialization fails.
- Stdout readiness line (flushed immediately once WS + HTTP server binds):
  `{"type":"ready","host":"127.0.0.1","port":<int>,"wsUrl":"ws://127.0.0.1:<int>/ws","healthUrl":"http://127.0.0.1:<int>/health"}`
- HTTP `GET /health`: returns `200 OK` JSON `{"status":"ok","delegate":"GPU"|"CPU","cameraState":"...","pid":<int>}`.
- Watchdog: Backend monitors `stdin` EOF and parent PID (`os.getppid()`), plus handles `SIGTERM`/`SIGINT` to immediately stop the camera thread, call `cap.release()`, close `FaceLandmarker`, and exit `0`.

### 2. WebSocket Protocol (`ws://127.0.0.1:<port>/ws` <-> `src/engine/streamClient.ts`)
- **Server -> Client Binary Message (Frame Packet)**:
  - Bytes `[0..4)`: `uint32` big-endian `headerLen`
  - Bytes `[4 .. 4 + headerLen)`: UTF-8 JSON telemetry header:
    ```json
    {
      "type": "frame",
      "timestampMs": 12345.67,
      "frameSeq": 1,
      "width": 1280,
      "height": 720,
      "cameraFps": 30.0,
      "inferenceMs": 4.2,
      "delegate": "GPU",
      "faceDetected": true,
      "landmarks": [[0.5, 0.5, 0.0]],
      "blendshapes": {
        "eyeLookInLeft": 0.0, "eyeLookOutLeft": 0.0, "eyeLookUpLeft": 0.0, "eyeLookDownLeft": 0.0,
        "eyeLookInRight": 0.0, "eyeLookOutRight": 0.0, "eyeLookUpRight": 0.0, "eyeLookDownRight": 0.0,
        "eyeBlinkLeft": 0.0, "eyeBlinkRight": 0.0
      }
    }
    ```
    (`landmarks` has 478 `[x, y, z]` normalized floats when `faceDetected: true`, else `[]`; `blendshapes` is `null` when `faceDetected: false`.)
  - Bytes `[4 + headerLen .. end)`: JPEG-encoded BGR->RGB webcam frame (`quality=80`).
- **Server -> Client Text Message (Status / Error)**:
  ```json
  {
    "type": "status",
    "status": "loading-model" | "requesting-camera" | "ready" | "permission-denied" | "no-camera" | "camera-busy" | "error",
    "message": "Optional human-readable detail",
    "delegate": "GPU" | "CPU"
  }
  ```
- **Client -> Server Text Commands**:
  - `{"type":"retry_camera"}`
  - `{"type":"set_delegate","delegate":"auto"|"gpu"|"cpu"}`
  - `{"type":"shutdown"}`

### 3. Electron Preload Bridge (`electron/preload.ts` <-> `src/App.tsx`)
Exposed on `window.electronAPI` (when running inside Electron; optional fallback to `?wsUrl=` query param for browser-based Playwright E2E tests):
```ts
export interface ElectronAPI {
  getBackendConfig: () => Promise<{ wsUrl: string; healthUrl: string; port: number }>;
  saveSnapshot: (filename: string, jsonContent: string) => Promise<{ saved: boolean; filePath?: string; canceled?: boolean }>;
  platform: string;
}
```
Also support `window.__EYE_GAZE_WS_URL__` or URL query `?wsUrl=ws://127.0.0.1:<port>/ws` so Vite + Playwright E2E tests can connect cleanly to a mock WebSocket fixture server without needing Electron or a physical webcam.

### 4. Exact `data-testid` Contract (1:1 with `pose_skeleton_hud_v2_1`)
All UI and E2E tests rely on these exact `data-testid` attributes:
- Header: `hud-gaze-zone`, `hud-blink-count`, `hud-calibrated-badge`, `hud-fps`, `hud-inference-ms`, `hud-delegate`, `panel-toggle`
- Stage: `eye-stage`, `eye-video` (rendered `<canvas>`/`<img>` backdrop or hidden video element preserving `data-testid="eye-video"`), `eye-canvas`, `calibration-overlay`, `calibration-target-button`, `calibration-cancel-button`, `status-overlay`, `retry-button`
- Sidebar (`control-panel`): `gaze-lab-section`, `gaze-zone-badge`, `gaze-radar-dot`, `start-calibration-button`, `reset-calibration-button`, `clear-heatmap-button`, `gaze-sensitivity-x`, `gaze-sensitivity-y`, `gaze-head-comp`, `toggle-showGazeRays`, `toggle-showZoneGrid`, `toggle-showHeatmap`, `toggle-showTrail`, `toggle-showEyeMagnifier`, `toggle-showFaceMesh`, `mode-overlay`, `mode-blackout`, `mirror-toggle`, `smoothing-toggle`, `smoothing-slider`, `export-snapshot`
- Footer: `app-copyright-footer`

## Code Layout
```
/home/hamzafpv/teamwork_projects/eye_gaze_desktop_app/
├── assets/
│   ├── face_landmarker.task          # Local offline MediaPipe model (~3.76 MB)
│   ├── icon.svg                      # Cybernetic eye SVG icon
│   └── icon.png                      # Rasterized 256x256 PNG desktop icon
├── backend/
│   ├── pyproject.toml                # uv Python 3.11 dependencies & pytest/ruff/mypy config
│   ├── __init__.py
│   ├── camera.py                     # V4L2 MJPG zero-lag webcam capture + error taxonomy
│   ├── inference.py                  # MediaPipe FaceLandmarker wrapper (GPU/CPU + offline model)
│   ├── protocol.py                   # Binary WebSocket frame encoder & message schemas
│   ├── server.py                     # WebSocket + HTTP /health server + ppid/stdin watchdog
│   └── tests/
│       ├── test_camera.py
│       ├── test_inference.py
│       ├── test_protocol.py
│       └── test_server.py
├── electron/
│   ├── tsconfig.json
│   ├── main.ts                       # Electron BrowserWindow + Python sidecar lifecycle
│   └── preload.ts                    # contextBridge API
├── src/
│   ├── main.tsx
│   ├── index.css                     # Tailwind v4 dark cybernetic styling
│   ├── App.tsx                       # Main HUD shell, header, footer, calibration, export
│   ├── App.test.tsx
│   ├── engine/
│   │   ├── types.ts
│   │   ├── faceConnections.ts        # Static MediaPipe 478-pt edge lists (no WASM)
│   │   ├── geometry.ts               # PoseSmoother + computeFaceHeadMetrics
│   │   ├── geometry.test.ts
│   │   ├── gazeEngine.ts             # Iris geometry, blendshape fusion, 5-pt OLS, GazeTrackerState
│   │   ├── gazeEngine.test.ts
│   │   ├── streamClient.ts           # Binary WS client & packet decoder
│   │   └── streamClient.test.ts
│   └── components/
│       ├── EyeCanvas.tsx             # 6-layer Canvas2D renderer, calibration & status overlays
│       ├── EyeCanvas.test.tsx
│       ├── EyeControlPanel.tsx       # Eye Gaze Lab sidebar
│       └── EyeControlPanel.test.tsx
├── e2e/                              # Opaque-box Playwright E2E suite (owned by E2E Testing Track)
│   ├── fixtures/
│   │   └── mockWsServer.ts
│   └── *.spec.ts
├── scripts/
│   ├── benchmark_inference.py        # Automated 1280x720 inference latency benchmark (<= 20ms)
│   ├── install_desktop.sh            # Installs .desktop files + icon + validates + trusts
│   └── smoke_test.mjs                # Automated Electron E2E smoke test (0 errors, 0 orphans)
├── index.html
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── eslint.config.js
├── launch.sh                         # Single-click GUI launcher (no terminal)
├── README.md
├── PROJECT.md                        # Global project architecture & milestone tracker
├── TEST_INFRA.md                     # E2E testing architecture (owned by E2E Testing Track)
└── TEST_READY.md                     # E2E ready signal (owned by E2E Testing Track)
```

## Write Ownership Rules
- **M1 Worker**: owns `backend/**`, `assets/face_landmarker.task`, `scripts/benchmark_inference.py`.
- **M2 Worker**: owns `src/engine/**`.
- **M3 Worker**: owns `index.html`, `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `src/main.tsx`, `src/index.css`, `src/App.tsx`, `src/App.test.tsx`, `src/components/**`. (Note: coordinate `package.json` cleanly so M3 sets up Vite/React/Vitest scripts and M4 adds Electron/Playwright scripts or `electron/` dependencies without clobbering!)
- **M4 Worker**: owns `electron/**`, `assets/icon.svg`, `assets/icon.png`, `launch.sh`, `scripts/install_desktop.sh`, `scripts/smoke_test.mjs`, `README.md`, and Electron additions to `package.json` (only after M3 completes!).
- **E2E Testing Track**: owns `TEST_INFRA.md`, `TEST_READY.md`, `playwright.config.ts`, `e2e/**`.
