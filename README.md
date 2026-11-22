# Eye Gaze HUD

[![Live Web App](https://img.shields.io/badge/Try%20in%20Browser-eye.hamzafpv.com.tr-22d3ee?style=for-the-badge)](https://eye.hamzafpv.com.tr)
[![Download](https://img.shields.io/github/v/release/0dayfpv/eye-gaze-hud?label=Download%20Desktop%20App&style=for-the-badge&color=f472b6)](https://github.com/0dayfpv/eye-gaze-hud/releases/latest)

Real-time **eye gaze, pupil, and iris tracking HUD** — runs directly in your browser or as a fast native desktop app for Windows & Linux. All camera processing stays 100% private on your device.

## How to install and run?

### 1. Download the Desktop App (easiest — no coding needed)

Go to the [**Releases**](https://github.com/0dayfpv/eye-gaze-hud/releases/latest) page and download the file for your computer:

- **Windows:** Download `Eye-Gaze-HUD-2.1.0-Windows-x64-Setup.exe` (or `Portable.exe`) and double-click it.
- **Linux:** Download `Eye-Gaze-HUD-2.1.0-Linux-x86_64.AppImage` (or `.deb`) and run it.

That's all it takes — no Python, no Node.js, and no terminal required. You can also try the web version right away at [**eye.hamzafpv.com.tr**](https://eye.hamzafpv.com.tr).

---

### 2. Run the Web App locally using git

Requires [Git](https://git-scm.com/downloads) and [Node.js 20+](https://nodejs.org/).

- `git clone https://github.com/0dayfpv/eye-gaze-hud.git`
- `cd eye-gaze-hud`
- `npm install`
- `npm run dev`

Then open `http://localhost:5173` in your browser.

---

### 3. Run the Desktop App from source

Requires [Git](https://git-scm.com/downloads), [Node.js 20+](https://nodejs.org/), and [Python 3.11](https://www.python.org/downloads/).

**Linux / macOS:**

- `git clone https://github.com/0dayfpv/eye-gaze-hud.git`
- `cd eye-gaze-hud/desktop`
- `python3.11 -m venv backend/.venv`
- `backend/.venv/bin/pip install mediapipe==1.2.3 opencv-contrib-python numpy websockets pillow`
- `npm install`
- `npm run build`
- `npm start`

**Windows (PowerShell):**

- `git clone https://github.com/0dayfpv/eye-gaze-hud.git`
- `cd eye-gaze-hud\desktop`
- `py -3.11 -m venv backend\.venv`
- `.\backend\.venv\Scripts\pip install mediapipe==1.2.3 opencv-contrib-python numpy websockets pillow`
- `npm install`
- `npm run build`
- `npm start`

---

## What's inside?

- **Precision Iris & Gaze Tracking:** MediaPipe Face & Iris Landmarker (`478` landmarks + neural eye blendshapes) with head-pose compensation.
- **5-Point Calibration:** Look at 5 targets and click or press `SPACE` (`ESC` to cancel).
- **Live HUD & Analytics:** 9-zone gaze direction, 2D radar, 3D gaze rays, heatmap, saccade trail, ocular scope magnifier, blink counter with blink-freeze, Overlay/Blackout modes, and JSON snapshot export.
- **High-FPS Native Backend (`desktop/`):** Runs MediaPipe natively on GPU/CPU (`~2.3 ms` on RTX 5050) for zero browser lag.

---

© 2025–2026 [hamzafpv.com.tr](https://hamzafpv.com.tr) • All rights reserved.
