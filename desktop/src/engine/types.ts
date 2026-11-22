export type DelegateType = "GPU" | "CPU";
export type ViewMode = "overlay" | "blackout";

export type AppStatus =
  | "requesting-camera"
  | "loading-model"
  | "ready"
  | "no-camera"
  | "camera-busy"
  | "permission-denied"
  | "error";

export interface Point3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface SmoothingConfig {
  enabled: boolean;
  strength: number; // [0, 1]
}

export interface FaceHeadMetrics {
  headRollDeg: number;
  headYawDeg: number;
  headPitchDeg: number;
  leftEyeOpenness: number; // [0, 100]
  rightEyeOpenness: number; // [0, 100]
  mouthOpenness: number; // [0, 100]
}

export interface FaceConnection {
  readonly start: number;
  readonly end: number;
}

export type GazeZone =
  | "UP-LEFT"
  | "UP"
  | "UP-RIGHT"
  | "LEFT"
  | "CENTER"
  | "RIGHT"
  | "DOWN-LEFT"
  | "DOWN"
  | "DOWN-RIGHT";

export interface EyeBlendshapes {
  eyeLookInLeft: number;
  eyeLookOutLeft: number;
  eyeLookUpLeft: number;
  eyeLookDownLeft: number;
  eyeLookInRight: number;
  eyeLookOutRight: number;
  eyeLookUpRight: number;
  eyeLookDownRight: number;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
}

export interface GazeSettings {
  sensitivityX: number; // [0.8, 4.0]
  sensitivityY: number; // [0.8, 4.0]
  headCompensation: number; // [0, 1]
  showGazeRays: boolean;
  showZoneGrid: boolean;
  showTrail: boolean;
  showHeatmap: boolean;
  showFaceMesh: boolean;
  showEyeMagnifier: boolean;
}

export interface EyeIrisGeometry {
  hx: number;
  hy: number;
  center: Point3D;
  radius: number;
  openness: number;
  isBlinking: boolean;
}

export interface GazeEstimate {
  rawGazeX: number;
  rawGazeY: number;
  screenX: number;
  screenY: number;
  zone: GazeZone;
  leftEye: EyeIrisGeometry | null;
  rightEye: EyeIrisGeometry | null;
  isBlinking: boolean;
  confidence: number;
  calibrated: boolean;
  headMetrics: FaceHeadMetrics | null;
}

export interface GazeCalibrationSample {
  targetX: number;
  targetY: number;
  rawGazeX: number;
  rawGazeY: number;
}

export interface AffineGazeCalibration {
  ax0: number;
  ax1: number;
  ax2: number;
  ay0: number;
  ay1: number;
  ay2: number;
  sampleCount: number;
}

export interface GazeTrailPoint {
  x: number;
  y: number;
  timestampMs: number;
}

export interface NativeFrameHeader {
  type: "frame";
  timestampMs: number;
  frameSeq: number;
  width: number;
  height: number;
  cameraFps: number;
  inferenceMs: number;
  delegate: DelegateType;
  faceDetected: boolean;
  landmarks: [number, number, number][];
  blendshapes: EyeBlendshapes | null;
}

export interface NativeStatusMessage {
  type: "status";
  status: AppStatus;
  message?: string;
  delegate?: DelegateType;
}

export type ClientCommand =
  | { type: "retry_camera" }
  | { type: "set_delegate"; delegate: "auto" | "gpu" | "cpu" }
  | { type: "shutdown" };

export interface DecodedFramePacket {
  header: NativeFrameHeader;
  faceLandmarks: Point3D[] | null;
  faceBlendshapes: EyeBlendshapes | null;
  jpegBytes: Uint8Array;
}

export interface ElectronAPI {
  getBackendConfig: () => Promise<{ wsUrl: string; healthUrl: string; port: number }>;
  saveSnapshot: (
    filename: string,
    jsonContent: string,
  ) => Promise<{ saved: boolean; filePath?: string; canceled?: boolean }>;
  platform: string;
}
