import { useEffect, useMemo, useRef, useState } from 'react';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { Die, DiceRoll } from '../engine/types';
import { DIE_SIZE, PIPS } from './die3dConstants';
import { CENTER_MS, HOLD_MS, MAX_SIM_STEPS, SETTLE_MS } from './diceTiming';

// ─── Physics conventions ────────────────────────────────────────────────
// Top-down dice tray view: gravity pulls cubes INTO the screen (along
// world -z), so the cube's top face — opposite to gravity — naturally
// settles facing the camera (+z). This is exactly the canonical pose,
// so no 90° "flip" is needed at the end of the throw.
//
// Each die has its own private physics world with floor + 4 walls.
// On-screen motion comes from the throw's initial xy velocity (cube
// bouncing off slot walls); receding into the screen is the gravity-
// driven "fall."
const GRAVITY_Z = 1100;
const FLOOR_Z = 28; // cube settles with its centre at z ≈ 0
// Cube spawns just above the floor at one side of the slot — it's
// THROWN across the slot rather than dropped onto it. The strong
// horizontal velocity makes for visible lateral motion + multiple wall
// bounces; gravity still pulls -z so the rolled face settles toward
// the camera.
const SPAWN_Z = 70;
// Per-die slot geometry. Doubles are now rendered as two dice (not
// four), so there's always plenty of room for each cube to throw and
// bounce. One constant set, no per-count branching.
const SLOT_WIDTH = 280;
const SLOT_WALL_HALF = 130;
const WALL_HALF_Y = 100;
const CUBE_HALF = DIE_SIZE / 2;

function slotGeometry(_diceCount: number): { width: number; wallHalf: number } {
  return { width: SLOT_WIDTH, wallHalf: SLOT_WALL_HALF };
}
// Tuned for a long, lively roll. Restitution 0.6 means each wall/floor
// contact returns 60 % of the impact velocity, so the cube ricochets
// across the slot 3-4 times before its energy bleeds down. Low friction
// and damping let the spin and slide carry on while the cube is in
// motion. Sleep settings require the cube to be genuinely still before
// it stops — no premature freeze mid-roll.
const RESTITUTION = 0.6;
const FRICTION = 0.3;
const SLEEP_SPEED_LIMIT = 4;
const SLEEP_TIME_LIMIT = 0.12;
const LINEAR_DAMPING = 0.01;
const ANGULAR_DAMPING = 0.08;

const PHYSICS_DT = 1 / 60;
const ATTEMPTS_PER_DIE = 80;
const PLAYBACK_FPS = 60;

// Three-stage settle. First we hold position and slerp rotation to a
// readable 3D display pose; then we hold a beat so the value is readable;
// only then do we glide to the turn-side tray.

// ─── Die3D face → cube-local outward normal (CSS y-down coords) ─────────
// Face 1 sits at +z, 2 at -z, 3 at -x, 4 at +x, 5 at +y, 6 at -y.
const FACE_LOCAL_NORMALS: Record<Die, [number, number, number]> = {
  1: [0, 0, 1],
  2: [0, 0, -1],
  3: [-1, 0, 0],
  4: [1, 0, 0],
  5: [0, 1, 0],
  6: [0, -1, 0],
};

// Canonical "face V points toward the camera (+z world)" quaternion.
// At rest the player sees the rolled face flat-on, perpendicular to the
// screen. (These are the same rotations Die3D uses in FACE_TARGET_ROTATION.)
const HALF_SQRT2 = Math.SQRT1_2;
const FACE_FRONT_QUATS: Record<Die, Quat> = {
  // Face 1 normal +z → +z: identity
  1: { x: 0, y: 0, z: 0, w: 1 },
  // Face 2 normal -z → +z: R_y(π)
  2: { x: 0, y: 1, z: 0, w: 0 },
  // Face 3 normal -x → +z: R_y(+π/2)
  3: { x: 0, y: HALF_SQRT2, z: 0, w: HALF_SQRT2 },
  // Face 4 normal +x → +z: R_y(-π/2)
  4: { x: 0, y: -HALF_SQRT2, z: 0, w: HALF_SQRT2 },
  // Face 5 normal +y → +z: R_x(+π/2)
  5: { x: HALF_SQRT2, y: 0, z: 0, w: HALF_SQRT2 },
  // Face 6 normal -y → +z: R_x(-π/2)
  6: { x: -HALF_SQRT2, y: 0, z: 0, w: HALF_SQRT2 },
};

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface Vec3Lite {
  x: number;
  y: number;
  z: number;
}

