import { useEffect, useMemo, useRef } from 'react';
import type { Die, DiceRoll, Player } from '../engine/types';
import Die3D, { FACE_TARGET_ROTATION } from './Die3D';

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

interface DieBody {
  value: Die;
  // Position physics — kinematic, real bouncing.
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Rotation is a deterministic tween that finishes BEFORE first floor
  // contact (and snaps to the target on first contact regardless), so
  // every die lands face-up on its rolled value.
  rx: number;
  ry: number;
  rz: number;
  rotStartRX: number;
  rotStartRY: number;
  rotStartRZ: number;
  rotEndRX: number;
  rotEndRY: number;
  rotEndRZ: number;
  rotComplete: boolean;
  firstFloorContact: boolean;
  sleeping: boolean;
  tweenStartX: number;
  tweenStartY: number;
}

const GRAVITY = 2400; // px/s²
const FLOOR_Y = 30; // resting height — slightly below natural flex baseline
const WALL_HALF = 220; // ±220 px from center
const RESTITUTION = 0.45; // floor bounce energy retention
const WALL_RESTITUTION = 0.6;
const FLOOR_FRICTION = 0.8;
const SLEEP_LIN = 18; // |v| threshold below which a die is "near rest"
const SLEEP_HOLD_FRAMES = 5; // consecutive low-energy frames to settle

// Rotation tween: short enough to be ~100% complete by the time the die
// first contacts the floor (~300 ms with the gravity below). easeOutQuart
// front-loads the tumble so the cube spins fast initially and decelerates
// hard onto the rolled face.
const ROT_TWEEN_MS = 380;

const POST_SETTLE_PAUSE_MS = 220; // brief hold AFTER everything has settled
const CENTER_TWEEN_MS = 460;
const THROW_HARD_TIMEOUT_MS = 2200;

// Total throw (capped) + pause + center — exposed so callers (e.g. the AI
// orchestrator) can wait for the full visual to play out.
export const DICE_ANIMATION_MS = 1700 + POST_SETTLE_PAUSE_MS + CENTER_TWEEN_MS;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function nearestEquivalentAngle(current: number, target: number): number {
  const diff = (((target - current) % 360) + 540) % 360 - 180;
  return current + diff;
}

