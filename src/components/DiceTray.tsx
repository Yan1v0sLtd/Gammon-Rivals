import { useEffect, useMemo, useRef } from 'react';
import type { Die, DiceRoll } from '../engine/types';

/**
 * DiceTray — lightweight CSS-3D dice.
 *
 * Replaces the previous Three.js + Cannon-es physics-based renderer.
 * The old renderer created a fresh WebGL context per dice roll, never
 * released them properly, and after ~16 rolls the browser killed the
 * oldest live context — which was the Pixi board canvas. Board went
 * white mid-match. CSS 3D transforms run on the compositor / GPU
 * without consuming a WebGL context slot, so this can roll forever
 * without ever hitting the cap.
 *
 * Visual + interaction notes:
 *  - Two static dice per roll (doubles still render as 2 dice; the
 *    `remaining` array determines which are greyed out — same UX as
 *    the prior tray).
 *  - Positioned on the side of the board belonging to the player
 *    whose turn it is (`settleSide` prop).
 *  - Tumble animation runs for ROLL_ANIMATION_MS, then the cube
 *    settles on the face matching the rolled value.
 *
 * Critical CSS gotcha (learned the hard way): any one of `filter`,
 * `overflow:hidden`, `mix-blend-mode`, etc. on an ancestor forces
 * the cube to `transform-style: flat`, collapsing the 6 faces onto
 * one z-plane. When that happens, a die that should rotate to e.g.
 * `rotateX(90deg)` becomes edge-on and visually invisible. So no
 * such properties on `.css-dice-tray`, `.css-dice-cube`, or
 * `.css-dice-die`. See src/index.css for the working layout.
 */
interface Props {
  readonly roll: DiceRoll | null;
  readonly remaining: readonly Die[];
  readonly settleSide?: 'left' | 'right';
  readonly placement?: 'board' | 'hud';
}

/**
 * Per-face rotations. The cube has six face divs positioned at
 * ±50px along each axis (front/back/top/bottom/right/left, all in
 * src/index.css). To make face N face the camera, rotate the cube
 * so that face's outward normal aligns with +Z (toward the viewer).
 *
 * Pip mapping (matches the per-face CSS in src/index.css):
 *   .front  → 1 pip (red)
 *   .back   → 6 pips
 *   .top    → 2 pips  ← CSS y-down: ".top" is actually -Y face
 *   .bottom → 5 pips
 *   .right  → 4 pips
 *   .left   → 3 pips
 */
const FACE_ROTATION: Record<Die, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(90deg)',
  4: 'rotateX(0deg) rotateY(-90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(180deg) rotateY(0deg)',
};

/** Native cube size before scaling. The reference CSS pip math is
 *  calibrated for this dimension; do NOT change without also
 *  rewriting all the box-shadow offsets in src/index.css. */
const NATIVE_DICE_PX = 100;

/** Visible cube size on screen. The CSS scales the 100px native
 *  cube down to this via `transform: scale(...)`. Keep in sync
 *  with the .css-dice-cube wrapper width/height in index.css. */
const TARGET_DICE_PX = 65;
const TARGET_DICE_PX_MOBILE = 50;

/** Composite the visible scale + the face rotation into a single
 *  transform value. The order matters: scale FIRST, then rotate,
 *  so the rotation happens around the (pre-scaled) cube's centre
 *  in the cube's local space. transform-origin in the CSS is set
 *  to 0 0 so the scaled cube anchors to the wrapper's top-left
 *  corner and the wrapper's width matches the visible dice size. */
function buildTransform(value: Die, scale: number): string {
  return `scale(${scale}) ${FACE_ROTATION[value]}`;
}

/** Duration of the tumble keyframe. After this elapses, JS sets
 *  the cube's inline transform to the final face so it settles
 *  motionless on the rolled value. 1s feels game-y — not so long
 *  that it slows turn pacing, not so short that the player misses
 *  the satisfaction of seeing the dice tumble. */
const ROLL_ANIMATION_MS = 1000;

/**
 * Mirror of the prior tray's diceToShow helper. Decides which two
 * dice to render and whether each is greyed out.
 */
