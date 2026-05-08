import { useEffect, useMemo, useRef } from 'react';
import * as CANNON from 'cannon-es';
import type { Die, DiceRoll, Player } from '../engine/types';
import { Face, FACE_TRANSFORMS, DIE_SIZE } from './Die3D';

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
// Per-die slot geometry. Walls in the xy plane keep the cube inside its
// own slot. Cube CENTER can travel up to ±(SLOT_WALL_HALF − CUBE_HALF).
// With SLOT_WIDTH = 140 and SLOT_WALL_HALF = 65 the cube has ±37 px of
// horizontal play (plenty of wall-bounces) while the cube's outer edge
// max keeps a comfortable gap to the neighbouring slot's cube.
const SLOT_WIDTH = 140;
const SLOT_WALL_HALF = 65;
const WALL_HALF_Y = 95; // vertical bounds of slot (in CSS y-down coords)
const CUBE_HALF = DIE_SIZE / 2;
// Bouncier dice — restitution 0.42 means each wall/floor hit returns
// ~42 % of the impact velocity, so the cube ricochets off the far wall
// with enough energy to traverse back across, giving 2-3 visible bounces
// per throw instead of dying on first contact.
const RESTITUTION = 0.42;
const FRICTION = 0.22;
const SLEEP_SPEED_LIMIT = 7;
const SLEEP_TIME_LIMIT = 0.05;
const LINEAR_DAMPING = 0.02;
const ANGULAR_DAMPING = 0.16;

const PHYSICS_DT = 1 / 60;
const MAX_SIM_STEPS = 360;
const ATTEMPTS_PER_DIE = 80;
const PLAYBACK_FPS = 60;

// Three-stage settle. First we hold position and slerp rotation to
// canonical (rolled face perpendicular to camera) so the player sees
// exactly where the cube fell with the right number squarely up; then
// we hold a beat so the value is readable; only then do we glide to
// slot centre.
const SETTLE_MS = 280;
const HOLD_MS = 240;
const CENTER_MS = 460;

export const DICE_ANIMATION_MS =
  (MAX_SIM_STEPS / 60) * 1000 + SETTLE_MS + HOLD_MS + CENTER_MS;

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