function transformOf(b: DieBody): string {
  return `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0) rotateX(${b.rx.toFixed(1)}deg) rotateY(${b.ry.toFixed(1)}deg) rotateZ(${b.rz.toFixed(1)}deg)`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function makeInitialBody(value: Die, index: number, count: number): DieBody {
  // Spread initial X across a wide arc above the board.
  const slotOffset = (index - (count - 1) / 2) * 80;
  const startX = slotOffset + rand(-160, 160);
  const startY = -rand(180, 240);

  // Pre-compute the full rotation. Random direction per axis + 2 full
  // revolutions, ending exactly on the rolled-face target.
  const dirX = Math.random() < 0.5 ? -1 : 1;
  const dirY = Math.random() < 0.5 ? -1 : 1;
  const dirZ = Math.random() < 0.5 ? -1 : 1;
  const spins = 2;
  const rotStartRX = rand(-30, 30);
  const rotStartRY = rand(-30, 30);
  const rotStartRZ = rand(-15, 15);
  const tgt = FACE_TARGET_ROTATION[value];
  const rotEndRX = nearestEquivalentAngle(rotStartRX + dirX * spins * 360, tgt.x);
  const rotEndRY = nearestEquivalentAngle(rotStartRY + dirY * spins * 360, tgt.y);
  const rotEndRZ = nearestEquivalentAngle(rotStartRZ + dirZ * spins * 360, 0);

  return {
    value,
    x: startX,
    y: startY,
    vx: rand(80, 220) * (Math.random() < 0.5 ? -1 : 1),
    // Initial vy kept small so the rotation tween finishes before first land.
    vy: rand(20, 80),
    rx: rotStartRX,
    ry: rotStartRY,
    rz: rotStartRZ,
    rotStartRX,
    rotStartRY,
    rotStartRZ,
    rotEndRX,
    rotEndRY,
    rotEndRZ,
    rotComplete: false,
    firstFloorContact: false,
    sleeping: false,
    tweenStartX: 0,
    tweenStartY: 0,
  };
}

/** Position physics only — gravity, bounces, friction. Marks firstFloorContact
 *  on the first frame the die touches the floor so the rotation tween can
 *  snap to target. */
function stepPositionPhysics(body: DieBody, dt: number): void {
  if (body.sleeping) return;

  body.vy += GRAVITY * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  if (body.y >= FLOOR_Y) {
    body.y = FLOOR_Y;
    if (!body.firstFloorContact) {
      body.firstFloorContact = true;
    }
    if (body.vy > 0) {
      body.vy = -body.vy * RESTITUTION;
      body.vx *= FLOOR_FRICTION;
    }
  }

  if (body.x < -WALL_HALF) {
    body.x = -WALL_HALF;
    body.vx = -body.vx * WALL_RESTITUTION;
  } else if (body.x > WALL_HALF) {
    body.x = WALL_HALF;
    body.vx = -body.vx * WALL_RESTITUTION;
  }
}

/** Rotation tween — runs in parallel with position physics. easeOutQuart
 *  front-loads so by t≈0.5 the cube is ~94% rotated. We force the rotation
 *  to its exact target on the first floor contact (typical at ~300ms when
 *  the tween is already past 99%), so every die lands face-up on its
 *  rolled value. */
function updateRotationTween(body: DieBody, throwElapsedMs: number): void {
  if (body.rotComplete || body.sleeping) return;

  if (body.firstFloorContact) {
    body.rx = body.rotEndRX;
    body.ry = body.rotEndRY;
    body.rz = body.rotEndRZ;
    body.rotComplete = true;
    return;
  }

  const t = Math.min(throwElapsedMs / ROT_TWEEN_MS, 1);
  const e = easeOutQuart(t);
  body.rx = body.rotStartRX + (body.rotEndRX - body.rotStartRX) * e;
  body.ry = body.rotStartRY + (body.rotEndRY - body.rotStartRY) * e;
  body.rz = body.rotStartRZ + (body.rotEndRZ - body.rotStartRZ) * e;
  if (t >= 1) {
    body.rotComplete = true;
  }
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

  const dieRefs = useRef<Array<HTMLDivElement | null>>([]);
  const bodiesRef = useRef<DieBody[]>([]);
  const lastRollRef = useRef<DiceRoll | null>(null);
  const animRef = useRef<number | null>(null);
  const animatingRef = useRef(false);

  // Reset refs when dice count changes
  if (dieRefs.current.length !== dice.length) {
    dieRefs.current = Array(dice.length).fill(null);
  }

  // Kick off a fresh throw whenever the underlying roll changes.
  useEffect(() => {
    if (!roll) {
      lastRollRef.current = null;
      return;
    }
    if (lastRollRef.current === roll) return; // already animated this roll
    lastRollRef.current = roll;

    // Initialize physics bodies
    bodiesRef.current = dice.map((d, i) => makeInitialBody(d.value, i, dice.length));
    // Apply slot offsets so each die's "rest position" aligns to its flex slot
    // — the parent flex container handles natural spacing, so we just need
    // the cube's local translate to be (0,0) at rest. Slot offset only affects
    // the start position via makeInitialBody.

    if (animatingRef.current && animRef.current) cancelAnimationFrame(animRef.current);
    animatingRef.current = true;

    let phase: 'throw' | 'pause' | 'center' | 'done' = 'throw';
    let throwStart = performance.now();
    let phaseStart = throwStart;
    let lowEnergyFrames = 0;
    let last = throwStart;

    const step = (nowTs: number) => {
      const dtRaw = (nowTs - last) / 1000;
      last = nowTs;
      const dt = Math.min(dtRaw, 1 / 30);

      const bodies = bodiesRef.current;

      if (phase === 'throw') {
        const throwElapsed = nowTs - throwStart;
        for (const b of bodies) {
          stepPositionPhysics(b, dt);
          updateRotationTween(b, throwElapsed);
        }

        const rotDone = throwElapsed >= ROT_TWEEN_MS;
        const allPosResting = bodies.every(
          (b) =>
            b.y >= FLOOR_Y - 1 &&
            Math.abs(b.vx) < SLEEP_LIN &&
            Math.abs(b.vy) < SLEEP_LIN
        );
        if (rotDone && allPosResting) lowEnergyFrames++;
        else lowEnergyFrames = 0;

        if (lowEnergyFrames >= SLEEP_HOLD_FRAMES || throwElapsed > THROW_HARD_TIMEOUT_MS) {
          for (const b of bodies) {
            // Snap exactly to the target rotation in case of float drift.
            b.rx = b.rotEndRX;
            b.ry = b.rotEndRY;
            b.rz = b.rotEndRZ;
            b.vx = 0;
            b.vy = 0;
            b.sleeping = true;
            b.tweenStartX = b.x;
            b.tweenStartY = b.y;
          }
          phase = 'pause';
          phaseStart = nowTs;
        }
      } else if (phase === 'pause') {
        // Rotation already at target; just hold so the random landing reads.
        if (nowTs - phaseStart >= POST_SETTLE_PAUSE_MS) {
          phase = 'center';
          phaseStart = nowTs;
        }
      } else if (phase === 'center') {
        const t = Math.min((nowTs - phaseStart) / CENTER_TWEEN_MS, 1);
        const e = easeOutCubic(t);
        for (const b of bodies) {
          // Position-only tween. Rotation stays exactly at target.
          b.x = b.tweenStartX * (1 - e);
          b.y = b.tweenStartY * (1 - e);
        }
        if (t >= 1) {
          phase = 'done';
        }
      }

      // Write transforms to DOM
      for (let i = 0; i < bodies.length; i++) {
        const el = dieRefs.current[i];
        if (el) el.style.transform = transformOf(bodies[i]!);
      }

      if (phase !== 'done') {
        animRef.current = requestAnimationFrame(step);
      } else {
        animatingRef.current = false;
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animatingRef.current = false;
    };
  }, [roll, dice]);

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
            <div className="flex gap-3 pointer-events-none">
              {dice.map((d, i) => (
                <Die3D
                  key={i}
                  ref={(el) => {
                    dieRefs.current[i] = el;
                  }}
                  value={d.value}
                  used={d.used}
                />
              ))}
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
