/// <reference types="vite/client" />

import type { ElectronAPI } from "./engine/types";

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __EYE_GAZE_WS_URL__?: string;
  }
}
