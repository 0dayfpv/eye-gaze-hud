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

export type Landmark3D = [number, number, number];

export interface EyeBlendshapesPayload {
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

export interface SyntheticFrameData {
  faceDetected: boolean;
  landmarks: Landmark3D[];
  blendshapes: EyeBlendshapesPayload | null;
}

export interface SyntheticFaceOptions {
  /** Normalized horizontal screen direction [-1..1] in mirrored mode (+1 = screen right). */
  dirX?: number;
  /** Normalized vertical screen direction [-1..1] (+1 = screen down). */
  dirY?: number;
  /** Direct iris hx override [0..1] (0.5 = centered). Overrides dirX for geometry if provided. */
  hx?: number;
  /** Direct iris hy override [0..1] (0.5 = centered). Overrides dirY for geometry if provided. */
  hy?: number;
  /** Head yaw in degrees (positive shifts noseTip +x). */
  yawDeg?: number;
  /** Head pitch in degrees (positive shifts noseTip +y). */
  pitchDeg?: number;
  /** Head roll in degrees (rotates ocular line). */
  rollDeg?: number;
  /** Bilateral blink flag. */
  blink?: boolean;
  /** Unilateral blink override. */
  blinkLeft?: boolean;
  blinkRight?: boolean;
  /** Explicit blendshape blink scores [0..1]. */
  eyeBlinkLeftScore?: number;
  eyeBlinkRightScore?: number;
  /** Explicit eye openness [0..100] when not blinking. */
  leftOpenness?: number;
  rightOpenness?: number;
  /** Whether to omit blendshapes (tests geometric-only fallback). */
  omitBlendshapes?: boolean;
}

const FACE_OVAL_LOOP = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
] as const;

const RIGHT_EYE_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133] as const;
const RIGHT_EYE_LOWER = [33, 7, 163, 144, 145, 153, 154, 155, 133] as const;
const LEFT_EYE_UPPER = [362, 398, 384, 385, 386, 387, 388, 466, 263] as const;
const LEFT_EYE_LOWER = [362, 382, 381, 380, 374, 373, 390, 249, 263] as const;

