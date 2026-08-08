import {useEffect, useMemo} from "react"

import type {Json} from "../../../../../packages/shared/src/database"
import {PlayButton} from "../../components/PlayButton"
import {useGetTableConfigsQuery} from "../../features/lobby/lobbyApi"
import type {TableConfigRow} from "../../features/lobby/lobbyData"
import {formatCompactNumber} from "../../lib/format"
import {isSupabaseConfigured} from "../../lib/supabase"
import {useImagePreloader} from "../../lib/useImagePreloader"

import styles from "./DifficultyModal.module.css"

/**
 * Server row shape we need. We only read enabled difficulty rows
 * (kind = 'difficulty') so the lobby grid stays clean even if BO
 * operators add half-built rows.
 */

export type DifficultySelection = {
  readonly tableConfigId: string,
  readonly displayName: string,
  readonly entryFeeCoins: number,
  readonly turnSeconds: number,
  readonly matchTarget: number,
}

/**
 * The matchmaking overlay state, shown while we're polling
 * find_match_in_tier between PLAY click and either a PvP pair or the
 * AI fallback firing. `searchingForTier` is the table_config_id we're
 * currently searching for; null = no overlay.
 */
export type MatchmakingOverlayState = {
  readonly searchingForTier: string | null,
  readonly tierDisplayName: string,
  readonly elapsedSeconds: number,
  readonly maxSeconds: number,
}

type DifficultyModalProps = {
  readonly open: boolean,
  readonly onClose: () => void,
  readonly onSelect: (selection: DifficultySelection) => void,
  readonly onGetCoins: () => void,
  readonly walletCoins: number,
  readonly playerLevel: number,
  readonly busyId: string | null,
  readonly matchmaking?: MatchmakingOverlayState,
  readonly onCancelMatchmaking?: () => void,
}

/* -------------------------------------------------------------------------- */
/* Per-tier accent palette                                                    */
/*                                                                            */
/* Inspired by the Clash-of-Clans-style "unit card" the user referenced:      */
/* white card body, tier-coloured name + stats strip + SELECT footer.         */
/*                                                                            */
/*   title       → small caps label above the tier name, in tier colour      */
/*   stat        → solid background of the 3-stats bottom strip               */
/*   statBorder  → vertical divider between stat columns (slightly darker)    */
/*   select      → SELECT-button gradient (darker than `stat` so the strip    */
/*                 reads as primary info and SELECT reads as the CTA)         */
/*   heroGrad    → fallback gradient when the per-tier .webp isn't present    */
/*   halo        → ambient glow under the card                                */

/* -------------------------------------------------------------------------- */

type TierPalette = {
  /** Tier name + stat values use this hex. */
  title: string,
  /** SELECT-button gradient (top-stop). */
  selectTop: string,
  /** SELECT-button gradient (bottom-stop). */
  selectBot: string,
  /** Fallback hero gradient when the per-tier .webp isn't supplied. */
  heroGrad: string,
  /** Ambient drop-shadow under the card. */
  halo: string,
}

const PALETTES: Record<string, TierPalette> = {
  green: {
    title: "#15803d",
    selectTop: "#22c55e",
    selectBot: "#14532d",
    heroGrad: "radial-gradient(circle at 50% 35%, #1f6b3a 0%, #082514 70%)",
    halo: "0 0 24px -10px rgba(34,197,94,0.45)",
  },
  blue: {
    title: "#1d4ed8",
    selectTop: "#3b82f6",
    selectBot: "#1e3a8a",
    heroGrad: "radial-gradient(circle at 50% 35%, #1e3a8a 0%, #0b1530 70%)",
    halo: "0 0 24px -10px rgba(59,130,246,0.45)",
  },
  purple: {
    title: "#7e22ce",
    selectTop: "#a855f7",
    selectBot: "#4c1d95",
    heroGrad: "radial-gradient(circle at 50% 35%, #6b21a8 0%, #2b0a4a 70%)",
    halo: "0 0 24px -10px rgba(168,85,247,0.45)",
  },
  red: {
    title: "#b91c1c",
    selectTop: "#ef4444",
    selectBot: "#7f1d1d",
    heroGrad: "radial-gradient(circle at 50% 35%, #991b1b 0%, #3b0a0a 70%)",
    halo: "0 0 24px -10px rgba(239,68,68,0.45)",
  },
  gold: {
    title: "#b45309",
    selectTop: "#f59e0b",
    selectBot: "#78350f",
    heroGrad: "radial-gradient(circle at 50% 35%, #b45309 0%, #2b1a05 70%)",
    halo: "0 0 24px -10px rgba(251,191,36,0.45)",
  },
}

