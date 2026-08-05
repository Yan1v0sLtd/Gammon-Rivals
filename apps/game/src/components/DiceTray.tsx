import {memo, useEffect, useMemo, useRef} from "react"

import type {DiceRoll, Die} from "../../../../packages/engine/src/types"

import styles from "./DiceTray.module.css"

/**
 * DiceTray v4 — pure HTML + CSS 3D dice.
 *
 * Final iteration. Lineage:
 *   v1 — Three.js + Cannon physics. Created a fresh WebGL context
 *        per dice roll, never released them properly, board canvas
 *        went white after ~16 rolls (browser context cap).
 *   v2 — CSS cubes (first attempt). Looked flat because of
 *        filter: drop-shadow on the cube (CSS spec forces flat).
 *   v3 — Three.js with a single-renderer architecture + physics
 *        tumble + post-settle quaternion snap. Worked, but ~571KB
 *        of bundle and complex to maintain.
 *   v4 — pure HTML+CSS cube using a CSS Grid pip layout per face.
 *        No keyframes, no setTimeout snap, no WebGL. Each roll
 *        sets the cube's inline transform to
 *        `rotateX(target_x) rotateY(target_y)` where target is
 *        `base_face_rotation + N*360` extra degrees. The CSS
 *        transition (1.5s cubic-bezier) interpolates THROUGH the
 *        spins to land on the face, giving a free tumble + settle.
 *
 * Cumulative rotation: each die remembers its current absolute
 * rotation in a ref. Subsequent rolls always rotate FORWARD by at
 * least MIN_SPINS_PER_ROLL turns, so the 5th roll tumbles just as
 * vividly as the 1st (a naive `target = base + random_spins`
 * approach would gradually have less rotation between rolls).
 */

type Props = {
  readonly roll: DiceRoll | null,
  readonly remaining: readonly Die[],
  readonly settleSide?: "left" | "right",
  readonly placement?: "board" | "hud",
  /** Optional theme-provided dice sprite (3 cols × 2 rows of faces
   *  1–6 in reading order). When supplied, each face div renders
   *  with the sprite as its background-image instead of the default
   *  CSS pip grid. The cube transforms (rotations / tumble / face
   *  selection) work identically — only the per-face artwork
   *  changes. Sourced from Theme.diceImage on the active board
   *  theme; null/undefined → fall back to default pip cubes. */
  readonly themeSprite?: string,
}

/**
 * Per-face base rotation. To make face N face the camera, the cube
 * must be rotated to these (x, y) degrees (modulo 360 of each).
 * Matches the per-face CSS in DiceTray.module.css:
 *   .diceFaceF1 → +Z   (no rotation needed)
 *   .diceFaceF2 → +Y bottom (rotateX 90 deg)
 *   .diceFaceF3 → +X right (rotateY -90 deg shows the face that
 *                              was on the +X side)
 *   .diceFaceF4 → -X left
 *   .diceFaceF5 → -Y top
 *   .diceFaceF6 → -Z back
 */
const ROTATION_MAP: Record<Die, {x: number, y: number}> = {
  1: {
    x: 0,
    y: 0,
  },
  2: {
    x: -90,
    y: 0,
  },
  3: {
    x: 0,
    y: -90,
  },
  4: {
    x: 0,
    y: 90,
  },
  5: {
    x: 90,
    y: 0,
  },
  6: {
    x: 180,
    y: 0,
  },
}

/** Minimum full 360° turns each roll's tumble should perform.
 *  Per-axis is randomised between MIN and MIN+2 inclusive so the
 *  two axes have different spin counts and the cube looks like
 *  it's actually tumbling, not yaw-spinning. */
const MIN_SPINS_PER_ROLL = 3
const SPIN_VARIANCE = 3 // 3..5 turns
const PIP_KEYS = ["pip-1", "pip-2", "pip-3", "pip-4", "pip-5", "pip-6"] as const

/**
 * Compute the next absolute rotation for an axis. Inputs:
 *   `current`   — the cube's current absolute rotation on this
 *                 axis (accumulated across all prior rolls).
 *   `baseFace`  — the rotation (mod 360) that orients the desired
 *                 face toward the camera.
 *
 * Output: the smallest value that
 *   (a) is ≡ baseFace (mod 360), so the right face ends up forward
 *   (b) is at least MIN_SPINS_PER_ROLL turns past `current`
 *   (c) adds a random 0..1 turn of variance so the two dice
 *       don't settle in lock-step
 *
 * The trick: find k such that
 *   base + 360k >= current + min_extra
 * The smallest such k is ceil((current + min_extra - base) / 360).
 */
function nextRotationStop(current: number, baseFace: number): number {
  const extraSpins = MIN_SPINS_PER_ROLL + Math.floor(Math.random() * SPIN_VARIANCE)
  const minExtra = extraSpins * 360 + Math.random() * 180
  const k = Math.ceil((current + minExtra - baseFace) / 360)
  return baseFace + 360 * k
}

/* ─── diceToShow — same semantics as every prior version ───────── */

function diceToShow(roll: DiceRoll, remaining: readonly Die[]): {readonly id: "first" | "second", readonly value: Die, readonly used: boolean}[] {
  if (roll[0] === roll[1]) {
    // Doubles grant FOUR moves but we render only TWO dice and
    // grey them out progressively:
    //   0–1 moves used → both fresh
    //   2–3 moves used → one die greyed
    //   4   moves used → both greyed
    const used = 4 - remaining.length
    return [{
      id: "first",
      value: roll[0],
      used: used >= 2,
    }, {
      id: "second",
      value: roll[0],
      used: used >= 4,
    }]
  }
  const remCopy = [...remaining]
  return ([roll[0], roll[1]] as const).map((v, i) => {
    const idx = remCopy.indexOf(v)
    if (idx >= 0) {
      remCopy.splice(idx, 1)
      return {
        id: i === 0 ? "first" : "second",
        value: v,
        used: false,
      }
    }
    return {
      id: i === 0 ? "first" : "second",
      value: v,
      used: true,
    }
  })
}