function diceToShow(
  roll: DiceRoll,
  remaining: readonly Die[]
): Array<{ readonly value: Die; readonly used: boolean }> {
  if (roll[0] === roll[1]) {
    // Doubles grant FOUR moves but we still render only TWO dice
    // (real backgammon — the player knows doubles means ×2). The
    // dice grey out progressively to indicate how many of the four
    // moves remain:
    //   0–1 moves used → both fresh
    //   2–3 moves used → one die greyed
    //   4   moves used → both greyed
    const used = 4 - remaining.length;
    return [
      { value: roll[0], used: used >= 2 },
      { value: roll[0], used: used >= 4 },
    ];
  }
  // Non-doubles: each die is "used" once its value has been consumed
  // from `remaining`. We walk the roll and pop matches from a copy
  // so a single roll of e.g. [3, 3] in `remaining` correctly marks
  // both dice with the same value if duplicates appear (shouldn't
  // for non-doubles, but defensive).
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

export default function DiceTray({ roll, remaining, settleSide = 'right' }: Props) {
  // No roll → no tray. Avoid mounting any DOM at all so the layout
  // doesn't reserve space for an empty tray between rolls.
  const dice = useMemo(() => (roll ? diceToShow(roll, remaining) : []), [roll, remaining]);
  if (!roll || dice.length === 0) return null;

  // Stable id per roll so each CssDie's useEffect knows when to
  // re-trigger the tumble. The remaining-count component restarts
  // the brief settle when a die transitions from fresh to used too.
  const rollId = `${roll[0]}-${roll[1]}-${remaining.length}`;

  return (
    <div className={`css-dice-tray css-dice-tray--${settleSide}`} aria-hidden>
      {dice.map((d, i) => (
        <CssDie
          // The index-based key is stable across re-renders of the
          // same roll; the rollId prop drives re-animation inside
          // the component instead.
          key={i}
          value={d.value}
          used={d.used}
          rollId={`${rollId}-${i}`}
        />
      ))}
    </div>
  );
}

/**
 * Single CSS 3D die. Renders six face divs inside a cube wrapper.
 * The cube is scaled+rotated via inline transform; the inline
 * transform is composed of a scale factor (constant per breakpoint)
 * and a face rotation (per rolled value).
 *
 * Animation pattern (mirrors the reference snippet the user gave):
 *   1. Effect fires whenever rollId or value changes.
 *   2. Clear the inline transform briefly so the keyframe animation
 *      can interpolate from rotateX(0)/rotateY(0) cleanly.
 *   3. Re-apply the `css-dice-roll` keyframe (1s tumble).
 *   4. After ROLL_ANIMATION_MS + buffer, set the inline transform
 *      to scale+final-face. The cube snaps to its settled pose.
 */
function CssDie({
  value,
  used,
  rollId,
}: {
  readonly value: Die;
  readonly used: boolean;
  readonly rollId: string;
}) {
  const dieRef = useRef<HTMLDivElement>(null);
  // Pick the scale based on viewport width once per render. Using
  // matchMedia here (rather than relying on a CSS @media override
  // for the JS-set inline transform) keeps the per-roll inline
  // style in sync with the CSS wrapper sizing. The CSS @media on
  // .css-dice-die only applies BEFORE JS overrides via inline
  // style; we have to compute the same value in JS to match.
  const scale =
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches
      ? TARGET_DICE_PX_MOBILE / NATIVE_DICE_PX
      : TARGET_DICE_PX / NATIVE_DICE_PX;

  const settledTransform = buildTransform(value, scale);

  useEffect(() => {
    const el = dieRef.current;
    if (!el) return;

    // Clear any prior settled transform + animation so the keyframe
    // re-runs from scratch on every roll. Without the reflow, rapid
    // consecutive rolls (user rolls → AI rolls → user rolls) would
    // sometimes skip the tumble because the browser sees identical
    // animation property and short-circuits.
    el.style.animation = 'none';
    el.style.transform = `scale(${scale})`;
    void el.offsetHeight; // force reflow
    el.style.animation = `css-dice-roll ${ROLL_ANIMATION_MS}ms ease-out`;

    // Settle a beat AFTER the animation completes (the +50ms buffer
    // is from the reference snippet; ensures the keyframe is fully
    // done before we clear it and apply the inline final pose).
    const timer = window.setTimeout(() => {
      const live = dieRef.current;
      if (!live) return;
      live.style.transform = settledTransform;
      live.style.animation = 'none';
    }, ROLL_ANIMATION_MS + 50);

    return () => {
      window.clearTimeout(timer);
    };
  }, [rollId, scale, settledTransform]);

  return (
    <div className="css-dice-cube">
      <div
        ref={dieRef}
        className={`css-dice-die${used ? ' css-dice-die--used' : ''}`}
      >
        <div className="css-dice-face css-dice-face--front" />
        <div className="css-dice-face css-dice-face--back" />
        <div className="css-dice-face css-dice-face--top" />
        <div className="css-dice-face css-dice-face--bottom" />
        <div className="css-dice-face css-dice-face--right" />
        <div className="css-dice-face css-dice-face--left" />
      </div>
    </div>
  );
}
