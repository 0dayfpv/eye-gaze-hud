# Eye Gaze HUD — Precision Pupil & Iris Tracker

[![Live Demo](https://img.shields.io/badge/Live%20Demo-eye.hamzafpv.com.tr-22d3ee?style=for-the-badge)](https://eye.hamzafpv.com.tr)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Face%20%26%20Iris%20478-0097a7?style=flat-square)](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite)](https://vite.dev)

Real-time, client-side **eye gaze, pupil, and iris tracking HUD** running directly in the browser with WebGL/WASM acceleration — zero backend required, 100% private camera processing.

> **Live App:** [https://eye.hamzafpv.com.tr](https://eye.hamzafpv.com.tr)

---

## Key Features

- **Dedicated High-FPS Eye & Iris Engine (`EyeEngine`):** Loads only MediaPipe `FaceLandmarker` (478 face + 10 iris landmarks `468..477` + neural `eyeLook*` / `eyeBlink*` blendshapes) with automatic `GPU → CPU` delegate fallback for maximum frame rate.
- **Hybrid Geometric + Neural Gaze Fusion:** Combines rotation-invariant iris-in-socket projection (`hx`, `hy`) with MediaPipe neural eye-look blendshapes and head-pose (`Yaw / Pitch / Roll`) compensation.
- **Interactive 5-Point Affine Calibration:** Click or press `SPACE` while looking at 5 on-screen targets (`Center`, `Top-Left`, `Top-Right`, `Bottom-Right`, `Bottom-Left`) to fit an ordinary least squares (OLS) affine calibration model tailored to your camera and seating position.
- **9-Zone Gaze Classification & Live Radar:** Classifies gaze into `UP-LEFT`, `UP`, `UP-RIGHT`, `LEFT`, `CENTER`, `RIGHT`, `DOWN-LEFT`, `DOWN`, and `DOWN-RIGHT` with a live 2D radar pad in the sidebar.
- **Blink Detection & Blink-Freeze:** Automatically counts blinks and freezes gaze coordinates during eyelid closure to prevent downward cursor jumps.
- **Rich Cybernetic HUD Visualizations:**
  - **3D Pupil Gaze Rays & Target Reticle**
  - **3×3 Gaze Zone Grid** with active sector highlighting
  - **12×9 Thermal Gaze Heatmap** & **28-Point Saccade Trail**
  - **Dual-Eye Ocular Scope HUD** showing magnified left/right iris lock and eye openness `%`
  - **Overlay & Blackout Tactical Grid Modes** + **Mirror Mode**
  - **One-Euro Adaptive Smoothing Filter**
- **JSON Telemetry Export:** Export live gaze coordinates, iris ratios, blink count, calibration matrix, and saccade trail as a structured `.json` snapshot.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| UI Framework | React 19 + TypeScript 5.8 |
| Build Tool | Vite 8 + Tailwind CSS 4 |
| Computer Vision | `@mediapipe/tasks-vision` (`FaceLandmarker` + Iris + Blendshapes, self-hosted WASM) |
| Testing | Vitest 5 + Testing Library + Playwright |
| Hosting | (`eye.hamzafpv.com.tr`) |

---

## Project Structure

```text
src/
├── engine/
│   ├── eyeEngine.ts          # Dedicated MediaPipe FaceLandmarker + Blendshapes engine (GPU/CPU fallback)
│   ├── gazeEngine.ts         # Iris geometry, blendshape fusion, 5-pt OLS affine calibration, One-Euro smoother, heatmap
│   └── geometry.ts           # 3D math, head-pose metrics (Yaw/Pitch/Roll), landmark smoother
├── components/
│   ├── EyeCanvas.tsx         # HiDPI canvas renderer (iris lock, gaze rays, reticle, 3x3 grid, heatmap, ocular scope, calibration UI)
│   └── EyeControlPanel.tsx   # Live 2D gaze radar, calibration controls, sensitivity sliders, layer toggles, ocular biometrics
└── App.tsx                   # Camera lifecycle, synchronized rAF pipeline, HUD header, keyboard shortcuts (SPACE/ESC)
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- A webcam-enabled browser (Chrome, Edge, Firefox, Safari)

### Local Development

```bash
# Install dependencies (automatically copies MediaPipe WASM files to public/wasm)
npm install

# Start development server
npm run dev
```

### Verification & Production Build

```bash
# Run unit tests
npm test

# Lint & TypeScript check
npm run lint
npm run typecheck

# Build for production
npm run build
```

---

## Privacy

All video frames are processed **locally on your device** inside the browser via WebGL/WASM. No webcam video, images, or biometric gaze data are ever transmitted to any server.

---

© 2025–2026 [hamzafpv.com.tr](https://hamzafpv.com.tr) • All rights reserved.