/* ─── Component ────────────────────────────────────────────────── */

export const DiceTray = memo(function DiceTray({
  roll,
  remaining,
  settleSide = "right",
  themeSprite,
}: Props) {
  const dice = useMemo(() => (roll ? diceToShow(roll, remaining) : []), [roll, remaining])
  if (!roll || dice.length === 0) return null

  // Stable id per roll. DELIBERATELY does NOT include
  // remaining.length — that was the v4-initial bug where the
  // tumble re-fired on every sub-move the player made.
  const rollId = `${roll[0]}-${roll[1]}`

  return (<div
    aria-hidden
    className={`${styles.diceBoard} ${settleSide === "left" ? styles.diceBoardLeft : styles.diceBoardRight}`}>
    {dice.map((d) => (
      <CssDie
        key={`${rollId}-${d.id}`}
        rollId={`${rollId}-${d.id}`}
        sprite={themeSprite}
        used={d.used}
        value={d.value}/>
    ))}
  </div>)
})

/**
 * Single CSS 3D die. Six face divs in `transform-style: preserve-3d`,
 * positioned at ±40px along each axis (half the 80px cube size).
 * Pip layout is CSS Grid (3×3 per face) with per-face nth-child
 * rules placing the dots in the right cells.
 *
 * On every new `rollId`, we compute the next absolute rotation
 * (face + at least 3 extra full turns past current) and set the
 * inline transform. The CSS `transition: transform 1.5s
 * cubic-bezier(...)` does the visual tumble + settle.
 */
function CssDie({
  value,
  used,
  rollId,
  sprite,
}: {
  readonly value: Die, readonly used: boolean, readonly rollId: string, readonly sprite?: string,
}) {
  const dieRef = useRef<HTMLDivElement>(null)
  // Cumulative absolute rotation across this die's lifetime. We
  // need this in a ref (not state) so re-renders don't reset it,
  // and so updating it doesn't trigger another React render.
  const rotationRef = useRef({
    x: 0,
    y: 0,
  })

  useEffect(() => {
    const el = dieRef.current
    if (!el) return

    const base = ROTATION_MAP[value]
    const nextX = nextRotationStop(rotationRef.current.x, base.x)
    const nextY = nextRotationStop(rotationRef.current.y, base.y)
    rotationRef.current = {
      x: nextX,
      y: nextY,
    }

    // Force the browser to commit the CURRENT style before setting
    // the new transform. Without this, mount + transform-set in
    // the same paint frame skips the transition entirely
    // (AI-roll "no animation" bug).
    void el.offsetHeight

    el.style.transform = `rotateX(${nextX}deg) rotateY(${nextY}deg)`
  }, [rollId, value])

  // When a theme sprite URL is provided, switch to sprite mode:
  // the cube gets the diceCubeSprite class, each face uses
  // background-image (positioned to its tile of the sprite), and
  // we skip rendering pip <span> children entirely. The CSS
  // sprite rules in DiceTray.module.css handle the per-face
  // background-position. The CSS variable carries the URL into
  // every face div without us having to thread it 6 times.
  // The `used` styling now lives on the diceStand wrapper
  // (see render below) so a single rule can dim both the cube
  // and the shadow at the same time. The cube className itself
  // only carries the sprite-mode flag now.
  const className = `${styles.diceCube}${sprite ? ` ${styles.diceCubeSprite}` : ""}`
  const style = sprite ? ({["--dice-sprite-url" as string]: `url("${sprite}")`} as React.CSSProperties) : undefined

  // For sprite mode we don't render any pip children — the
  // sprite IS the face artwork. For default mode we render the
  // standard pip counts per face (1, 2, 3, 4, 5, 6).
  const renderPips = (count: number) => {
    if (sprite) return null
    return PIP_KEYS.slice(0, count).map((pipKey) => (<span
      key={pipKey}
      className={styles.dicePip}/>))
  }

  // The stand wrapper holds the cube + a flat shadow sibling. It
  // MUST keep transform-style: preserve-3d so the cube's faces
  // still render in 3D. The shadow has filter: blur() — that
  // filter forces flat only on the shadow element itself, not
  // the cube sibling or the stand parent.
  //
  // The `used` className is on the STAND (not just the cube) so a
  // single CSS rule can dim both the cube AND the shadow
  // together. Without that, a "used" die went to 40% opacity but
  // its shadow stayed at full strength — players reported seeing
  // "shadow without die" after consuming a pip in a move.
  return (
    <div className={`${styles.diceStand}${used ? ` ${styles.diceStandUsed}` : ""}`}>
      <div
        ref={dieRef}
        className={className}
        style={style}>
        <div className={`${styles.diceFace} ${styles.diceFaceF1}`}>{renderPips(1)}</div>
        <div className={`${styles.diceFace} ${styles.diceFaceF2}`}>{renderPips(2)}</div>
        <div className={`${styles.diceFace} ${styles.diceFaceF3}`}>{renderPips(3)}</div>
        <div className={`${styles.diceFace} ${styles.diceFaceF4}`}>{renderPips(4)}</div>
        <div className={`${styles.diceFace} ${styles.diceFaceF5}`}>{renderPips(5)}</div>
        <div className={`${styles.diceFace} ${styles.diceFaceF6}`}>{renderPips(6)}</div>
      </div>
      <div
        aria-hidden
        className={styles.diceShadow}/>
    </div>
  )
}