const RIGHT_BROW_UPPER = [70, 63, 105, 66, 107] as const;
const RIGHT_BROW_LOWER = [46, 53, 52, 65, 55] as const;
const LEFT_BROW_UPPER = [336, 296, 334, 293, 300] as const;
const LEFT_BROW_LOWER = [285, 295, 282, 283, 276] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rotate2D(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rad: number,
): [number, number] {
  if (rad === 0) return [x, y];
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function earAndBlinkForOpenness(
  openness: number | undefined,
  isBlinking: boolean,
  explicitBlinkScore?: number,
): { eyeHeight: number; blinkScore: number } {
  const eyeWidth = 0.08;
  if (isBlinking) {
    return {
      eyeHeight: 0.004,
      blinkScore: explicitBlinkScore ?? 0.92,
    };
  }
  if (openness === undefined) {
    return {
      eyeHeight: 0.026,
      blinkScore: explicitBlinkScore ?? 0.0,
    };
  }
  const target = clamp(openness, 22, 100);
  // Keep earOpenness >= 22 and blendshapeBlink <= 0.50 so non-blinking openness stays below blink threshold
  if (target >= 60) {
    const earOpen = clamp((target - 45) / 0.55, 23, 100);
    const ear = 0.08 + (earOpen / 100) * 0.24;
    return {
      eyeHeight: ear * eyeWidth,
      blinkScore: explicitBlinkScore ?? 0.0,
    };
  }
  const earOpen = 24;
  const ear = 0.08 + (earOpen / 100) * 0.24;
  const blinkScore = clamp(1 - (target - earOpen * 0.55) / 45, 0, 0.5);
  return {
    eyeHeight: ear * eyeWidth,
    blinkScore: explicitBlinkScore ?? blinkScore,
  };
}

/**
 * Generates a mathematically exact 478-landmark face + 10 eye blendshapes
 * matching `computeFaceHeadMetrics` and `computeEyeGaze`.
 */
export function makeSyntheticFace(
  options: SyntheticFaceOptions = {},
): SyntheticFrameData {
  const dirX = clamp(options.dirX ?? 0, -2.5, 2.5);
  const dirY = clamp(options.dirY ?? 0, -2.5, 2.5);
  const yawDeg = options.yawDeg ?? 0;
  const pitchDeg = options.pitchDeg ?? 0;
  const rollDeg = options.rollDeg ?? 0;

  const blinkLeft = options.blink ?? options.blinkLeft ?? false;
  const blinkRight = options.blink ?? options.blinkRight ?? false;

  const hx = options.hx ?? clamp(0.5 - 0.165 * dirX, 0.05, 0.95);
  const hy = options.hy ?? clamp(0.5 + 0.13636 * dirY, 0.05, 0.95);

  // Initialize 478 landmarks distributed deterministically inside the face oval
  const landmarks: Landmark3D[] = new Array<Landmark3D>(478);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 478; i++) {
    const r = Math.sqrt((i + 0.5) / 478);
    const theta = i * goldenAngle;
    landmarks[i] = [
      0.5 + r * 0.115 * Math.cos(theta),
      0.5 + r * 0.195 * Math.sin(theta),
      0.0,
    ];
  }

  // Face oval loop (0 = index 10 top, 9 = index 454 right, 18 = index 152 bottom, 27 = index 234 left)
  const ovalLen = FACE_OVAL_LOOP.length;
  for (let i = 0; i < ovalLen; i++) {
    const idx = FACE_OVAL_LOOP[i]!;
    const angle = -Math.PI / 2 + (i / ovalLen) * Math.PI * 2;
    landmarks[idx] = [
      0.5 + 0.15 * Math.cos(angle),
      0.5 + 0.25 * Math.sin(angle),
      0.0,
    ];
  }

  // Exact canonical head pose anchors
  landmarks[10] = [0.5, 0.25, 0.0];
  landmarks[152] = [0.5, 0.75, 0.0];
  landmarks[234] = [0.35, 0.5, 0.0];
  landmarks[454] = [0.65, 0.5, 0.0];
  landmarks[1] = [
    0.5 + (yawDeg / 45) * 0.15,
    0.53 + (pitchDeg / 60) * 0.25,
    -0.05,
  ];

  // Neutral mouth landmarks (MAR ~ 0.04)
  landmarks[13] = [0.5, 0.618, 0.0];
  landmarks[14] = [0.5, 0.622, 0.0];
  landmarks[61] = [0.45, 0.62, 0.0];
  landmarks[291] = [0.55, 0.62, 0.0];

  // Eyebrows
  for (let i = 0; i < RIGHT_BROW_UPPER.length; i++) {
    const t = i / (RIGHT_BROW_UPPER.length - 1);
    const x = 0.37 + t * 0.1;
    const arc = Math.sin(t * Math.PI) * 0.015;
    landmarks[RIGHT_BROW_UPPER[i]!] = [x, 0.365 - arc, 0.0];
    landmarks[RIGHT_BROW_LOWER[i]!] = [x, 0.378 - arc * 0.6, 0.0];
  }
  for (let i = 0; i < LEFT_BROW_UPPER.length; i++) {
    const t = i / (LEFT_BROW_UPPER.length - 1);
    const x = 0.63 - t * 0.1;
    const arc = Math.sin(t * Math.PI) * 0.015;
    landmarks[LEFT_BROW_UPPER[i]!] = [x, 0.365 - arc, 0.0];
    landmarks[LEFT_BROW_LOWER[i]!] = [x, 0.378 - arc * 0.6, 0.0];
  }

  // Eye heights & blink scores
  const rightEyeMetrics = earAndBlinkForOpenness(
    options.rightOpenness,
    blinkRight,
    options.eyeBlinkRightScore,
  );
  const leftEyeMetrics = earAndBlinkForOpenness(
    options.leftOpenness,
    blinkLeft,
    options.eyeBlinkLeftScore,
  );

  // Right eye: outer=33 (0.38, 0.42), inner=133 (0.46, 0.42)
  const rightEyeW = 0.08;
  for (let i = 0; i < RIGHT_EYE_UPPER.length; i++) {
    const t = i / (RIGHT_EYE_UPPER.length - 1);
    const x = 0.38 + t * rightEyeW;
    const dy = Math.sin(t * Math.PI) * rightEyeMetrics.eyeHeight * 0.5;
    landmarks[RIGHT_EYE_UPPER[i]!] = [x, 0.42 - dy, 0.0];
    landmarks[RIGHT_EYE_LOWER[i]!] = [x, 0.42 + dy, 0.0];
  }
  const rightRefH = Math.max(rightEyeMetrics.eyeHeight, rightEyeW * 0.28);
  const rIx = 0.38 + hx * rightEyeW;
  const rIy = 0.42 + (hy - 0.5) * rightRefH;
  landmarks[468] = [rIx, rIy, 0.0];
  landmarks[469] = [rIx + 0.01, rIy, 0.0];
  landmarks[470] = [rIx, rIy - 0.01, 0.0];
  landmarks[471] = [rIx - 0.01, rIy, 0.0];
  landmarks[472] = [rIx, rIy + 0.01, 0.0];

  // Left eye: inner=362 (0.54, 0.42), outer=263 (0.62, 0.42)
  const leftEyeW = 0.08;
  for (let i = 0; i < LEFT_EYE_UPPER.length; i++) {
    const t = i / (LEFT_EYE_UPPER.length - 1);
    const x = 0.54 + t * leftEyeW;
    const dy = Math.sin(t * Math.PI) * leftEyeMetrics.eyeHeight * 0.5;
    landmarks[LEFT_EYE_UPPER[i]!] = [x, 0.42 - dy, 0.0];
    landmarks[LEFT_EYE_LOWER[i]!] = [x, 0.42 + dy, 0.0];
  }
  const leftRefH = Math.max(leftEyeMetrics.eyeHeight, leftEyeW * 0.28);
  const lIx = 0.54 + hx * leftEyeW;
  const lIy = 0.42 + (hy - 0.5) * leftRefH;
  landmarks[473] = [lIx, lIy, 0.0];
  landmarks[474] = [lIx + 0.01, lIy, 0.0];
  landmarks[475] = [lIx, lIy - 0.01, 0.0];
  landmarks[476] = [lIx - 0.01, lIy, 0.0];
  landmarks[477] = [lIx, lIy + 0.01, 0.0];

  // Apply head roll around inter-ocular midpoint (0.50, 0.42) for ocular/brow/iris landmarks
  if (rollDeg !== 0) {
    const rad = (clamp(rollDeg, -89.5, 89.5) * Math.PI) / 180;
    const rotateIndices = new Set<number>([
      ...RIGHT_EYE_UPPER,
      ...RIGHT_EYE_LOWER,
      ...LEFT_EYE_UPPER,
      ...LEFT_EYE_LOWER,
      ...RIGHT_BROW_UPPER,
      ...RIGHT_BROW_LOWER,
      ...LEFT_BROW_UPPER,
      ...LEFT_BROW_LOWER,
      468,
      469,
      470,
      471,
      472,
      473,
      474,
      475,
      476,
      477,
    ]);
    for (const idx of rotateIndices) {
      const pt = landmarks[idx]!;
      const [rx, ry] = rotate2D(pt[0], pt[1], 0.5, 0.42, rad);
      landmarks[idx] = [rx, ry, pt[2]];
    }
  }

  let blendshapes: EyeBlendshapesPayload | null = null;
  if (!options.omitBlendshapes) {
    const bsXMag = clamp(Math.abs(0.33 * dirX), 0, 1);
    const bsYMag = clamp(Math.abs(0.3 * dirY), 0, 1);
    blendshapes = {
      eyeLookInLeft: dirX > 0 ? bsXMag : 0,
      eyeLookOutRight: dirX > 0 ? bsXMag : 0,
      eyeLookOutLeft: dirX < 0 ? bsXMag : 0,
      eyeLookInRight: dirX < 0 ? bsXMag : 0,
      eyeLookDownLeft: dirY > 0 ? bsYMag : 0,
      eyeLookDownRight: dirY > 0 ? bsYMag : 0,
      eyeLookUpLeft: dirY < 0 ? bsYMag : 0,
      eyeLookUpRight: dirY < 0 ? bsYMag : 0,
      eyeBlinkLeft: leftEyeMetrics.blinkScore,
      eyeBlinkRight: rightEyeMetrics.blinkScore,
    };
  }

  return {
    faceDetected: true,
    landmarks,
    blendshapes,
  };
}

