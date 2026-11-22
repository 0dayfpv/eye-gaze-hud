# Eye Gaze HUD V2.1 — Desktop Application (Windows & Linux)

[![Releases](https://img.shields.io/github/v/release/0dayfpv/eye-gaze-hud-desktop?style=for-the-badge&color=22d3ee)](https://github.com/0dayfpv/eye-gaze-hud-desktop/releases)
[![Web Demo](https://img.shields.io/badge/Web%20Version-eye.hamzafpv.com.tr-f472b6?style=for-the-badge)](https://eye.hamzafpv.com.tr)

A production-quality cross-platform desktop application for **Eye Gaze HUD** with **1:1 visual and functional parity** to [eye.hamzafpv.com.tr](https://eye.hamzafpv.com.tr), powered by a **bundled native MediaPipe GPU/CPU inference backend** — zero terminal commands, zero Python installation, single-click launch!

## Download (Windows & Linux)

Go to the [**Releases**](https://github.com/0dayfpv/eye-gaze-hud-desktop/releases) page and download the package for your OS:

- **Windows (Installer):** `Eye-Gaze-HUD-2.1.0-Windows-x64-nsis.exe` — double-click to install with Desktop & Start Menu shortcuts.
- **Windows (Portable):** `Eye-Gaze-HUD-2.1.0-Windows-x64-portable.exe` — double-click to run directly without installation.
- **Linux (Universal AppImage):** `Eye-Gaze-HUD-2.1.0-Linux-x86_64.AppImage` — mark executable and double-click on any Linux distribution.
- **Linux (Ubuntu / Debian):** `Eye-Gaze-HUD-2.1.0-Linux-amd64.deb` — install via `sudo apt install ./Eye-Gaze-HUD-*.deb`.

## Features
- **1:1 Parity with Web Eye Gaze HUD:** Persistent top HUD (`GAZE ZONE`, `BLINKS`, `5-PT CAL`, `FPS`, `ms`, `GPU/CPU`), live 2D Gaze Radar, **5-Point Affine Calibration** (`click`, `SPACE`, `ESC`), all 6 HUD layers (`Rays & Reticle`, `3x3 Zone Grid`, `Heatmap`, `Saccade Trail`, `Ocular Scope`, `Face Mesh`), `Overlay / Blackout`, `Mirror Mode`, `One-Euro Smoothing`, head pose (`Yaw / Pitch / Roll`), and native JSON snapshot export.
- **Native Low-Latency Inference Backend:** Runs MediaPipe `FaceLandmarker` (478 face + 10 iris + neural eye blendshapes) natively on GPU/CPU (`~2.3 ms` average on RTX 5050 GPU), eliminating browser WASM overhead.
- **Fully Offline:** Bundles `face_landmarker.task` locally — no internet connection required after download.
- **Clean Lifecycle:** Closing the app window cleanly releases camera & GPU resources and terminates the backend sidecar with zero orphaned processes.

---

© 2025–2026 [hamzafpv.com.tr](https://hamzafpv.com.tr) • All rights reserved.
