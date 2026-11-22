# Test Infrastructure — Eye Gaze HUD Desktop Application (`TEST_INFRA.md`)

## 1. Overview & Opaque-Box Testing Philosophy

This document defines the opaque-box Playwright End-to-End (E2E) test architecture for the **Eye Gaze HUD Desktop Application** (`eye-gaze-hud-desktop`).

All E2E tests are derived **strictly from `ORIGINAL_REQUEST.md` and `PROJECT.md` Interface Contracts** without coupling to internal React component state or Python sidecar implementation details:
- **Transport Isolation:** The Vite frontend connects via `?wsUrl=ws://127.0.0.1:<port>/ws` (or `window.electronAPI.getBackendConfig()`) to a deterministic local Node.js `ws` mock server (`e2e/fixtures/mockWsServer.ts`) implementing the exact `[4B uint32 BE json_len][UTF-8 JSON header][JPEG bytes]` binary frame contract and UTF-8 JSON status/command messages.
- **Deterministic Synthetic Vision Stream:** `e2e/fixtures/syntheticFace.ts` generates mathematically exact 478-point MediaPipe `FaceLandmarker` coordinates and 10 `EyeBlendshapes` scores corresponding to all 9 gaze zones, bilateral/unilateral blinks, 3D head pose angles (Yaw/Pitch/Roll), calibration target vectors, and malformed/boundary payloads.
- **Genuine Pixel & DOM Verification:** Canvas2D HUD layers (`Overlay`, `Blackout`, `Rays & Reticle`, `3x3 Zone Grid`, `Heatmap`, `Saccade Trail`, `Ocular Scope`, `Face Mesh`) are verified through actual rendered RGBA pixel sampling on `[data-testid="eye-canvas"]`, paired with web-first DOM assertions on the 36 `data-testid` contracts.

---

## 2. User-Facing Feature Inventory (`F01–F24`)

| ID | Category | Feature | Contract / Primary Selectors |
|----|----------|---------|------------------------------|
| `F01` | Header | Top Header Branding | `#05080f` root, `<header>`, Eye icon badge, `Eye Gaze HUD V2.1` (`V2.1` pink) |
| `F02` | Header | Live Gaze Zone Badge | `[data-testid="hud-gaze-zone"]` (`NO LOCK`, `BLINK`, 9 zones) |
| `F03` | Header | Blink Counter | `[data-testid="hud-blink-count"]` (`{N} BLINKS`, bilateral rising edge) |
| `F04` | Header | 5-PT CAL Badge | `[data-testid="hud-calibrated-badge"]` (`5-PT CAL` when calibrated) |
| `F05` | Header | FPS, Latency & Delegate | `hud-fps`, `hud-inference-ms`, `hud-delegate` (`GPU`/`CPU`) |
| `F06` | Header/Sidebar | Collapsible Panel Toggle | `[data-testid="panel-toggle"]`, sidebar collapse chevron, `[data-testid="control-panel"]` |
| `F07` | Stage | Aspect-Locked Video/Canvas Stage | `eye-stage`, `eye-video`, `eye-canvas`, HiDPI DPR scaling, `4:3` / `16:9` |
| `F08` | Stage | Camera/Engine Status & Retry | `status-overlay`, `retry-button` (`requesting-camera`, `loading-model`, `permission-denied`, `no-camera`, `camera-busy`, `error`) |
| `F09` | Stage | 5-Point Calibration Overlay | `calibration-overlay`, `calibration-target-button`, `calibration-cancel-button`, `Space`, `Escape` |
| `F10` | Canvas | Base Ocular Wireframe | Eyelids, eyebrows, blackout face oval, iris rings + pupil cores (`468..477`) |
| `F11` | Canvas | Layer 1: Rays & Reticle | `[data-testid="toggle-showGazeRays"]`, dashed rays, reticle, upright zone/CAL pill |
| `F12` | Canvas | Layer 2: 3x3 Zone Grid | `[data-testid="toggle-showZoneGrid"]`, dashed 3×3 sectors + active highlight |
| `F13` | Canvas | Layer 3: Thermal Heatmap | `[data-testid="toggle-showHeatmap"]`, 12×9 bins (cyan -> yellow -> red) |
| `F14` | Canvas | Layer 4: Saccade Trail | `[data-testid="toggle-showTrail"]`, 28-pt fading/widening cyan trail |
| `F15` | Canvas | Layer 5: Ocular Scope | `[data-testid="toggle-showEyeMagnifier"]`, `192×74` bottom-left `OCULAR SCOPE • IRIS LOCK` |
| `F16` | Canvas | Layer 6: Face Mesh | `[data-testid="toggle-showFaceMesh"]` (default OFF), 2556-edge tesselation wireframe |
| `F17` | Sidebar | Live 2D Gaze Radar | `gaze-lab-section`, `gaze-zone-badge`, 3×3 cells (`CTR`, etc.), `gaze-radar-dot` |
| `F18` | Sidebar | Calibration & Clear Actions | `start-calibration-button`, `reset-calibration-button`, `clear-heatmap-button` |
| `F19` | Sidebar | Ocular Biometrics Grid | `LEFT IRIS`, `RIGHT IRIS`, `BLINKS / FIXATION`, `GAZE COORD`, `HEAD POSE` |
| `F20` | Sidebar | Sensitivity & Head Assist | `gaze-sensitivity-x`, `gaze-sensitivity-y`, `gaze-head-comp`, `MANUAL`/`CALIBRATED` |
| `F21` | Sidebar | Display Mode & Mirror | `mode-overlay`, `mode-blackout`, `mirror-toggle` |
| `F22` | Sidebar | Gaze Smoothing (One-Euro) | `smoothing-toggle`, `smoothing-slider` |
| `F23` | Sidebar | Export Gaze Snapshot (JSON) | `[data-testid="export-snapshot"]` (`eye-gaze-snapshot-<ms>.json`) |
| `F24` | Footer | Copyright Footer | `[data-testid="app-copyright-footer"]` & sidebar copyright (`© 2025–2026 hamzafpv.com.tr • All rights reserved.`) |

