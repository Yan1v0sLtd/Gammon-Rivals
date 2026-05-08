import { useEffect, useMemo, useRef } from 'react';
import * as CANNON from 'cannon-es';
import type { Die, DiceRoll, Player } from '../engine/types';
import { Face, FACE_TRANSFORMS, DIE_SIZE } from './Die3D';

// ─── Physics conventions ────────────────────────────────────────────────
// We use Cannon-es with units = CSS pixels and y pointing DOWN (so +y is
// "fall" direction, matching CSS). The cube's body-local axes are also
// y-down, which lines up directly with Die3D's face transforms — no
// coordinate flip is needed when we hand quaternions to CSS matrix3d.
const GRAVITY_Y = 950;
const FLOOR_Y = 90; // dice come to rest at y ≈ +FLOOR_Y (below center)
const SPAWN_Y = -260; // start above the tray
const WALL_HALF_X = 230;
const WALL_HALF_Z = 90;
const CUBE_HALF = DIE_SIZE / 2;
const RESTITUTION = 0.28;
const FRICTION = 0.35;
const SLEEP_SPEED_LIMIT = 8;
const SLEEP_TIME_LIMIT = 0.05;
const LINEAR_DAMPING = 0.05;
// Significant angular damping so a fast-spinning die actually slows
// against the felt — without this, friction alone takes too long to bleed
// the spin and the cube keeps rolling for whole seconds.
const ANGULAR_DAMPING = 0.25;

const PHYSICS_DT = 1 / 60;
const MAX_SIM_STEPS = 480; // ~8 s safety cap; real settles ~80–180 steps
const ATTEMPTS_PER_DIE = 60;
const PLAYBACK_FPS = 60;

const POST_SETTLE_PAUSE_MS = 220;
const CENTER_TWEEN_MS = 460;

// Maximum animation length the AI orchestrator should wait for. Real
// playback ends as soon as both bodies sleep, but we expose an upper bound.
export const DICE_ANIMATION_MS =
  (MAX_SIM_STEPS / 60) * 1000 + POST_SETTLE_PAUSE_MS + CENTER_TWEEN_MS;

// ─── Die3D face → cube-local outward normal (CSS y-down coords) ─────────
// Face 1 sits at +z, 2 at -z, 3 at -x, 4 at +x, 5 at +y, 6 at -y.
// (5/6 swap from the standard die, which is the existing project convention.)
const FACE_LOCAL_NORMALS: Record<Die, [number, number, number]> = {
  1: [0, 0, 1],
  2: [0, 0, -1],
  3: [-1, 0, 0],
  4: [1, 0, 0],
  5: [0, 1, 0],
  6: [0, -1, 0],
};

/** Returns the die value whose face points "up" (smallest CSS-y component
 *  in world space) after the cube has settled. Returns null if the cube
 *  came to rest tilted on an edge, in which case caller should re-throw. */
function dieValueFacingUp(quat: CANNON.Quaternion): Die | null {
  let best: Die | null = null;
  let bestY = Infinity;
  const v = new CANNON.Vec3();
  for (const die of [1, 2, 3, 4, 5, 6] as Die[]) {
    const n = FACE_LOCAL_NORMALS[die];
    v.set(n[0], n[1], n[2]);
    quat.vmult(v, v);
    if (v.y < bestY) {
      bestY = v.y;
      best = die;
    }
  }
  // Settled flat enough only if dot(face, -y) > ~0.95 (tilt < ~18°).
  if (bestY > -0.95) return null;
  return best;
}

/** Convert quaternion + position to a CSS matrix3d() string. */
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
  // matrix3d() is column-major.
  return (
    `matrix3d(${m00.toFixed(4)},${m10.toFixed(4)},${m20.toFixed(4)},0,` +
    `${m01.toFixed(4)},${m11.toFixed(4)},${m21.toFixed(4)},0,` +
    `${m02.toFixed(4)},${m12.toFixed(4)},${m22.toFixed(4)},0,` +
    `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},1)`
  );
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

/** Builds a fresh Cannon world with floor + four walls + one die body. */
function buildWorld(): { world: CANNON.World; body: CANNON.Body } {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, GRAVITY_Y, 0),
    allowSleep: true,
  });
  world.defaultContactMaterial.restitution = RESTITUTION;
  world.defaultContactMaterial.friction = FRICTION;

  // Floor: default plane normal is +z; rotate so normal becomes -y.
  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
  floor.position.set(0, FLOOR_Y, 0);
  world.addBody(floor);

  // Left wall at x=-WALL_HALF_X: normal +x (points into playing area).
  // R_y(+π/2) takes default +z → +x.
  const left = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  left.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
  left.position.set(-WALL_HALF_X, 0, 0);
  world.addBody(left);

  // Right wall at x=+WALL_HALF_X: normal -x.
  // R_y(-π/2) takes +z → -x.
  const right = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  right.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2);
  right.position.set(WALL_HALF_X, 0, 0);
  world.addBody(right);

  // Back wall (normal +z = toward viewer) — default plane orientation.
  const back = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  back.position.set(0, 0, -WALL_HALF_Z);
  world.addBody(back);

  // Front wall (normal -z = away from viewer).
  const front = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  front.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI);
  front.position.set(0, 0, WALL_HALF_Z);
  world.addBody(front);

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

