import {type CSSProperties, useCallback, useEffect, useRef, useState} from "react"

import {ONBOARDING_STEPS, type TourStep} from "./onboardingSteps"
import styles from "./OnboardingTour.module.css"

/**
 * First-run onboarding tour. A dimmed overlay with a spotlight cutout that
 * walks a new player through the two currencies and ends pointing at PLAY.
 *
 * Anchoring: each step names a CSS selector for the element to spotlight
 * (the currency pills already carry `data-fly-target`; PLAY carries
 * `data-tour="play"`). We re-measure the target's rect on a rAF loop so the
 * cutout stays glued even while the lobby's board carousel animates or the
 * viewport resizes — the same responsive layout that has bitten us before.
 * A step whose anchor isn't on screen (e.g. PLAY hidden because the board
 * isn't playable) falls back to a centered card so the tour never breaks.
 *
 * Persistence is the caller's job: `onDone` fires for both Skip and the final
 * CTA, and LobbyScreen stamps profiles.tutorial_completed_at + a localStorage
 * mirror so this shows exactly once.
 */

type Rect = {
  readonly top: number,
  readonly left: number,
  readonly width: number,
  readonly height: number,
}

function readRect(selector: string | undefined): Rect | null {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // Treat a zero-size / off-screen element as "not there yet".
  if (r.width === 0 && r.height === 0) return null
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  }
}

function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5)
}

export function OnboardingTour({
  steps = ONBOARDING_STEPS,
  onDone,
}: {
  readonly steps?: readonly TourStep[], /** Fires once when the tour is dismissed — via Skip or the final CTA. */
  readonly onDone: () => void,
}) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const doneRef = useRef(false)

  const step = steps[index]
  const isLast = index === steps.length - 1

  const finish = useCallback(() => {
    if (doneRef.current) return // guard against double-fire (button + key)
    doneRef.current = true
    onDone()
  }, [onDone])

  const next = useCallback(() => {
    if (isLast) {
      finish()
      return
    }
    setIndex((i) => Math.min(i + 1, steps.length - 1))
  }, [isLast, finish, steps.length])

  // Glue the spotlight to the live element. rAF (not just resize/scroll) so the
  // cutout tracks the board carousel's transition and any late layout settle;
  // we only setState when the rect actually changes, so this stays cheap.
  const PAD = 8
  const anchor = step?.anchor
  useEffect(() => {
    let raf = 0
    let current: Rect | null = null
    let first = true // force one setState on (re)mount / step change
    const tick = () => {
      const nextRect = readRect(anchor)
      if (first || !rectsEqual(current, nextRect)) {
        first = false
        current = nextRect
        setRect(nextRect)
      }
      raf = requestAnimationFrame(tick)
    }
    // setState lives only inside the rAF callback (not the effect body) so it
    // doesn't trigger a synchronous cascading render; the first frame fires
    // ~16ms in and the spotlight's transition smooths the step change.
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [anchor])

  // Esc skips; Enter/Space advances — keyboard parity for desktop players.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        finish()
      }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [finish, next])

  if (!step) return null

  // Card placement: below the spotlight if there's room, else above; centered
  // when there's no anchor (welcome) or the anchor isn't on screen.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardMaxW = Math.min(360, vw - 24)
  let cardStyle: CSSProperties
  if (rect) {
    const centerX = rect.left + rect.width / 2
    const left = Math.max(12, Math.min(centerX - cardMaxW / 2, vw - cardMaxW - 12))
    const spaceBelow = vh - (rect.top + rect.height)
    const placeBelow = spaceBelow > 220 || spaceBelow > rect.top
    cardStyle = placeBelow ? {
      left,
      top: rect.top + rect.height + PAD + 12,
      maxWidth: cardMaxW,
    } : {
      left,
      bottom: vh - rect.top + PAD + 12,
      maxWidth: cardMaxW,
    }
  }
  else {
    cardStyle = {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: cardMaxW,
    }
  }

  return (<div
    aria-live="polite"
    aria-modal="true"
    className={styles.overlay}
    role="dialog">
    {/* Full-screen click absorber: blocks interaction with the lobby beneath
          for the duration of the tour. Transparent when a spotlight is shown
          (the cutout's box-shadow does the dimming); dimmed itself otherwise. */}
    <div
      className={styles.clickAbsorber}
      style={{
        background: rect ? "transparent" : "rgba(3,9,20,0.82)",
      }}
      onClick={(e) => {
        e.stopPropagation()
      }}/>

    {/* Spotlight cutout — a transparent rect whose giant box-shadow dims
          everything around it, revealing the anchored element. */}
    {rect ? (<div
      className={styles.spotlight}
      style={{
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }}/>) : null}

    {/* Step card */}
    <div
      className={styles.stepCard}
      style={{
        ...cardStyle,
      }}>
      <div className={styles.counterRow}>
        <span className={styles.counter}>
          {index + 1} / {steps.length}
        </span>
      </div>
      <h2 className={styles.title}>
        {step.title}
      </h2>
      <div className={styles.body}>
        {step.body.map((p) => (<p
          key={p}
          className={styles.paragraph}>
          {p}
        </p>))}
      </div>
      <div className={styles.footerRow}>
        {!isLast ? (<button
          className={styles.skipButton}
          type="button"
          onClick={finish}>
          Skip
        </button>) : (<span/>)}
        <button
          className={styles.ctaButton}
          type="button"
          onClick={next}>
          {step.cta}
          {!isLast ? " →" : ""}
        </button>
      </div>
    </div>
  </div>)
}
