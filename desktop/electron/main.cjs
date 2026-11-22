"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const APP_ROOT = path.resolve(__dirname, "..");
const DIST_INDEX = path.join(APP_ROOT, "dist", "index.html");
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "assets", "icon.png")
  : path.join(APP_ROOT, "assets", "icon.png");
const FALLBACK_ICON_SVG = path.join(APP_ROOT, "assets", "icon.svg");

function resolveBackendCommand() {
  if (app.isPackaged) {
    const exeName =
      process.platform === "win32"
        ? "eye-gaze-backend.exe"
        : "eye-gaze-backend";
    const bundledBin = path.join(process.resourcesPath, "backend", exeName);
    return {
      command: bundledBin,
      args: ["--host", "127.0.0.1", "--port", "0"],
      cwd: path.join(process.resourcesPath, "backend"),
    };
  }
  const pyBin =
    process.platform === "win32"
      ? path.join(APP_ROOT, "backend", ".venv", "Scripts", "python.exe")
      : path.join(APP_ROOT, "backend", ".venv", "bin", "python");
  return {
    command: pyBin,
    args: ["-m", "backend.server", "--host", "127.0.0.1", "--port", "0"],
    cwd: APP_ROOT,
  };
}

let mainWindow = null;
let backendProc = null;
let backendConfig = null;
let isShuttingDown = false;

function startBackendSidecar() {
  return new Promise((resolve, reject) => {
    const resolved = resolveBackendCommand();
    const args = [...resolved.args];
    if (process.env.EYE_GAZE_NO_CAMERA === "1") {
      args.push("--no-camera");
    }
    if (process.env.EYE_GAZE_DELEGATE) {
      args.push("--delegate", process.env.EYE_GAZE_DELEGATE);
    }

    const child = spawn(resolved.command, args, {
      cwd: resolved.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    backendProc = child;

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timed out waiting for native Eye Gaze backend ready signal."));
      }
    }, 15000);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (settled) return;
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg && msg.type === "ready" && msg.wsUrl) {
          settled = true;
          clearTimeout(timeoutId);
          backendConfig = {
            wsUrl: msg.wsUrl,
            healthUrl: msg.healthUrl,
            port: msg.port,
          };
          resolve(backendConfig);
        }
      } catch {
        /* ignore non-JSON stdout lines */
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(err);
      }
    });

    child.on("exit", (code) => {
      backendProc = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error(`Native Eye Gaze backend exited early (code=${code}).`));
      }
    });
  });
}

function stopBackendSidecar() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const proc = backendProc;
  backendProc = null;
  if (!proc || proc.killed) return;

  try {
    proc.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  setTimeout(() => {
    if (proc && !proc.killed && proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 1500).unref();
}

function createWindow() {
  const iconFile = fs.existsSync(ICON_PATH)
    ? ICON_PATH
    : fs.existsSync(FALLBACK_ICON_SVG)
      ? FALLBACK_ICON_SVG
      : undefined;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Eye Gaze HUD V2.1 — Precision Pupil & Iris Tracker",
    backgroundColor: "#05080f",
    autoHideMenuBar: true,
    icon: iconFile,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const devUrl = process.env.EYE_GAZE_DEV_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(DIST_INDEX);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("get-backend-config", async () => {
  if (backendConfig) {
    return backendConfig;
  }
  throw new Error("Backend not initialized");
});

ipcMain.handle("save-snapshot", async (_event, payload) => {
  const { filename, jsonContent } = payload || {};
  const defaultName =
    typeof filename === "string" && filename.trim()
      ? filename
      : `eye-gaze-snapshot-${Date.now()}.json`;

  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "Export Gaze Snapshot (JSON)",
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePath) {
    return { saved: false, canceled: true };
  }

  fs.writeFileSync(result.filePath, String(jsonContent ?? ""), "utf-8");
  return { saved: true, filePath: result.filePath, canceled: false };
});

app.whenReady().then(async () => {
  try {
    await startBackendSidecar();
  } catch (err) {
    console.error("[EyeGazeDesktop] Failed to start native backend:", err);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopBackendSidecar();
});

app.on("window-all-closed", () => {
  stopBackendSidecar();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("SIGTERM", () => {
  stopBackendSidecar();
  app.quit();
});

process.on("SIGINT", () => {
  stopBackendSidecar();
  app.quit();
});