function paletteFor(slug: string): TierPalette {
  return PALETTES[slug] ?? PALETTES.gold
}

/* -------------------------------------------------------------------------- */
/* Stat icons                                                                 */

/* -------------------------------------------------------------------------- */

/** XP boost icon — same purple-gradient hex used by DailyBonus +
 *  WheelModal so the XP visual language stays consistent across the
 *  lobby. Inline SVG (no .webp exists for XP).
 *  Responsive sizing: shrinks on small screens so 5 cards fit
 *  side-by-side without horizontal scroll. */
function XpHexIcon() {
  return (<svg
    aria-hidden
    className={styles.statIcon}
    viewBox="0 0 100 110">
    <defs>
      <linearGradient
        id="diff-xp-fill"
        x1="0"
        x2="0"
        y1="0"
        y2="1">
        <stop
          offset="0%"
          stopColor="#7c3aed"/>
        <stop
          offset="100%"
          stopColor="#3b0764"/>
      </linearGradient>
    </defs>
    <polygon
      fill="#1e1535"
      points="50,3 96,28 96,82 50,107 4,82 4,28"/>
    <polygon
      fill="url(#diff-xp-fill)"
      points="50,11 88,33 88,77 50,99 12,77 12,33"/>
    <text
      fill="white"
      fontFamily="system-ui, sans-serif"
      fontSize="34"
      fontWeight="900"
      textAnchor="middle"
      x="50"
      y="68">XP
    </text>
  </svg>)
}

/** Entry-fee icon — the lobby's existing /lobby/icons/gold-coin.webp
 *  so the modal matches the wallet pill on the top bar. */
function CoinIcon() {
  return (<img
    alt=""
    className={styles.statIcon}
    draggable={false}
    src="/lobby/icons/gold-coin.webp"/>)
}

/** Time-to-move icon — analog clock face. Inline SVG (no clock asset
 *  exists in the game's icon set). */
function ClockIcon() {
  return (<svg
    aria-hidden
    className={styles.statIcon}
    viewBox="0 0 40 40">
    <circle
      cx="20"
      cy="20"
      fill="#fde68a"
      r="17"
      stroke="#5a3413"
      strokeWidth="2"/>
    <circle
      cx="20"
      cy="20"
      fill="none"
      r="13"
      stroke="#7c2d12"
      strokeWidth="0.8"/>
    <line
      stroke="#7c2d12"
      strokeLinecap="round"
      strokeWidth="2.5"
      x1="20"
      x2="20"
      y1="20"
      y2="10"/>
    <line
      stroke="#7c2d12"
      strokeLinecap="round"
      strokeWidth="2.5"
      x1="20"
      x2="27"
      y1="20"
      y2="23"/>
    <circle
      cx="20"
      cy="20"
      fill="#7c2d12"
      r="1.5"/>
  </svg>)
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  if (s % 60 === 0) return `${s / 60}m`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function metadataText(metadata: Json, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, Json>)[key]
  return typeof value === "string" ? value : null
}

/** Per-tier hero image URL: the operator override (metadata.heroImage) or the
 *  `/lobby/difficulties/<slug>.webp` convention (id with the `difficulty-`
 *  prefix stripped). Shared by the card and the modal's preload gate. */