interface Frame {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
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
 *  physics-settled quaternion. The rolled face stays perpendicular to the
 *  screen; only the in-plane spin of the pip pattern is preserved. */
function pickYawedFaceFront(qFinal: Quat, value: Die): Quat {
  const qBase = FACE_FRONT_QUATS[value];
  let best = qBase;
  let bestDot = -Infinity;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const half = yaw / 2;
    // Yaw rotation around world +z axis (camera-axis spin).
    const qYaw: Quat = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
    const candidate = quatMul(qYaw, qBase);
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

function quatToCSSMatrix(qx: number, qy: number, qz: number, qw: number, x: number, y: number, z: number): string {
  const m00 = 1 - 2 * (qy * qy + qz * qz);
  const m01 = 2 * (qx * qy - qz * qw);
  const m02 = 2 * (qx * qz + qy * qw);
  const m10 = 2 * (qx * qy + qz * qw);
  const m11 = 1 - 2 * (qx * qx + qz * qz);
  const m12 = 2 * (qy * qz - qx * qw);
  const m20 = 2 * (qx * qz - qy * qw);
  const m21 = 2 * (qy * qz + qx * qw);
  const m22 = 1 - 2 * (qx * qx + qy * qy);
  return (
    `matrix3d(${m00.toFixed(4)},${m10.toFixed(4)},${m20.toFixed(4)},0,` +
    `${m01.toFixed(4)},${m11.toFixed(4)},${m21.toFixed(4)},0,` +
    `${m02.toFixed(4)},${m12.toFixed(4)},${m22.toFixed(4)},0,` +
    `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},1)`
  );
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function diceToShow(
  roll: DiceRoll,
  remaining: readonly Die[]
): Array<{ value: Die; used: boolean }> {
  if (roll[0] === roll[1]) {
    const total = 4;
    const used = total - remaining.length;
    return Array.from({ length: total }, (_, i) => ({
      value: roll[0],
      used: i < used,
    }));
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
function buildWorld(): { world: CANNON.World; body: CANNON.Body } {
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
  left.position.set(-SLOT_WALL_HALF, 0, 0);
  world.addBody(left);

  // Right wall: normal -x.
  const right = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  right.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2);
  right.position.set(SLOT_WALL_HALF, 0, 0);
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

/** Reset the body to a fresh "thrown from one side" toss. The cube
 *  enters the slot horizontally and the player can clearly see it
 *  travel across the felt before settling. */
function throwBody(body: CANNON.Body): void {
  // Pick a side to throw from. The cube starts just inside that wall.
  const startSide = Math.random() < 0.5 ? -1 : 1;
  body.position.set(
    startSide * (SLOT_WALL_HALF - CUBE_HALF - 4),
    (Math.random() - 0.5) * (WALL_HALF_Y - CUBE_HALF) * 1.2,
    SPAWN_Z + Math.random() * 25
  );
  // Velocity tuned so the slot traversal takes ~0.4 s — long enough for
  // the lateral motion to read clearly, short enough that the cube
  // still settles before the brute-force loop re-tries.
  body.velocity.set(
    -startSide * (170 + Math.random() * 100),
    (Math.random() - 0.5) * 130,
    -25 + Math.random() * 25
  );
  body.angularVelocity.set(
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20
  );
  body.quaternion.setFromEuler(
    Math.random() * 2 * Math.PI,
    Math.random() * 2 * Math.PI,
    Math.random() * 2 * Math.PI
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

function rollDie(desiredValue: Die): Frame[] {
  const { world, body } = buildWorld();
  let lastFrames: Frame[] = [];
  for (let attempt = 0; attempt < ATTEMPTS_PER_DIE; attempt++) {
    throwBody(body);
    const { frames, finalUpFace } = simulateThrow(world, body);
    lastFrames = frames;
    if (finalUpFace === desiredValue) return frames;
  }
  // If brute force failed, fall through with the last trajectory — the
  // settle slerp will rotate the cube to the correct face anyway.
  return lastFrames;
}

interface Props {
  turn: Player;
  roll: DiceRoll | null;
  remaining: readonly Die[];
  canRoll: boolean;
  canEndTurn: boolean;
  onRoll(): void;
  onEndTurn(): void;
}

export default function DiceTray({
  turn,
  roll,
  remaining,
  canRoll,
  canEndTurn,
  onRoll,
  onEndTurn,
}: Props) {
  const dice = useMemo(() => (roll ? diceToShow(roll, remaining) : []), [roll, remaining]);

  // Trajectories are deterministic given (roll, dice.length). We compute
  // them synchronously when the roll changes so the very first paint can
  // already show the cubes mid-flight (no flash from a default position).
  const trajectoriesRef = useRef<Frame[][]>([]);
  const lastRollRef = useRef<DiceRoll | null>(null);
  if (roll && lastRollRef.current !== roll) {
    trajectoriesRef.current = dice.map((d) => rollDie(d.value));
    lastRollRef.current = roll;
  } else if (!roll) {
    lastRollRef.current = null;
    trajectoriesRef.current = [];
  }
  const trajectories = trajectoriesRef.current;

  const dieRefs = useRef<Array<HTMLDivElement | null>>([]);
  const animRef = useRef<number | null>(null);

  if (dieRefs.current.length !== dice.length) {
    dieRefs.current = Array(dice.length).fill(null);
  }

  useEffect(() => {
    if (!roll || trajectories.length === 0) return;

    if (animRef.current) cancelAnimationFrame(animRef.current);

    const finalQuats: Quat[] = trajectories.map((t) => {
      const last = t[t.length - 1];
      return last ? { x: last.qx, y: last.qy, z: last.qz, w: last.qw } : { x: 0, y: 0, z: 0, w: 1 };
    });
    const finalPos: Vec3Lite[] = trajectories.map((t) => {
      const last = t[t.length - 1];
      return last ? { x: last.px, y: last.py, z: last.pz } : { x: 0, y: 0, z: 0 };
    });
    const targetQuats: Quat[] = dice.map((d, i) => pickYawedFaceFront(finalQuats[i], d.value));

    let phase: 'play' | 'settle' | 'hold' | 'center' | 'done' = 'play';
    const playStart = performance.now();
    let phaseStart = playStart;

    const writeRaw = (idx: number, f: Frame) => {
      const el = dieRefs.current[idx];
      if (!el) return;
      el.style.transform = quatToCSSMatrix(f.qx, f.qy, f.qz, f.qw, f.px, f.py, f.pz);
    };
    const writeQP = (idx: number, q: Quat, x: number, y: number, z: number) => {
      const el = dieRefs.current[idx];
      if (!el) return;
      el.style.transform = quatToCSSMatrix(q.x, q.y, q.z, q.w, x, y, z);
    };

    // Paint frame 0 immediately so the very first paint already shows the
    // throw start (no default-pose flicker).
    for (let i = 0; i < trajectories.length; i++) {
      const f = trajectories[i][0];
      if (f) writeRaw(i, f);
    }

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
        if (allDone) {
          phase = 'settle';
          phaseStart = nowTs;
        }
      } else if (phase === 'settle') {
        // Position is FROZEN at where the cube physics-stopped. Only
        // rotation tweens — slerp from physics-final to canonical
        // face-front, so the cube finishes rolling visibly in place
        // with the rolled number squarely toward the camera.
        const t = Math.min((nowTs - phaseStart) / SETTLE_MS, 1);
        const e = easeOutCubic(t);
        for (let i = 0; i < trajectories.length; i++) {
          const q = slerp(finalQuats[i], targetQuats[i], e);
          writeQP(i, q, finalPos[i].x, finalPos[i].y, finalPos[i].z);
        }
        if (t >= 1) {
          phase = 'hold';
          phaseStart = nowTs;
        }
      } else if (phase === 'hold') {
        // Static read-time at canonical orientation + physics-final
        // position — gives the player a beat to read the rolled value
        // before the cubes glide to the centre.
        if (nowTs - phaseStart >= HOLD_MS) {
          phase = 'center';
          phaseStart = nowTs;
        }
      } else if (phase === 'center') {
        // Position-only tween from physics-rest spot to slot centre.
        // Rotation stays at canonical — the rolled face stays visible
        // throughout the slide.
        const t = Math.min((nowTs - phaseStart) / CENTER_MS, 1);
        const e = easeOutCubic(t);
        for (let i = 0; i < trajectories.length; i++) {
          const x = finalPos[i].x * (1 - e);
          const y = finalPos[i].y * (1 - e);
          const z = finalPos[i].z * (1 - e);
          writeQP(i, targetQuats[i], x, y, z);
        }
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
    // We deliberately depend ONLY on `roll`. `trajectories` and `dice`
    // are recomputed when a checker is consumed (used flag flips), but the
    // throw should play exactly once per dice roll — not restart on every
    // move. Both are captured by closure from this render, which is the
    // same render that produced the trajectories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll]);

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        {roll === null ? (
          <button
            onClick={onRoll}
            disabled={!canRoll}
            className="pointer-events-auto px-7 py-3 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 font-display text-xl shadow-xl border-2 border-amber-700 hover:brightness-110 active:scale-95 transition disabled:opacity-50"
          >
            {turn === 'white' ? 'White' : 'Black'} — Roll
          </button>
        ) : (
          <>
            <div
              style={{
                position: 'relative',
                width: 600,
                height: 240,
                perspective: 1400,
                transformStyle: 'preserve-3d',
                pointerEvents: 'none',
              }}
            >
              {/* No parent tilt — the cube settles with the rolled face
                  perpendicular to the screen, so the player sees it flat-on.
                  Perspective on the wrapper above still gives 3D depth
                  (cubes at different z look different sizes during the
                  throw). */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  transformStyle: 'preserve-3d',
                }}
              >
                {dice.map((d, i) => {
                  const slotX = (i - (dice.length - 1) / 2) * SLOT_WIDTH;
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: DIE_SIZE,
                        height: DIE_SIZE,
                        marginLeft: -DIE_SIZE / 2 + slotX,
                        marginTop: -DIE_SIZE / 2,
                        transformStyle: 'preserve-3d',
                        transition: 'opacity 200ms ease',
                        opacity: d.used ? 0.45 : 1,
                      }}
                    >
                      <div
                        ref={(el) => {
                          dieRefs.current[i] = el;
                        }}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          transformStyle: 'preserve-3d',
                          willChange: 'transform',
                        }}
                      >
                        {([1, 2, 3, 4, 5, 6] as Die[]).map((face) => (
                          <Face
                            key={face}
                            face={face}
                            transform={FACE_TRANSFORMS[face]}
                            used={d.used}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {canEndTurn && (
              <button
                onClick={onEndTurn}
                className="pointer-events-auto px-5 py-2 rounded-md bg-amber-700/90 text-amber-50 font-medium shadow-md border border-amber-900 hover:brightness-110 active:scale-95 transition"
              >
                End turn
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
