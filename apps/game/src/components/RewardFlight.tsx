import {useEffect, useEffectEvent, useRef} from "react"

import styles from "./RewardFlight.module.css"

export type FlightCurrency = "coins" | "gems" | "xp"

export type RewardFlightSpec = {
  readonly id: number,
  readonly currency: FlightCurrency,
  /** Viewport coords for the starting centre of the flying token. */
  readonly startX: number,
  readonly startY: number,
  /** Viewport coords for the centre of the destination wallet pill. */
  readonly endX: number,
  readonly endY: number,
  /** Stagger so multiple tokens don't overlap perfectly. */
  readonly delayMs: number,
  /** Total flight duration in ms. */
  readonly durationMs: number,
}

/** Webp icon URLs per currency. XP has no webp asset — the JSX
 *  below renders the inline hex SVG instead so the missing file
 *  doesn't show as a broken-image glyph. */
const ICONS: Partial<Record<FlightCurrency, string>> = {
  coins: "/lobby/icons/gold-coin.webp",
  gems: "/lobby/carousel/gem.webp",
}

/** Inline XP hex — matches the DailyBonus + WheelModal styling. */
function XpHexInline() {
  return (<svg
    aria-hidden
    height="100%"
    viewBox="0 0 100 110"
    width="100%">
    <defs>
      <linearGradient
        id="rf-xp-fill"
        x1="0"
        x2="0"
        y1="0"
        y2="1">
        <stop
          offset="0%"
          stopColor="#a855f7"/>
        <stop
          offset="100%"
          stopColor="#581c87"/>
      </linearGradient>
    </defs>
    <polygon
      fill="#fbbf24"
      points="50,3 96,28 96,82 50,107 4,82 4,28"/>
    <polygon
      fill="url(#rf-xp-fill)"
      points="50,11 88,33 88,77 50,99 12,77 12,33"/>
    <text
      fill="white"
      fontFamily="system-ui, sans-serif"
      fontSize="34"
      fontWeight="900"
      stroke="rgba(0,0,0,0.35)"
      strokeWidth="1"
      textAnchor="middle"
      x="50"
      y="68">
      XP
    </text>
  </svg>)
}

type Props = {
  readonly spec: RewardFlightSpec,
  readonly onLanded: (id: number) => void,
}

/**
 * One flying token. Uses the Web Animations API to slide and slightly
 * arc from the start point to the wallet pill, scaling down and fading
 * out as it lands. When the animation finishes, it removes itself via
 * the onLanded callback.
 */
export function RewardFlight({
  spec,
  onLanded,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const notifyLanded = useEffectEvent(onLanded)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const dx = spec.endX - spec.startX
    const dy = spec.endY - spec.startY
    // Arc up by ~30 % of the vertical distance so tokens curve, not slide.
    const arcY = dy * 0.5 - Math.max(60, Math.abs(dy) * 0.25)
    const anim = el.animate([{
      transform: "translate(-50%, -50%) translate(0px, 0px) scale(1)",
      opacity: 1,
    }, {
      // Mid-point: half the horizontal travel + arc Y peak.
      transform: `translate(-50%, -50%) translate(${dx * 0.55}px, ${arcY}px) scale(0.95)`,
      opacity: 1,
      offset: 0.55,
    }, {
      transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.35)`,
      opacity: 0,
    }], {
      duration: spec.durationMs,
      delay: spec.delayMs,
      easing: "cubic-bezier(0.4, 0, 0.6, 1)",
      fill: "forwards",
    })
    let cancelled = false
    anim.finished
      .then(() => {
        if (!cancelled) notifyLanded(spec.id)
      })
      .catch(() => {
        if (!cancelled) notifyLanded(spec.id)
      })
    return () => {
      cancelled = true
      try {
        anim.cancel()
      }
      catch {
        // ignore — element may have been removed already
      }
    }
  }, [spec.delayMs, spec.durationMs, spec.endX, spec.endY, spec.id, spec.startX, spec.startY])

  return (<div
    ref={ref}
    aria-hidden="true"
    className={styles.flight}
    style={{
      left: `${spec.startX}px`,
      top: `${spec.startY}px`, // Initial transform is set so the element is centred on (startX,startY)
      // before the animation begins; the animation keyframes also include
      // `translate(-50%, -50%)` so the centre is preserved through the path.
      transform: "translate(-50%, -50%)",
    }}>
    {spec.currency === "xp" ? (<XpHexInline/>) : (<img
      alt=""
      className={styles.flightImg}
      draggable={false}
      src={ICONS[spec.currency]}/>)}
  </div>)
}
