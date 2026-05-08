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
  // World position in pixels, relative to the dice's natural flex slot.
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Rotation in degrees + angular velocity in deg/sec.
  rx: number;
  ry: number;
  rz: number;
  avx: number;
  avy: number;
  avz: number;
  sleeping: boolean;
  // Captured at sleep so the centering phase can tween from settled pose.
  tweenStartX: number;
  tweenStartY: number;
  tweenStartRX: number;
  tweenStartRY: number;
  tweenStartRZ: number;
}

const GRAVITY = 2400; // px/s²
const FLOOR_Y = 30; // resting height — slightly below natural flex baseline
const WALL_HALF = 220; // ±220 px from center (clamps so dice stay on the board)
const RESTITUTION = 0.45; // floor bounce energy retention
const WALL_RESTITUTION = 0.6;
const FLOOR_FRICTION = 0.8;
const ANG_DAMP = 0.55;
const SLEEP_LIN = 18; // |v| threshold below which we count a die as "near rest"
const SLEEP_ANG = 60; // deg/s
const SLEEP_HOLD_FRAMES = 6; // require N consecutive low-energy frames to sleep
// Pause phase: tween rotation to the rolled face (so dice show the right value
// BEFORE the centering phase moves them) and then hold for a short moment so
// the random landing reads visually before the center tween starts.
const PAUSE_ROT_TWEEN_MS = 240;
const PAUSE_HOLD_MS = 140;
const POST_SETTLE_PAUSE_MS = PAUSE_ROT_TWEEN_MS + PAUSE_HOLD_MS;
const CENTER_TWEEN_MS = 460;
// Total throw + pause + center, exposed so callers (e.g. AI orchestrator)
// can wait for the full visual to play out before the next action.
export const DICE_ANIMATION_MS = 1500 + POST_SETTLE_PAUSE_MS + CENTER_TWEEN_MS;

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

function makeInitialBody(value: Die, index: number, count: number): DieBody {
  // Spread initial X across a wide arc above the board so dice come from
  // visibly different places.
  const slotOffset = (index - (count - 1) / 2) * 80; // separates dice horizontally at rest
  const startX = slotOffset + rand(-160, 160);
  const startY = -rand(180, 240); // above the board
  const dir = Math.random() < 0.5 ? -1 : 1;
  return {
    value,
    x: startX,
    y: startY,
    vx: rand(80, 220) * (slotOffset >= 0 ? -1 : 1) * (Math.random() < 0.7 ? 1 : -1),
    vy: rand(40, 160), // initial downward push
    rx: rand(-60, 60),
    ry: rand(-60, 60),
    rz: rand(-45, 45),
    avx: dir * rand(700, 1500),
    avy: -dir * rand(700, 1500),
    avz: rand(-360, 360),
    sleeping: false,
    tweenStartX: 0,
    tweenStartY: 0,
    tweenStartRX: 0,
    tweenStartRY: 0,
    tweenStartRZ: 0,
  };
}

function stepPhysics(body: DieBody, dt: number): void {
  if (body.sleeping) return;

  body.vy += GRAVITY * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.rx += body.avx * dt;
  body.ry += body.avy * dt;
  body.rz += body.avz * dt;

  // Floor collision (y is screen-down; floor is at +FLOOR_Y from rest baseline)
  if (body.y >= FLOOR_Y) {
    body.y = FLOOR_Y;
    if (body.vy > 0) {
      body.vy = -body.vy * RESTITUTION;
      body.vx *= FLOOR_FRICTION;
      body.avx *= ANG_DAMP;
      body.avy *= ANG_DAMP;
      body.avz *= ANG_DAMP;
    }
  }

  // Wall collisions (left/right of the natural slot center)
  // Each die's slot already has an X offset baked in via slotOffset; treat
  // walls relative to the absolute display.
  if (body.x < -WALL_HALF) {
    body.x = -WALL_HALF;
    body.vx = -body.vx * WALL_RESTITUTION;
  } else if (body.x > WALL_HALF) {
    body.x = WALL_HALF;
    body.vx = -body.vx * WALL_RESTITUTION;
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
    let phaseStart = performance.now();
    let lowEnergyFrames = 0;
    let last = performance.now();

    const step = (nowTs: number) => {
      const dtRaw = (nowTs - last) / 1000;
      last = nowTs;
      // Cap dt so a tab refocus doesn't make dice teleport
      const dt = Math.min(dtRaw, 1 / 30);

      const bodies = bodiesRef.current;

      if (phase === 'throw') {
        for (const b of bodies) stepPhysics(b, dt);

        const lowEnergy = bodies.every(
          (b) =>
            b.y >= FLOOR_Y - 1 &&
            Math.abs(b.vx) < SLEEP_LIN &&
            Math.abs(b.vy) < SLEEP_LIN &&
            Math.abs(b.avx) < SLEEP_ANG &&
            Math.abs(b.avy) < SLEEP_ANG &&
            Math.abs(b.avz) < SLEEP_ANG
        );
        if (lowEnergy) lowEnergyFrames++;
        else lowEnergyFrames = 0;

        if (lowEnergyFrames >= SLEEP_HOLD_FRAMES || nowTs - phaseStart > 3500) {
          for (const b of bodies) {
            b.sleeping = true;
            b.vx = 0;
            b.vy = 0;
            b.avx = 0;
            b.avy = 0;
            b.avz = 0;
            // Capture current pose for the centering tween
            b.tweenStartX = b.x;
            b.tweenStartY = b.y;
            b.tweenStartRX = b.rx;
            b.tweenStartRY = b.ry;
            b.tweenStartRZ = b.rz;
          }
          phase = 'pause';
          phaseStart = nowTs;
        }
      } else if (phase === 'pause') {
        const tElapsed = nowTs - phaseStart;
        // Rotate to the rolled face during the first part of the pause so
        // the cube shows the correct value BEFORE the centering tween.
        const rotT = Math.min(tElapsed / PAUSE_ROT_TWEEN_MS, 1);
        const rotE = easeOutCubic(rotT);
        for (const b of bodies) {
          const tgt = FACE_TARGET_ROTATION[b.value];
          const tgtRX = nearestEquivalentAngle(b.tweenStartRX, tgt.x);
          const tgtRY = nearestEquivalentAngle(b.tweenStartRY, tgt.y);
          const tgtRZ = nearestEquivalentAngle(b.tweenStartRZ, 0);
          b.rx = b.tweenStartRX + (tgtRX - b.tweenStartRX) * rotE;
          b.ry = b.tweenStartRY + (tgtRY - b.tweenStartRY) * rotE;
          b.rz = b.tweenStartRZ + (tgtRZ - b.tweenStartRZ) * rotE;
          // Position stays at landing during pause.
        }
        if (tElapsed >= POST_SETTLE_PAUSE_MS) {
          phase = 'center';
          phaseStart = nowTs;
          // Capture for the position-only centering tween.
          for (const b of bodies) {
            b.tweenStartX = b.x;
            b.tweenStartY = b.y;
            // Rotation already at target; lock in tweenStartR* so any further
            // small drift doesn't accumulate.
            const tgt = FACE_TARGET_ROTATION[b.value];
            b.rx = nearestEquivalentAngle(b.rx, tgt.x);
            b.ry = nearestEquivalentAngle(b.ry, tgt.y);
            b.rz = nearestEquivalentAngle(b.rz, 0);
          }
        }
      } else if (phase === 'center') {
        const t = Math.min((nowTs - phaseStart) / CENTER_TWEEN_MS, 1);
        const e = easeOutCubic(t);
        for (const b of bodies) {
          // Position-only tween. Rotation already matches the rolled face.
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