function heroPathFor(row: TableConfigRow): string {
  const override = metadataText(row.metadata, "heroImage")
  const slug = row.id.startsWith("difficulty-") ? row.id.slice("difficulty-".length) : row.id
  return override ?? `/lobby/difficulties/${slug}.webp`
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */

/* -------------------------------------------------------------------------- */

type CardProps = {
  readonly row: TableConfigRow,
  readonly affordable: boolean,
  readonly levelLocked: boolean,
  readonly busy: boolean,
  readonly onPlay: () => void,
  readonly onGetCoins: () => void,
}

function DifficultyCard({
  row,
  affordable,
  levelLocked,
  busy,
  onPlay,
  onGetCoins,
}: CardProps) {
  const palette = paletteFor(row.accent_color)
  // Per-tier hero image (metadata.heroImage override, else the slug convention),
  // layered OVER the tier gradient so a missing .webp silently falls back.
  const heroPath = heroPathFor(row)
  const heroStyle: React.CSSProperties = {
    backgroundImage: `url("${heroPath}"), ${palette.heroGrad}`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  }

  const buttonDisabled = busy || levelLocked
  const buttonLabel = levelLocked ? `Unlocks at Lv ${row.required_level}` : busy ? "Searching…" : affordable ? "Play" : "Get Coins"

  // CTA palette decides the BUTTON's colour — independent of the
  // tier accent, so the green / orange / grey treatment reads as
  // a universal play / shop-nudge / locked signal. (Tier identity
  // lives in the tier name strip + stat values.)
  const ctaClass = levelLocked ? styles.ctaLocked : affordable ? styles.ctaPlay // "Get Coins" gets the orange palette so it reads as a
    // separate-from-Play CTA — a nudge toward the shop, not a
    // normal positive action.
    : styles.ctaGetCoins

  return (<div
    className={styles.card}
    style={{
      // Per-tier halo glow only — no scale on any card so the
      // five tiles share one footprint (matches the user's
      // "make sure it's the same size" feedback on the Pro
      // card).
      boxShadow: `${palette.halo}, 0 14px 26px rgba(0,0,0,0.55)`,
    }}>
    {/* Tier name strip — sits above the hero on the dark card
          background, rendered in the tier accent so the difficulty
          identity (BEGINNER / ADVANCED / PRO / EXPERT / GRAND
          MASTER) reads even when the player only glances at the
          modal. whitespace-nowrap + container-query font scales
          the longest expected name ("GRAND MASTER") down on
          narrow cards so all five tiles share one height. */}
    <div className={styles.tierNameWrap}>
      <div
        className={styles.tierName}
        style={{
          color: palette.title,
        }}>
        {row.display_name}
      </div>
    </div>

    {/* Hero panel — the per-tier room image. Aspect ratio
          changed from 4:3 to 16:9 to claw back vertical space
          (4:3 made each card ~75% as tall as wide; 16:9 is
          ~56%, saving ~20% per card height). Five cards sharing
          one row x ~25% saving = the modal now fits a portrait
          phone without vertical scroll. */}
    <div
      aria-hidden
      className={styles.heroPanel}
      style={heroStyle}/>

    {/* Stats panel — cream rounded outer card containing three
          icon-rows (XP boost / entry fee / time to move). Each
          value uses a container-query font-size so the longer
          numbers ("500%", "150K") shrink-to-fit on narrow cards
          instead of overflowing the pill. */}
    <div
      className={styles.statsPanel}>
      <div className={styles.statsStack}>
        <div
          className={styles.statRow}>
          <XpHexIcon/>
          <div className={styles.statTextWrap}>
            <div
              className={styles.statLabel}>
              XP Boost
            </div>
            <div
              className={styles.statValue}
              style={{
                color: palette.title,
              }}>
              {row.xp_multiplier_pct}%
            </div>
          </div>
        </div>
        <div
          className={styles.statRow}>
          <CoinIcon/>
          <div className={styles.statTextWrap}>
            <div
              className={styles.statLabel}>
              Entry Fee
            </div>
            <div
              className={styles.statValue}
              style={{
                color: palette.title,
              }}>
              {formatCompactNumber(row.entry_fee_coins)}
            </div>
          </div>
        </div>
        <div
          className={styles.statRow}>
          <ClockIcon/>
          <div className={styles.statTextWrap}>
            <div
              className={styles.statLabel}>
              Time to Move
            </div>
            <div
              className={styles.statValue}
              style={{
                color: palette.title,
              }}>
              {formatSeconds(row.turn_seconds)}
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* CTA button — restored to the original rounded-rect style.
          Three states share the same shape but swap palette + label:
            - green "Play"           → affordable + unlocked
            - orange "Get Coins"     → unaffordable
            - grey "Unlocks at Lv N" → level-gated (disabled)
          The CTA's colour is independent of the tier accent so a
          player can tell at a glance whether each room is playable
          without parsing five different greens / blues / etc.
          whitespace-nowrap + container-query font-size makes the
          longest label ("UNLOCKS AT LV 10") always fit a single
          line at any card width — no more two-line wrap on the
          locked-tier cards. */}
    <div className={styles.ctaWrap}>
      {affordable && !levelLocked ? (// Standardized premium Play button, full-width to match the
        // cream stats block above (same horizontal inset). `block`
        // stretches it; font-size only drives the height, scaled via
        // a container-query unit so it stays proportionate per card.
        <PlayButton
          block
          disabled={buttonDisabled}
          label="Play"
          // Taller font-size so the button height matches the grey
          // "Unlocks at Lv N" / orange "Get Coins" buttons rather
          // than reading as a thin strip.
          wrapClassName={styles.playCtaFontSize}
          onClick={onPlay}/>) : (// Non-Play states keep their distinct treatment: orange
        // "Get Coins" (shop nudge) and grey "Unlocks at Lv N".
        <button
          className={`${styles.ctaButton} ${ctaClass}`}
          disabled={buttonDisabled}
          type="button"
          onClick={levelLocked ? undefined : onGetCoins}>
          {buttonLabel}
        </button>)}
    </div>
  </div>)
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                      */

/* -------------------------------------------------------------------------- */

export function DifficultyModal({
  open,
  onClose,
  onSelect,
  onGetCoins,
  walletCoins,
  playerLevel,
  busyId,
  matchmaking,
  onCancelMatchmaking,
}: DifficultyModalProps) {
  const {
    data,
    error,
    isFetching,
    isUninitialized,
  } = useGetTableConfigsQuery("difficulty", {
    skip: !open || !isSupabaseConfigured,
  })
  const rows = data ?? []
  const loading = isFetching || (open && isUninitialized)
  const loadError = error !== undefined && !isFetching ? "Could not load difficulties." : null

  // Preload the per-tier hero art so the cards reveal fully-formed instead of
  // the room images popping in a beat after the frame. Errors don't block the
  // gate (a missing .webp just shows the gradient), so it never hangs.
  const heroUrls = useMemo(() => (data ?? []).map(heroPathFor), [data])
  const {ready: heroImagesReady} = useImagePreloader(heroUrls)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (<div
    aria-label="Select room difficulty"
    aria-modal="true"
    className={styles.backdrop}
    role="dialog"
    onClick={onClose}>
    <div
      className={styles.panel}
      onClick={(e) => {
        e.stopPropagation()
      }}>
      {/* Header — title only, subtitle removed per user request.
            Vertical margins tightened across all breakpoints to
            free up more room for the 5-card grid so the modal
            fits the viewport without scrolling. */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.titleStar}>✦</span>
          <h2
            className={styles.title}>
            Select Room
          </h2>
          <span className={styles.titleStar}>✦</span>
        </div>
        <button
          aria-label="Close"
          className={styles.closeButton}
          type="button"
          onClick={onClose}>
          <svg
            className={styles.closeIcon}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            viewBox="0 0 24 24">
            <line
              x1="18"
              x2="6"
              y1="6"
              y2="18"/>
            <line
              x1="6"
              x2="18"
              y1="6"
              y2="18"/>
          </svg>
        </button>
      </div>

      {loadError ? (<div
        className={styles.statusMessage}>{loadError}</div>) : loading || (rows.length > 0 && !heroImagesReady) ? (
        <div className={`${styles.statusMessage} ${styles.statusMessageMuted}`}>Loading…</div>) : rows.length === 0 ? (
        <div className={`${styles.statusMessage} ${styles.statusMessageMuted}`}>
          No difficulties configured yet.
        </div>) : (// 5-up grid at EVERY breakpoint per user spec ("all 5
        // difficulties should fit 1 line"). Card internals are
        // responsive (tiny on phones, full-size on desktop) so
        // they don't force horizontal overflow.
        <div className={styles.grid}>
          {rows.map((row) => (<DifficultyCard
            key={row.id}
            affordable={walletCoins >= row.entry_fee_coins}
            busy={busyId === row.id}
            levelLocked={playerLevel < row.required_level}
            row={row}
            onGetCoins={onGetCoins}
            onPlay={() => {
              onSelect({
                tableConfigId: row.id,
                displayName: row.display_name,
                entryFeeCoins: row.entry_fee_coins,
                turnSeconds: row.turn_seconds,
                matchTarget: row.match_target,
              })
            }}/>))}
        </div>)}

      {/* Footer legend — two short tips. The "entry fee deducted
            on join" tip was dropped per user request; the entry-fee
            row on each card is already self-explanatory.
            Hidden below 1024px (`display: none` by default) and
            shown as a two-column grid only at `min-width: 1024px`,
            so the 5-card grid + header fit the viewport without
            scrolling on phones and tablets. The stat icons + labels
            on each card are already self-explanatory; the legend is
            purely a nice-to-have on desktop. */}
      <div
        className={styles.legend}>
        <div className={styles.legendItem}>
          <XpHexIcon/>
          <span>Higher difficulty grants more XP per match.</span>
        </div>
        <div className={styles.legendItem}>
          <ClockIcon/>
          <span>Time to move is the total time you have for each turn.</span>
        </div>
      </div>

      {/* Matchmaking overlay — unchanged. Mounts over the card grid
            while the parent polls find_match_in_tier. */}
      {matchmaking?.searchingForTier ? (
        <div className={styles.mmOverlay}>
          {/* Compact self-contained dialog — the matchmaking state has little
                content, so it reads as a small popup rather than filling the
                whole room frame. */}
          <div
            className={styles.mmDialog}>
            <div className={styles.mmIconWrap}>
              <span className={styles.mmPing}/>
              <span className={styles.mmPulse}/>
              <span className={styles.mmVs}>vs</span>
            </div>
            <div>
              <div className={styles.mmTitle}>
                Finding opponent
              </div>
              <div className={styles.mmSubtitle}>
                {matchmaking.tierDisplayName} room ·{" "}
                {Math.ceil(Math.max(0, matchmaking.maxSeconds - matchmaking.elapsedSeconds))}s
              </div>
            </div>
            <div className={styles.mmTrack}>
              <div
                className={styles.mmFill}
                style={{
                  width: `${Math.min(100, (matchmaking.elapsedSeconds / matchmaking.maxSeconds) * 100)}%`,
                }}/>
            </div>
            {onCancelMatchmaking ? (<button
              className={styles.mmCancel}
              type="button"
              onClick={onCancelMatchmaking}>
              Cancel
            </button>) : null}
          </div>
        </div>) : null}
    </div>
  </div>)
}