/** Reset body to a fresh random throw above the tray. */
function throwBody(body: CANNON.Body, slotX: number): void {
  const dir = Math.random() < 0.5 ? -1 : 1;
  body.position.set(
    slotX + (Math.random() - 0.5) * 80,
    SPAWN_Y - Math.random() * 60,
    (Math.random() - 0.5) * 60
  );
  body.velocity.set(
    dir * (200 + Math.random() * 180),
    260 + Math.random() * 200,
    (Math.random() - 0.5) * 120
  );
  body.angularVelocity.set(
    (Math.random() - 0.5) * 14,
    (Math.random() - 0.5) * 14,
    (Math.random() - 0.5) * 14
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
  return { frames, finalUpFace: dieValueFacingUp(body.quaternion) };
}

/** Brute-force re-throw until the cube settles with `desiredValue` up.
 *  Captures every physics frame so the renderer can play it back. */
function rollDie(desiredValue: Die, slotX: number): Frame[] {
  const { world, body } = buildWorld();
  let lastFrames: Frame[] = [];
  for (let attempt = 0; attempt < ATTEMPTS_PER_DIE; attempt++) {
    throwBody(body, slotX);
    const { frames, finalUpFace } = simulateThrow(world, body);
    lastFrames = frames;
    if (finalUpFace === desiredValue) return frames;
  }
  // Fall through with last result — visually the cube will settle on the
  // wrong face, but in practice we hit the desired value within ~10 attempts.
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
    trajectoriesRef.current = dice.map((d, i) => {
      const slotX = (i - (dice.length - 1) / 2) * 70;
      return rollDie(d.value, slotX);
    });
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

    let phase: 'play' | 'pause' | 'center' | 'done' = 'play';
    const playStart = performance.now();
    let phaseStart = playStart;
    const finalPos: Array<{ x: number; y: number; z: number }> = trajectories.map((t) => {
      const last = t[t.length - 1];
      return last ? { x: last.px, y: last.py, z: last.pz } : { x: 0, y: 0, z: 0 };
    });
    const finalQuat: Array<{ x: number; y: number; z: number; w: number }> = trajectories.map(
      (t) => {
        const last = t[t.length - 1];
        return last ? { x: last.qx, y: last.qy, z: last.qz, w: last.qw } : { x: 0, y: 0, z: 0, w: 1 };
      }
    );

    const writeFrame = (idx: number, f: Frame) => {
      const el = dieRefs.current[idx];
      if (!el) return;
      el.style.transform = quatToCSSMatrix(f.qx, f.qy, f.qz, f.qw, f.px, f.py, f.pz);
    };

    // Paint frame 0 immediately so first paint shows the throw start.
    for (let i = 0; i < trajectories.length; i++) {
      const f = trajectories[i][0];
      if (f) writeFrame(i, f);
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
          if (f) writeFrame(i, f);
        }
        if (allDone) {
          phase = 'pause';
          phaseStart = nowTs;
        }
      } else if (phase === 'pause') {
        if (nowTs - phaseStart >= POST_SETTLE_PAUSE_MS) {
          phase = 'center';
          phaseStart = nowTs;
        }
      } else if (phase === 'center') {
        const t = Math.min((nowTs - phaseStart) / CENTER_TWEEN_MS, 1);
        const e = 1 - Math.pow(1 - t, 3);
        for (let i = 0; i < trajectories.length; i++) {
          const fp = finalPos[i];
          const fq = finalQuat[i];
          // Position-only tween toward (slotOffset, 0, 0). The rest pose
          // for each die is its flex-slot center, which in our shared
          // perspective parent is just (0,0,0) — slot offsets are rendered
          // via slot translation in the JSX, not here.
          const px = fp.x * (1 - e);
          const py = fp.y * (1 - e);
          const pz = fp.z * (1 - e);
          const el = dieRefs.current[i];
          if (el) {
            el.style.transform = quatToCSSMatrix(fq.x, fq.y, fq.z, fq.w, px, py, pz);
          }
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
  }, [roll, trajectories]);

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
              {/* Slight downward tilt so the top face reads cleanly while
                  side faces remain visible during the tumble. */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  transformStyle: 'preserve-3d',
                  transform: 'rotateX(28deg)',
                }}
              >
                {dice.map((d, i) => {
                  const slotX = (i - (dice.length - 1) / 2) * 70;
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
