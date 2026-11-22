# Eye Gaze HUD — Precision Pupil & Iris Tracker (Web & Desktop)

[![Live Web App](https://img.shields.io/badge/Live%20Web%20App-eye.hamzafpv.com.tr-22d3ee?style=for-the-badge)](https://eye.hamzafpv.com.tr)
[![Desktop Releases](https://img.shields.io/github/v/release/0dayfpv/eye-gaze-hud?label=Desktop%20Download&style=for-the-badge&color=f472b6)](https://github.com/0dayfpv/eye-gaze-hud/releases)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Face%20%26%20Iris%20478-0097a7?style=flat-square)](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)

Real-time **eye gaze, pupil, and iris tracking HUD** available both as an instant **Web App** ([eye.hamzafpv.com.tr](https://eye.hamzafpv.com.tr)) and as a **Native High-FPS Desktop Application** (Windows & Linux) with **1:1 identical UI** and ultra-low native GPU/CPU inference latency (`~2.3 ms` on RTX 5050).

---

## Desktop App Download (Windows & Linux)

Want zero browser latency, full camera FPS, and offline one-click launch? Download the desktop app from the [**Releases**](https://github.com/0dayfpv/eye-gaze-hud/releases) page:

| Platform | Package | How to Run |
| --- | --- | --- |
| **Windows (Installer)** | `Eye-Gaze-HUD-2.1.0-Windows-x64-Setup.exe` | Double-click to install with Desktop & Start Menu shortcuts |
| **Linux (Universal)** | `Eye-Gaze-HUD-2.1.0-Linux-x86_64.AppImage` | Mark executable (`chmod +x`) and double-click on any Linux distro |
| **Linux (Ubuntu / Debian)** | `Eye-Gaze-HUD-2.1.0-Linux-amd64.deb` | Install with `sudo apt install ./Eye-Gaze-HUD-2.1.0-Linux-amd64.deb` |

---

## Key Features (Web & Desktop 1:1 Parity)

- **Dedicated High-FPS Eye & Iris Engine:** Uses MediaPipe `FaceLandmarker` (478 face + 10 iris landmarks `468..477` + neural `eyeLook*` / `eyeBlink*` blendshapes) with automatic `GPU → CPU` delegate fallback.
- **Hybrid Geometric + Neural Gaze Fusion:** Combines rotation-invariant iris-in-socket projection (`hx`, `hy`) with MediaPipe neural eye-look blendshapes and head-pose (`Yaw / Pitch / Roll`) compensation.
- **Interactive 5-Point Affine Calibration:** Click or press `SPACE` while looking at 5 on-screen targets (`Center`, `Top-Left`, `Top-Right`, `Bottom-Right`, `Bottom-Left`) to fit an ordinary least squares (OLS) affine calibration model tailored to your camera and seating position (`ESC` cancels).
- **9-Zone Gaze Classification & Live Radar:** Classifies gaze into `UP-LEFT`, `UP`, `UP-RIGHT`, `LEFT`, `CENTER`, `RIGHT`, `DOWN-LEFT`, `DOWN`, and `DOWN-RIGHT` with a live 2D radar pad in the sidebar.
- **Blink Detection & Blink-Freeze:** Counts blinks automatically and freezes gaze coordinates during eyelid closure to prevent downward cursor jumps.
- **Rich Cybernetic HUD Visualizations:**
  - **3D Pupil Gaze Rays & Target Reticle**
  - **3×3 Gaze Zone Grid** with active sector highlighting
  - **12×9 Thermal Gaze Heatmap** & **28-Point Saccade Trail**
  - **Dual-Eye Ocular Scope HUD** showing magnified left/right iris lock and eye openness `%`
  - **Overlay & Blackout Tactical Grid Modes** + **Mirror Mode** + **Face Mesh**
  - **One-Euro Adaptive Smoothing Filter**
- **JSON Telemetry Export:** Export live gaze coordinates, iris ratios, blink count, calibration matrix, and saccade trail as a structured `.json` snapshot.

---

## Repository Structure

```text
.
├── src/                      # Web App (deployed to https://eye.hamzafpv.com.tr via Vercel)
│   ├── engine/               # Browser MediaPipe FaceLandmarker + Gaze math
│   ├── components/           # EyeCanvas & EyeControlPanel
│   └── App.tsx
└── desktop/                  # Native Desktop App (Electron + Python MediaPipe GPU/CPU sidecar)
    ├── backend/              # Native V4L2/DirectShow capture + MediaPipe C++ WebSocket server
    ├── electron/             # Electron shell & clean sidecar lifecycle
    ├── src/                  # 1:1 Web UI connected to native WebSocket stream
    └── scripts/              # Benchmark & GitHub Actions Windows/Linux release workflow
```

---

## Local Installation & Development

> **Just want to use the app without installing any developer tools?** Download the ready-to-run installer from the [**Releases**](https://github.com/0dayfpv/eye-gaze-hud/releases) page or open the live web version at [eye.hamzafpv.com.tr](https://eye.hamzafpv.com.tr).

### Dependencies

| Target | Required Software | Notes |
| --- | --- | --- |
| **Web App** | [Git](https://git-scm.com/downloads), [Node.js 20+](https://nodejs.org/) (includes `npm`) | No Python required — runs 100% in the browser |
| **Desktop App (from source)** | All of the above + [Python 3.11](https://www.python.org/downloads/) | Needed for the native MediaPipe GPU/CPU backend (`mediapipe`, `opencv-contrib-python`, `numpy`, `websockets`, `pillow`) |

---

### Option A — Run the Web App Locally

Clone the repository, install dependencies, and start the dev server:

```bash
git clone https://github.com/0dayfpv/eye-gaze-hud.git
cd eye-gaze-hud
npm install
npm run dev
```

- `npm install` automatically copies the self-hosted MediaPipe WASM files into `public/wasm/`.
- Open **`http://localhost:5173`** in your browser and allow webcam access.

---

### Option B — Run the Native Desktop App from Source (`desktop/`)

First clone the repository (if you haven't already):

```bash
git clone https://github.com/0dayfpv/eye-gaze-hud.git
cd eye-gaze-hud/desktop
```

#### Linux / macOS
```bash
# 1. Create a Python 3.11 virtual environment and install backend dependencies
python3.11 -m venv backend/.venv
backend/.venv/bin/pip install mediapipe==1.2.3 opencv-contrib-python numpy websockets pillow

# 2. Install Node/Electron dependencies, build the UI, and launch
npm install
npm run build
npm start
```

#### Windows (PowerShell)
```powershell
# 1. Create a Python 3.11 virtual environment and install backend dependencies
py -3.11 -m venv backend\.venv
.\backend\.venv\Scripts\pip install mediapipe==1.2.3 opencv-contrib-python numpy websockets pillow

# 2. Install Node/Electron dependencies, build the UI, and launch
npm install
npm run build
npm start
```

---

## Privacy

All video frames are processed **100% locally on your device** (WebGL/WASM in the Web App, native GPU/CPU in the Desktop App). No webcam video, images, or biometric gaze data are ever transmitted to any server.

---

© 2025–2026 [hamzafpv.com.tr](https://hamzafpv.com.tr) • All rights reserved.