interface RandomSource {
  next(): number;
}

interface Frame {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return {
    next: () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function seedFromRoll(roll: DiceRoll): number {
  return ((roll[0] * 73856093) ^ (roll[1] * 19349663) ^ 0xa5a5a5a5) >>> 0;
}

function dieValueFacingCamera(quat: CANNON.Quaternion): Die | null {
  let best: Die | null = null;
  let bestZ = -Infinity;
  const v = new CANNON.Vec3();
  for (const die of [1, 2, 3, 4, 5, 6] as Die[]) {
    const n = FACE_LOCAL_NORMALS[die];
    v.set(n[0], n[1], n[2]);
    quat.vmult(v, v);
    if (v.z > bestZ) {
      bestZ = v.z;
      best = die;
    }
  }
  if (bestZ < 0.85) return null; // tilted on edge
  return best;
}

function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatNormalize(q: Quat): Quat {
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

function quatFromAxisAngle(x: number, y: number, z: number, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}

const DISPLAY_TILT_QUAT = quatNormalize(
  quatMul(
    quatFromAxisAngle(0, 1, 0, -0.34),
    quatFromAxisAngle(1, 0, 0, 0.3)
  )
);

function slerp(qa: Quat, qb: Quat, t: number): Quat {
  let cos = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
  let qbAdj = qb;
  if (cos < 0) {
    qbAdj = { x: -qb.x, y: -qb.y, z: -qb.z, w: -qb.w };
    cos = -cos;
  }
  if (cos > 0.9995) {
    // Falls back to nlerp when the two quaternions are nearly aligned —
    // avoids the divide-by-zero and is visually identical at small angles.
    return quatNormalize({
      x: qa.x + t * (qbAdj.x - qa.x),
      y: qa.y + t * (qbAdj.y - qa.y),
      z: qa.z + t * (qbAdj.z - qa.z),
      w: qa.w + t * (qbAdj.w - qa.w),
    });
  }
  const angle = Math.acos(cos);
  const sinAngle = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sinAngle;
  const wb = Math.sin(t * angle) / sinAngle;
  return {
    x: wa * qa.x + wb * qbAdj.x,
    y: wa * qa.y + wb * qbAdj.y,
    z: wa * qa.z + wb * qbAdj.z,
    w: wa * qa.w + wb * qbAdj.w,
  };
}

/** Among the four "face V toward camera" orientations rotated 0/90/180/270°
 *  around the camera axis (+z world), pick the one closest to the
 *  physics-settled quaternion. The rolled face stays angled toward the
 *  screen so the cube keeps visible depth; only the pip in-plane spin
 *  is adjusted for the closest-looking final pose. */
function pickReadableCubePose(qFinal: Quat, value: Die): Quat {
  const qBase = FACE_FRONT_QUATS[value];
  let best = qBase;
  let bestDot = -Infinity;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const half = yaw / 2;
    // Yaw rotation around world +z axis (camera-axis spin).
    const qYaw: Quat = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
    const candidate = quatMul(DISPLAY_TILT_QUAT, quatMul(qYaw, qBase));
    const dot =
      qFinal.x * candidate.x +
      qFinal.y * candidate.y +
      qFinal.z * candidate.z +
      qFinal.w * candidate.w;
    const abs = Math.abs(dot);
    if (abs > bestDot) {
      bestDot = abs;
      best = candidate;
    }
  }
  return best;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function diceToShow(
  roll: DiceRoll,
  remaining: readonly Die[]
): Array<{ value: Die; used: boolean }> {
  if (roll[0] === roll[1]) {
    // Doubles grant FOUR moves but we still render only TWO dice (real
    // backgammon — the player knows doubles means ×2). The dice grey
    // out progressively to indicate how many of the four moves remain:
    //   0–1 moves used → both fresh
    //   2–3 moves used → one die greyed
    //   4   moves used → both greyed
    const used = 4 - remaining.length;
    return [
      { value: roll[0], used: used >= 2 },
      { value: roll[0], used: used >= 4 },
    ];
  }
  const remCopy = [...remaining];
  return ([roll[0], roll[1]] as const).map((v) => {
    const idx = remCopy.indexOf(v);
    if (idx >= 0) {
      remCopy.splice(idx, 1);
      return { value: v, used: false };
    }
    return { value: v, used: true };
  });
}

/** A self-contained per-die physics world. Using one private world per
 *  die means brute-force re-rolls stay cheap (1 body each) and the
 *  per-slot walls geometrically prevent any overlap with neighbours. */
function buildWorld(slotWallHalf: number): { world: CANNON.World; body: CANNON.Body } {
  const world = new CANNON.World({
    // Gravity into the screen — cube top face naturally settles toward
    // the camera (+z), which is the canonical pose. No 90° flip needed.
    gravity: new CANNON.Vec3(0, 0, -GRAVITY_Z),
    allowSleep: true,
  });
  world.defaultContactMaterial.restitution = RESTITUTION;
  world.defaultContactMaterial.friction = FRICTION;

  // Floor at z=-FLOOR_Z. Default plane normal is +z (toward camera) —
  // exactly the direction we want, opposite to gravity.
  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  floor.position.set(0, 0, -FLOOR_Z);
  world.addBody(floor);

  // Left wall: normal +x.
  const left = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  left.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
  left.position.set(-slotWallHalf, 0, 0);
  world.addBody(left);

  // Right wall: normal -x.
  const right = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  right.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2);
  right.position.set(slotWallHalf, 0, 0);
  world.addBody(right);

  // Top wall (CSS y-down, so "top of screen" is -y). Normal +y.
  const top = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  top.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  top.position.set(0, -WALL_HALF_Y, 0);
  world.addBody(top);

  // Bottom wall. Normal -y.
  const bottom = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  bottom.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
  bottom.position.set(0, WALL_HALF_Y, 0);
  world.addBody(bottom);

  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(CUBE_HALF, CUBE_HALF, CUBE_HALF)),
    sleepTimeLimit: SLEEP_TIME_LIMIT,
    sleepSpeedLimit: SLEEP_SPEED_LIMIT,
    linearDamping: LINEAR_DAMPING,
    angularDamping: ANGULAR_DAMPING,
    allowSleep: true,
  });
  world.addBody(body);

  return { world, body };
}