export function makeCenterGaze(): SyntheticFrameData {
  return makeSyntheticFace({ dirX: 0, dirY: 0 });
}

const ZONE_DIRECTIONS: Record<GazeZone, [number, number]> = {
  "UP-LEFT": [-1, -1],
  UP: [0, -1],
  "UP-RIGHT": [1, -1],
  LEFT: [-1, 0],
  CENTER: [0, 0],
  RIGHT: [1, 0],
  "DOWN-LEFT": [-1, 1],
  DOWN: [0, 1],
  "DOWN-RIGHT": [1, 1],
};

export function makeZoneGaze(
  zone: GazeZone,
  extra: Omit<SyntheticFaceOptions, "dirX" | "dirY"> = {},
): SyntheticFrameData {
  const [dirX, dirY] = ZONE_DIRECTIONS[zone];
  return makeSyntheticFace({ ...extra, dirX, dirY });
}

export function makeBlinkFrame(options?: {
  unilateral?: "left" | "right";
  dirX?: number;
  dirY?: number;
}): SyntheticFrameData {
  if (options?.unilateral === "left") {
    return makeSyntheticFace({
      dirX: options.dirX ?? 0,
      dirY: options.dirY ?? 0,
      blinkLeft: true,
      blinkRight: false,
    });
  }
  if (options?.unilateral === "right") {
    return makeSyntheticFace({
      dirX: options.dirX ?? 0,
      dirY: options.dirY ?? 0,
      blinkLeft: false,
      blinkRight: true,
    });
  }
  return makeSyntheticFace({
    dirX: options?.dirX ?? 0,
    dirY: options?.dirY ?? 0,
    blink: true,
  });
}

export function makeHeadPoseFrame(
  yawDeg: number,
  pitchDeg: number,
  rollDeg: number,
  extra: Omit<SyntheticFaceOptions, "yawDeg" | "pitchDeg" | "rollDeg"> = {},
): SyntheticFrameData {
  return makeSyntheticFace({ ...extra, yawDeg, pitchDeg, rollDeg });
}

export function makeNoFaceFrame(): SyntheticFrameData {
  return {
    faceDetected: false,
    landmarks: [],
    blendshapes: null,
  };
}

/**
 * Calibration target order matches CALIBRATION_TARGETS:
 * 0: Center (0.5, 0.5)
 * 1: Top-Left (0.14, 0.16)
 * 2: Top-Right (0.86, 0.16)
 * 3: Bottom-Right (0.86, 0.84)
 * 4: Bottom-Left (0.14, 0.84)
 */
const CALIBRATION_DIRS: readonly [number, number][] = [
  [0, 0],
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export function makeCalibrationTargetGaze(targetIndex: number): SyntheticFrameData {
  const pair = CALIBRATION_DIRS[targetIndex] ?? [0, 0];
  return makeSyntheticFace({ dirX: pair[0], dirY: pair[1] });
}
