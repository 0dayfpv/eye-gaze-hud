"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getBackendConfig: () => ipcRenderer.invoke("get-backend-config"),
  saveSnapshot: (filename, jsonContent) =>
    ipcRenderer.invoke("save-snapshot", { filename, jsonContent }),
  platform: process.platform,
});