*(Note: `F25` native inference benchmark is covered by `scripts/benchmark_inference.py`, and `F26` real Electron process/launcher lifecycle is covered by `scripts/smoke_test.mjs`; `T4-14` verifies the renderer-side `window.electronAPI` preload bridge end-to-end.)*

---

## 3. Test File Organization & Fixture Architecture

```
playwright.config.ts                  # Vite webServer (:4173) + Playwright Chromium config
e2e/
├── fixtures/
│   ├── frame_1280x720.jpg            # Valid minimal 1280x720 (16:9) JPEG frame
│   ├── frame_640x480.jpg             # Valid minimal 640x480 (4:3) JPEG frame
│   ├── mockWsServer.ts               # Ephemeral ws://127.0.0.1:<port>/ws + /health server
│   ├── syntheticFace.ts              # Exact 478-landmark & blendshape generators
│   └── hudHelpers.ts                 # Reusable opaque-box Playwright & Canvas pixel helpers
├── tier1-features.spec.ts            # Tier 1: Feature Coverage (120 cases: 5 × 24 features)
├── tier2-boundaries.spec.ts          # Tier 2: Boundary, Corner & Negative Cases (120 cases)
├── tier3-pairwise.spec.ts            # Tier 3: Cross-Feature Pairwise Interactions (36 cases)
└── tier4-workflows.spec.ts           # Tier 4: Real-World End-to-End Workflows (14 cases)
```

### Mock WebSocket Server (`e2e/fixtures/mockWsServer.ts`)
- Binds `WebSocketServer` on `127.0.0.1:0` (ephemeral port, zero parallel worker port collisions) with `/ws` WebSocket endpoint and HTTP `GET /health`.
- Encodes frames via `encodeFramePacket(header, jpegBytes)` matching `[4B uint32 BE][JSON][JPEG]`.
- Provides `sendStatus(status, message?, delegate?)`, `sendFrame(options)`, `startStream(generatorFn, fps)`, `setStreamGenerator(generatorFn)`, `stopStream()`, `waitForCommand(type, timeoutMs)`, and `close()`.
- Supports optional `autoRecoverOnRetry` for deterministic `Retry` button state transitions (`camera-busy` -> `requesting-camera` -> `loading-model` -> `ready`).

### Synthetic Face Generator (`e2e/fixtures/syntheticFace.ts`)
- Produces complete 478-point `[x, y, z]` arrays with anatomically coherent face oval (`36` edges), left/right eye contours (`16` edges each), eyebrows, and interior tesselation mesh points.
- Parameterizes iris offsets `(hx, hy)`, bilateral/unilateral eyelid `EAR` & `eyeBlinkLeft/Right`, and 3D head pose `(yawDeg, pitchDeg, rollDeg)` from the inverse equations of `computeEyeGaze` and `computeFaceHeadMetrics`.
- Exposes `makeCenterGaze`, `makeZoneGaze(zone)`, `makeBlinkFrame`, `makeHeadPoseFrame`, `makeNoFaceFrame`, `makeCalibrationTargetGaze(stepIndex)`, and malformed/partial landmark factories (`477` pts, `468` pts, `NaN` coords).

---

## 4. 4-Tier Coverage Matrix (290 Cases Total)

| Tier | File | Case Count | Coverage Goal |
|------|------|------------|---------------|
| **Tier 1** | `e2e/tier1-features.spec.ts` | **120** (`5 × F01..F24`) | Primary happy-path verification for all 24 features (`T1-F01-01` .. `T1-F24-05`). |
| **Tier 2** | `e2e/tier2-boundaries.spec.ts` | **120** (`5 × F01..F24`) | Boundary values, viewport extremes, malformed frames, threshold edges, error states (`T2-F01-01` .. `T2-F24-05`). |
| **Tier 3** | `e2e/tier3-pairwise.spec.ts` | **36** (`T3-01` .. `T3-36`) | Cross-feature pairwise interactions (Calibration × Mirror, Smoothing × Blink-Freeze, Blackout × Face Mesh, Panel Collapse × Stage Resize, etc.). |
| **Tier 4** | `e2e/tier4-workflows.spec.ts` | **14** (`T4-01` .. `T4-14`) | Full multi-step real-world journeys from cold boot through calibration, recovery, sweep/heatmap, blackout inspection, export audit, and Electron preload IPC. |
| **Total** | `e2e/*.spec.ts` | **290** | Full opaque-box specification coverage. |

---

## 5. Running the E2E Suite

```bash
# List all discovered E2E tests
npx playwright test --list

# Run full 290-case suite headless
npx playwright test

# Run individual tier
npx playwright test e2e/tier1-features.spec.ts
npx playwright test e2e/tier2-boundaries.spec.ts
npx playwright test e2e/tier3-pairwise.spec.ts
npx playwright test e2e/tier4-workflows.spec.ts

# Lint E2E test suite & config
npx eslint e2e playwright.config.ts
```
