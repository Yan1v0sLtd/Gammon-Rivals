import { useEffect, useMemo, useRef } from 'react';
import type { Die, DiceRoll } from '../engine/types';

/**
 * DiceTray — lightweight CSS-3D dice.
 *
 * Replaces the previous Three.js + Cannon-es physics-based renderer.
 * The old renderer created a fresh WebGL context per dice roll
 * (init effect deps `[diceCount, rollKey]`) and never called
 * forceContextLoss(), so after ~16 rolls the browser hit its
 * per-page WebGL context cap and killed the OLDEST live context —
 * which turned out to be the Pixi board canvas. Board went white
 * mid-match.
 *
 * The fix is to stop creating WebGL contexts for the dice at all.
 * CSS 3D transforms with `transform-style: preserve-3d` run on the
 * compositor / GPU without consuming a WebGL context slot, so we can
 * roll forever without ever hitting the cap.
 *
 * Visual + interaction notes:
 *  - Two static dice per roll (doubles still render as 2 dice; the
 *    "remaining" array determines which are greyed out — same UX as
 *    the prior tray).
 *  - Positioned on the side of the board belonging to the player
 *    whose turn it is (`settleSide` prop). `left` for opponent (when
 *    it's their roll), `right` for the local player.
 *  - The "rolling" animation tumbles the cube for 1s, then we snap
 *    the transform to the face matching the rolled value — same
 *    pattern as the reference snippet the user supplied.
 *
 * The `placement` prop is preserved for callsite compatibility but
 * not used in this implementation (the old renderer used it to
 * choose between board-side and HUD-side settle; we always settle
 * board-side here).
 */
interface Props {
  readonly roll: DiceRoll | null;
  readonly remaining: readonly Die[];
  readonly settleSide?: 'left' | 'right';
  readonly placement?: 'board' | 'hud';
}

/**
 * Final-rotation transform per face. Derived from how the cube's six
 * face divs are placed in CSS:
 *   .front  = +Z  (face value 1)
 *   .back   = -Z  (face value 6)
 *   .top    = -Y  (face value 2) — CSS Y is down-positive
 *   .bottom = +Y  (face value 5)
 *   .right  = +X  (face value 4)
 *   .left   = -X  (face value 3)
 * To make face N face the camera, rotate the cube so that face's
 * outward normal aligns with +Z.
 */
const FACE_TRANSFORM: Record<Die, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(90deg)',
  4: 'rotateX(0deg) rotateY(-90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(180deg) rotateY(0deg)',
};

/** How long the tumble animation lasts before the dice snap to their
 *  final face. The reference snippet used 4s; that's too long for
 *  the game's pacing — 1s lands the dice quickly enough that the
 *  player can act, while still feeling like a real roll. */
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
  // re-trigger the tumble. We include both values (so different
  // rolls re-animate) AND a "tick" derived from the remaining count
  // (so the dim/used state changes also restart the brief settle).
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
 * Single CSS 3D die. Renders six face divs; the parent cube is
 * rotated to show the face matching `value`.
 *
 * Animation pattern (mirrors the reference snippet):
 *   1. Effect fires on every new `rollId`.
 *   2. Apply the `css-dice-roll` keyframe animation for
 *      ROLL_ANIMATION_MS — cube tumbles.
 *   3. When the animation finishes (setTimeout), set inline
 *      transform to the final face and clear the animation property
 *      so the cube settles motionless.
 *
 * Why useEffect + inline style instead of class-toggle: we need a
 * fresh animation on every roll, and CSS animations don't restart
 * if the class+keyframe combo is identical. Clearing the animation
 * property between rolls reliably restarts it.
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
  const finalTransform = FACE_TRANSFORM[value];

  useEffect(() => {
    const el = dieRef.current;
    if (!el) return;

    // Reset any prior settled transform + animation so the keyframe
    // re-runs from scratch.
    el.style.animation = 'none';
    el.style.transform = '';
    // Force a reflow so the browser registers the cleared animation
    // before we re-apply it. Without this, rapid consecutive rolls
    // (e.g., user rolls, AI rolls, user rolls again) sometimes skip
    // the tumble.
    void el.offsetHeight;
    el.style.animation = `css-dice-roll ${ROLL_ANIMATION_MS}ms ease-out`;

    const timer = window.setTimeout(() => {
      // Defensive: if the component unmounted during the roll, ref
      // may be null. Guard before touching style.
      if (!dieRef.current) return;
      dieRef.current.style.transform = finalTransform;
      dieRef.current.style.animation = 'none';
    }, ROLL_ANIMATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [rollId, finalTransform]);

  return (
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
  );
}