/** Reset the body to a fresh "thrown from one side" toss. All cubes in
 *  the same roll share `startSide` — they travel together in the same
 *  direction, like real dice tossed from one hand. */
function throwBody(
  body: CANNON.Body,
  slotWallHalf: number,
  startSide: number,
  rng: RandomSource
): void {
  // Cube starts just inside the chosen wall.
  body.position.set(
    startSide * (slotWallHalf - CUBE_HALF - 4),
    (rng.next() - 0.5) * (WALL_HALF_Y - CUBE_HALF) * 1.2,
    SPAWN_Z + rng.next() * 25
  );
  // Throw velocity scales with slot width — wider slots get more
  // initial energy so the cube actually traverses the longer distance.
  // Base 320 px/s with up to +180 random for variation.
  const slotEnergy = 320 + Math.max(0, slotWallHalf - 70) * 1.35;
  body.velocity.set(
    -startSide * (slotEnergy + rng.next() * 180),
    (rng.next() - 0.5) * 230,
    -28 + rng.next() * 42
  );
  // High angular velocity — combined with floor friction this turns
  // sliding into rolling, so the cube visibly tumbles end-over-end as
  // it travels.
  body.angularVelocity.set(
    (rng.next() - 0.5) * 35,
    (rng.next() - 0.5) * 35,
    (rng.next() - 0.5) * 35
  );
  body.quaternion.setFromEuler(
    rng.next() * 2 * Math.PI,
    rng.next() * 2 * Math.PI,
    rng.next() * 2 * Math.PI
  );
  body.wakeUp();
  body.allowSleep = true;
  body.sleepState = CANNON.Body.AWAKE;
}

function simulateThrow(world: CANNON.World, body: CANNON.Body): {
  frames: Frame[];
  finalUpFace: Die | null;
} {
  const frames: Frame[] = [];
  for (let i = 0; i < MAX_SIM_STEPS; i++) {
    world.step(PHYSICS_DT);
    const p = body.position;
    const q = body.quaternion;
    frames.push({ px: p.x, py: p.y, pz: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    if (body.sleepState === CANNON.Body.SLEEPING) break;
  }
  return { frames, finalUpFace: dieValueFacingCamera(body.quaternion) };
}

function rollDie(
  desiredValue: Die,
  slotWallHalf: number,
  startSide: number,
  rng: RandomSource
): Frame[] {
  const { world, body } = buildWorld(slotWallHalf);
  let lastFrames: Frame[] = [];
  for (let attempt = 0; attempt < ATTEMPTS_PER_DIE; attempt++) {
    throwBody(body, slotWallHalf, startSide, rng);
    const { frames, finalUpFace } = simulateThrow(world, body);
    lastFrames = frames;
    if (finalUpFace === desiredValue) return frames;
  }
  // If brute force failed, fall through with the last trajectory — the
  // settle slerp will rotate the cube to the correct face anyway.
  return lastFrames;
}

interface Props {
  roll: DiceRoll | null;
  remaining: readonly Die[];
  settleSide?: 'left' | 'right';
  placement?: 'board' | 'hud';
}

interface TrajectoryData {
  readonly values: readonly Die[];
  readonly frames: readonly Frame[][];
}

interface ThreeDie {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial[]>;
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  materials: THREE.MeshStandardMaterial[];
}

interface ThreeDiceStage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  dice: ThreeDie[];
  geometry: THREE.BoxGeometry;
  shadowGeometry: THREE.CircleGeometry;
}

// Target die size as a fraction of the board's actual width — tuned to
// match the reference mobile layouts, where the dice are small relative
// to the playing surface (~4 % of board width per die). At our 56 px
// design die size this works out to a render scale around 0.7 on a
// ~1000 px board column, regardless of viewport zoom.
// Dice sized to ~3.15% of the board width — 30 % smaller than the
// previous 4.5 % which read oversized on mobile. Min/max scales
// clamped down to match.
const TARGET_DIE_RATIO = 0.0315;
const MAX_DICE_SCALE = 0.6;
const MIN_DICE_SCALE = 0.38;

const THREE_STAGE_WIDTH = 1800;
const THREE_STAGE_HEIGHT = 1800;
const DICE_FACE_TEXTURE_SIZE = 256;
const FACE_MATERIAL_ORDER: Die[] = [4, 3, 5, 6, 1, 2];

const textureCache = new Map<string, THREE.CanvasTexture>();

function createDiceTexture(face: Die, used: boolean): THREE.CanvasTexture {
  const cacheKey = `${face}-${used ? 'used' : 'live'}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = DICE_FACE_TEXTURE_SIZE;
  canvas.height = DICE_FACE_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    textureCache.set(cacheKey, fallback);
    return fallback;
  }

  const size = DICE_FACE_TEXTURE_SIZE;
  const radius = 34;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, used ? '#e3d3ac' : '#fffaf4');
  gradient.addColorStop(0.48, used ? '#c9b581' : '#f8e9ca');
  gradient.addColorStop(1, used ? '#9f8351' : '#e1b46e');

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(6, 6, size - 12, size - 12, radius);
  ctx.fill();

  ctx.lineWidth = 14;
  ctx.strokeStyle = '#725349';
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 236, 176, 0.78)';
  ctx.beginPath();
  ctx.roundRect(20, 20, size - 40, size - 40, radius * 0.65);
  ctx.stroke();

  ctx.fillStyle = 'rgba(81, 50, 40, 0.16)';
  ctx.beginPath();
  ctx.roundRect(17, size - 52, size - 34, 30, 16);
  ctx.fill();

  const positions = PIPS[face];
  const pipBase = face === 1 || face === 4 ? '#d5483d' : '#331e18';
  const centers = [
    [size * 0.27, size * 0.27],
    [size * 0.5, size * 0.27],
    [size * 0.73, size * 0.27],
    [size * 0.27, size * 0.5],
    [size * 0.5, size * 0.5],
    [size * 0.73, size * 0.5],
    [size * 0.27, size * 0.73],
    [size * 0.5, size * 0.73],
    [size * 0.73, size * 0.73],
  ];
  const pipRadius = face === 1 ? 17 : 14;

  for (const pos of positions) {
    const [x, y] = centers[pos];
    const pipGradient = ctx.createRadialGradient(
      x - pipRadius * 0.35,
      y - pipRadius * 0.35,
      2,
      x,
      y,
      pipRadius
    );
    pipGradient.addColorStop(0, used ? '#f2e6c4' : '#fff4d6');
    pipGradient.addColorStop(0.28, used ? '#a9986c' : pipBase);
    pipGradient.addColorStop(1, used ? '#685734' : '#1a0e05');
    ctx.fillStyle = pipGradient;
    ctx.beginPath();
    ctx.arc(x, y, pipRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textureCache.set(cacheKey, texture);
  return texture;
}

function createDiceMaterials(used: boolean): THREE.MeshStandardMaterial[] {
  return FACE_MATERIAL_ORDER.map((face) => {
    const material = new THREE.MeshStandardMaterial({
      map: createDiceTexture(face, used),
      roughness: 0.72,
      metalness: 0.02,
      transparent: used,
      opacity: used ? 0.45 : 1,
    });
    material.side = THREE.FrontSide;
    return material;
  });
}

function disposeStage(stage: ThreeDiceStage | null): void {
  if (!stage) return;
  stage.renderer.dispose();
  stage.geometry.dispose();
  stage.shadowGeometry.dispose();
  for (const die of stage.dice) {
    for (const material of die.materials) material.dispose();
    die.shadow.material.dispose();
  }
  stage.renderer.domElement.remove();
}

export default function DiceTray({
  roll,
  remaining,
  settleSide = 'right',
  placement = 'board',
}: Props) {
  const dice = useMemo(() => (roll ? diceToShow(roll, remaining) : []), [roll, remaining]);
  const diceCount = dice.length;

  // Scale the dice rendering to the board's actual width. Physics stays
  // in pixel coords at design size; the wrapper applies a CSS scale.
  // We use a state-backed callback ref so the effect re-runs WHEN the
  // wrapper element actually attaches — `roll === null` returns null
  // below, so the wrapper isn't in the DOM until the first roll.
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!wrapperEl) return;
    const update = () => {
      const w = wrapperEl.clientWidth;
      if (w <= 0) return;
      if (placement === 'hud') {
        setScale(w < 170 ? 0.46 : 0.52);
        return;
      }
      // Target die size = TARGET_DIE_RATIO * board width.
      // Render scale = target / DIE_SIZE.
      const targetDieSize = w * TARGET_DIE_RATIO;
      const raw = targetDieSize / DIE_SIZE;
      const next = Math.max(MIN_DICE_SCALE, Math.min(MAX_DICE_SCALE, raw));
      setScale(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapperEl);
    return () => ro.disconnect();
  }, [placement, wrapperEl]);

  // Trajectories are deterministic given (roll, dice.length). We compute
  // them synchronously when the roll changes so the very first paint can
  // already show the cubes mid-flight (no flash from a default position).
  const rollKey = roll ? `${roll[0]}-${roll[1]}` : 'none';
  const trajectoryData = useMemo<TrajectoryData>(() => {
    if (!roll) return { values: [], frames: [] };
    // Always render two physical dice — doubles are conveyed by both
    // dice showing the same face, not by spawning four cubes.
    const rollValues = [roll[0], roll[1]];
    const rng = seededRandom(seedFromRoll(roll));
    const { wallHalf } = slotGeometry(rollValues.length);
    // Pick the throw direction ONCE for this roll — every die starts
    // from the active player's side, like real dice tossed from one hand.
    const startSide = placement === 'hud' ? (rng.next() < 0.5 ? -1 : 1) : settleSide === 'right' ? 1 : -1;
    const frames = rollValues.map((value) => rollDie(value, wallHalf, startSide, rng));
    // Each die simulates in its own physics world, so the two cubes
    // can't see each other and sometimes settle on (nearly) identical
    // (x, y) coordinates. Post-process the final frames: if the cubes
    // are closer than ~1.4 × DIE_SIZE, push them apart along their
    // connecting axis so the visible settle pose has clear separation.
    if (frames.length === 2 && frames[0].length > 0 && frames[1].length > 0) {
      const a = frames[0][frames[0].length - 1]!;
      const b = frames[1][frames[1].length - 1]!;
      const dx = b.px - a.px;
      const dy = b.py - a.py;
      const dist = Math.hypot(dx, dy);
      const minDist = DIE_SIZE * 1.4;
      if (dist < minDist) {
        // Choose a separation axis — vertical when the cubes are
        // basically on top of each other, otherwise along the line
        // between them.
        let nx: number;
        let ny: number;
        if (dist < 1) {
          nx = 0;
          ny = 1;
        } else {
          nx = dx / dist;
          ny = dy / dist;
        }
        const push = (minDist - dist) / 2;
        a.px -= nx * push;
        a.py -= ny * push;
        b.px += nx * push;
        b.py += ny * push;
      }
    }
    return { values: rollValues, frames };
  }, [placement, roll, settleSide]);

  const stageElRef = useRef<HTMLDivElement | null>(null);
  const threeStageRef = useRef<ThreeDiceStage | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const stageEl = stageElRef.current;
    if (!stageEl || rollKey === 'none' || diceCount === 0) return;

    disposeStage(threeStageRef.current);
    threeStageRef.current = null;
    stageEl.textContent = '';

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(THREE_STAGE_WIDTH, THREE_STAGE_HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.pointerEvents = 'none';
    stageEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      -THREE_STAGE_WIDTH / 2,
      THREE_STAGE_WIDTH / 2,
      THREE_STAGE_HEIGHT / 2,
      -THREE_STAGE_HEIGHT / 2,
      -1000,
      1000
    );
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const keyLight = new THREE.DirectionalLight(0xfff0cc, 2.7);
    keyLight.position.set(-120, 180, 420);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x7cc5ff, 0.85);
    rimLight.position.set(180, -120, 240);
    scene.add(rimLight);

    const geometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    const shadowGeometry = new THREE.CircleGeometry(DIE_SIZE * 0.62, 36);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3bd2e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    const diceMeshes = Array.from({ length: diceCount }, (_, i) => {
      const slotW = slotGeometry(diceCount).width;
      const slotX = (i - (diceCount - 1) / 2) * slotW;
      const materials = createDiceMaterials(false);
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.position.set(slotX, 0, 0);
      scene.add(mesh);

      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial.clone());
      shadow.position.set(slotX + 6, -8, -42);
      shadow.scale.set(1.08, 0.58, 1);
      scene.add(shadow);

      return { mesh, shadow, materials };
    });
    shadowMaterial.dispose();

    const stage: ThreeDiceStage = {
      renderer,
      scene,
      camera,
      dice: diceMeshes,
      geometry,
      shadowGeometry,
    };
    threeStageRef.current = stage;
    renderer.render(scene, camera);

    return () => {
      if (threeStageRef.current === stage) threeStageRef.current = null;
      disposeStage(stage);
    };
  }, [diceCount, rollKey]);

  useEffect(() => {
    const stage = threeStageRef.current;
    if (!stage) return;
    dice.forEach((d, i) => {
      const die = stage.dice[i];
      if (!die) return;
      die.mesh.visible = true;
      const nextMaterials = createDiceMaterials(d.used);
      for (const material of die.materials) material.dispose();
      die.mesh.material = nextMaterials;
      die.materials = nextMaterials;
    });
    stage.renderer.render(stage.scene, stage.camera);
  }, [dice]);

  useEffect(() => {
    const trajectories = trajectoryData.frames;
    const trajectoryValues = trajectoryData.values;
    if (rollKey === 'none' || trajectories.length === 0) return;

    if (animRef.current) cancelAnimationFrame(animRef.current);

    const finalQuats: Quat[] = trajectories.map((t) => {
      const last = t[t.length - 1];
      return last ? { x: last.qx, y: last.qy, z: last.qz, w: last.qw } : { x: 0, y: 0, z: 0, w: 1 };
    });
    const finalPos: Vec3Lite[] = trajectories.map((t) => {
      const last = t[t.length - 1];
      return last ? { x: last.px, y: last.py, z: last.pz } : { x: 0, y: 0, z: 0 };
    });
    const targetQuats: Quat[] = trajectoryValues.map((value, i) =>
      pickReadableCubePose(finalQuats[i], value)
    );
    const boardWidth = wrapperEl?.clientWidth ?? 600;
    const boardHeight = wrapperEl?.clientHeight ?? 450;
    const safeScale = Math.max(0.1, scale);
    const sideSign = settleSide === 'right' ? 1 : -1;
    // Settle the dice just below the header, horizontally under the
    // active player's name in the central pill (the names sit on the
    // pill's wings ≈ ±11 % of board width from the board centre).
    // The previous 0.405 offset put the dice at the far side panels,
    // away from the header.
    //
    // writeQP() does `mesh.position.set(x, -y, z)` and three's ortho
    // camera has +y pointing UP, so a NEGATIVE targetCenterY here
    // puts the dice ABOVE the board centre — i.e. up near the header.
    const targetCenterX =
      placement === 'hud' ? 0 : sideSign * (boardWidth / safeScale) * 0.11;
    const targetCenterY =
      placement === 'hud' ? 0 : -(boardHeight / safeScale) * 0.4;
    // Two dice always; spread them horizontally now since they sit in
    // a row beneath the player's name rather than stacked along the
    // side rail. 92 px between centres reads cleanly at every scale.
    const targetPositions = trajectories.map((_, i) => ({
      x: targetCenterX + (i - (trajectories.length - 1) / 2) * 92,
      y: targetCenterY,
      z: 0,
    }));

    let phase: 'play' | 'settle' | 'hold' | 'center' | 'done' = 'play';
    const playStart = performance.now();
    let phaseStart = playStart;

    const writeQP = (idx: number, q: Quat, x: number, y: number, z: number) => {
      const die = threeStageRef.current?.dice[idx];
      if (!die) return;
      die.mesh.position.set(x, -y, z);
      die.mesh.quaternion.set(q.x, q.y, q.z, q.w);

      const height = Math.max(0, z);
      const shadowScale = Math.max(0.52, 1.08 - height * 0.005);
      die.shadow.position.set(x + 6, -y - 8, -44);
      die.shadow.scale.set(shadowScale, shadowScale * 0.55, 1);
      die.shadow.material.opacity = Math.max(0.05, 0.22 - height * 0.0025);
    };
    const writeRaw = (idx: number, f: Frame) => {
      writeQP(idx, { x: f.qx, y: f.qy, z: f.qz, w: f.qw }, f.px, f.py, f.pz);
    };
    const renderStage = () => {
      const stage = threeStageRef.current;
      if (!stage) return;
      stage.renderer.render(stage.scene, stage.camera);
    };

    // Paint frame 0 immediately so the very first paint already shows the
    // throw start (no default-pose flicker).
    for (let i = 0; i < trajectories.length; i++) {
      const f = trajectories[i][0];
      if (f) writeRaw(i, f);
    }
    renderStage();

    const step = (nowTs: number) => {
      if (phase === 'play') {
        const elapsed = nowTs - playStart;
        const targetIdx = Math.floor((elapsed / 1000) * PLAYBACK_FPS);
        let allDone = true;
        for (let i = 0; i < trajectories.length; i++) {
          const traj = trajectories[i];
          const idx = Math.min(targetIdx, traj.length - 1);
          const f = traj[idx];
          if (idx < traj.length - 1) allDone = false;
          if (f) writeRaw(i, f);
        }
        renderStage();
        if (allDone) {
          phase = 'settle';
          phaseStart = nowTs;
        }
      } else if (phase === 'settle') {
        // Position is FROZEN at where the cube physics-stopped. Only
        // rotation tweens — slerp from physics-final to a readable
        // angled cube pose, so the rolled number is clear but the die
        // still reads as a real cube instead of a flat tile.
        const t = Math.min((nowTs - phaseStart) / SETTLE_MS, 1);
        const e = easeOutCubic(t);
        for (let i = 0; i < trajectories.length; i++) {
          const q = slerp(finalQuats[i], targetQuats[i], e);
          writeQP(i, q, finalPos[i].x, finalPos[i].y, finalPos[i].z);
        }
        renderStage();
        if (t >= 1) {
          phase = 'hold';
          phaseStart = nowTs;
        }
      } else if (phase === 'hold') {
        // Static read-time at the angled readable pose + physics-final
        // position — gives the player a beat to read the rolled value
        // before the cubes glide to the turn-side tray.
        if (nowTs - phaseStart >= HOLD_MS) {
          phase = 'center';
          phaseStart = nowTs;
        }
      } else if (phase === 'center') {
        // Position-only tween from physics-rest spot to the turn-side slot.
        // Rotation stays readable — the rolled face stays visible
        // throughout the slide.
        const t = Math.min((nowTs - phaseStart) / CENTER_MS, 1);
        const e = easeOutCubic(t);
        for (let i = 0; i < trajectories.length; i++) {
          const target = targetPositions[i];
          const x = finalPos[i].x * (1 - e) + target.x * e;
          const y = finalPos[i].y * (1 - e) + target.y * e;
          const z = finalPos[i].z * (1 - e) + target.z * e;
          writeQP(i, targetQuats[i], x, y, z);
        }
        renderStage();
        if (t >= 1) phase = 'done';
      }

      if (phase !== 'done') {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [placement, rollKey, scale, settleSide, trajectoryData, wrapperEl]);

  // Pure dice renderer — when there's no roll yet there's nothing to show.
  // The Roll / End-turn / Double / Undo buttons live in ActionButtons,
  // which the parent layout renders alongside (not nested inside) the tray.
  if (roll === null) return null;

  const rootClass =
    placement === 'hud'
      ? 'relative pointer-events-none flex h-20 w-40 items-center justify-center overflow-visible sm:h-24 sm:w-48'
      : 'absolute inset-0 pointer-events-none flex items-center justify-center';

  return (
    <div
      ref={setWrapperEl}
      className={rootClass}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          style={{
            position: 'relative',
            width: THREE_STAGE_WIDTH,
            height: THREE_STAGE_HEIGHT,
            pointerEvents: 'none',
            transform:
              placement === 'hud'
                ? `scale(${scale})`
                : `scale(${scale}) rotateZ(-0.8deg)`,
            transformOrigin: 'center center',
          }}
        >
          <div
            ref={stageElRef}
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}
