import { useEffect, useMemo } from 'react';
import { useImagePreloader } from '../lib/useImagePreloader';
import { isSupabaseConfigured } from '../lib/supabase';
import { formatCompactNumber } from '../lib/format';
import { PlayButton } from '../components/PlayButton';
import { useGetTableConfigsQuery } from '../features/lobby/lobbyApi';
import type { TableConfigRow } from '../lib/lobbyData';
import type { Json } from '../../../../packages/shared/src/database';

/**
 * Server row shape we need. We only read enabled difficulty rows
 * (kind = 'difficulty') so the lobby grid stays clean even if BO
 * operators add half-built rows.
 */

export interface DifficultySelection {
  readonly tableConfigId: string;
  readonly displayName: string;
  readonly entryFeeCoins: number;
  readonly turnSeconds: number;
  readonly matchTarget: number;
}

/**
 * The matchmaking overlay state, shown while we're polling
 * find_match_in_tier between PLAY click and either a PvP pair or the
 * AI fallback firing. `searchingForTier` is the table_config_id we're
 * currently searching for; null = no overlay.
 */
export interface MatchmakingOverlayState {
  readonly searchingForTier: string | null;
  readonly tierDisplayName: string;
  readonly elapsedSeconds: number;
  readonly maxSeconds: number;
}

interface DifficultyModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (selection: DifficultySelection) => void;
  readonly onGetCoins: () => void;
  readonly walletCoins: number;
  readonly playerLevel: number;
  readonly busyId: string | null;
  readonly matchmaking?: MatchmakingOverlayState;
  readonly onCancelMatchmaking?: () => void;
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

interface TierPalette {
  /** Tier name + stat values use this hex. */
  title: string;
  /** SELECT-button gradient (top-stop). */
  selectTop: string;
  /** SELECT-button gradient (bottom-stop). */
  selectBot: string;
  /** Fallback hero gradient when the per-tier .webp isn't supplied. */
  heroGrad: string;
  /** Ambient drop-shadow under the card. */
  halo: string;
}

const PALETTES: Record<string, TierPalette> = {
  green: {
    title: '#15803d',
    selectTop: '#22c55e',
    selectBot: '#14532d',
    heroGrad: 'radial-gradient(circle at 50% 35%, #1f6b3a 0%, #082514 70%)',
    halo: '0 0 24px -10px rgba(34,197,94,0.45)',
  },
  blue: {
    title: '#1d4ed8',
    selectTop: '#3b82f6',
    selectBot: '#1e3a8a',
    heroGrad: 'radial-gradient(circle at 50% 35%, #1e3a8a 0%, #0b1530 70%)',
    halo: '0 0 24px -10px rgba(59,130,246,0.45)',
  },
  purple: {
    title: '#7e22ce',
    selectTop: '#a855f7',
    selectBot: '#4c1d95',
    heroGrad: 'radial-gradient(circle at 50% 35%, #6b21a8 0%, #2b0a4a 70%)',
    halo: '0 0 24px -10px rgba(168,85,247,0.45)',
  },
  red: {
    title: '#b91c1c',
    selectTop: '#ef4444',
    selectBot: '#7f1d1d',
    heroGrad: 'radial-gradient(circle at 50% 35%, #991b1b 0%, #3b0a0a 70%)',
    halo: '0 0 24px -10px rgba(239,68,68,0.45)',
  },
  gold: {
    title: '#b45309',
    selectTop: '#f59e0b',
    selectBot: '#78350f',
    heroGrad: 'radial-gradient(circle at 50% 35%, #b45309 0%, #2b1a05 70%)',
    halo: '0 0 24px -10px rgba(251,191,36,0.45)',
  },
};

function paletteFor(slug: string): TierPalette {
  return PALETTES[slug] ?? PALETTES.gold!;
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
  return (
    <svg viewBox="0 0 100 110" className="h-4 w-4 shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)] sm:h-6 sm:w-6 lg:h-9 lg:w-9" aria-hidden>
      <defs>
        <linearGradient id="diff-xp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#3b0764" />
        </linearGradient>
      </defs>
      <polygon points="50,3 96,28 96,82 50,107 4,82 4,28" fill="#1e1535" />
      <polygon points="50,11 88,33 88,77 50,99 12,77 12,33" fill="url(#diff-xp-fill)" />
      <text
        x="50" y="68" textAnchor="middle"
        fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="34" fill="white"
      >XP</text>
    </svg>
  );
}

/** Entry-fee icon — the lobby's existing /lobby/icons/gold-coin.webp
 *  so the modal matches the wallet pill on the top bar. */
function CoinIcon() {
  return (
    <img
      src="/lobby/icons/gold-coin.webp"
      alt=""
      className="h-4 w-4 shrink-0 object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)] sm:h-6 sm:w-6 lg:h-9 lg:w-9"
      draggable={false}
    />
  );
}

/** Time-to-move icon — analog clock face. Inline SVG (no clock asset
 *  exists in the game's icon set). */
function ClockIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-4 w-4 shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)] sm:h-6 sm:w-6 lg:h-9 lg:w-9" aria-hidden>
      <circle cx="20" cy="20" r="17" fill="#fde68a" stroke="#5a3413" strokeWidth="2" />
      <circle cx="20" cy="20" r="13" fill="none" stroke="#7c2d12" strokeWidth="0.8" />
      <line x1="20" y1="20" x2="20" y2="10" stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="20" y1="20" x2="27" y2="23" stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="1.5" fill="#7c2d12" />
    </svg>
  );
}

/* Earlier iterations of this modal experimented with a chamfered /
 * octagonal SELECT button (gold-rim hex). The user asked to revert
 * to the original rounded-rect CTA (green Play / orange Get Coins /
 * grey Unlocks) so the chamfer helper is gone. The tier accent
 * still drives the title strip + stat values; the button colour is
 * now status-driven (playable / shop nudge / locked). */

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function metadataText(metadata: Json, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, Json>)[key];
  return typeof value === 'string' ? value : null;
}

/** Per-tier hero image URL: the operator override (metadata.heroImage) or the
 *  `/lobby/difficulties/<slug>.webp` convention (id with the `difficulty-`
 *  prefix stripped). Shared by the card and the modal's preload gate. */
function heroPathFor(row: TableConfigRow): string {
  const override = metadataText(row.metadata, 'heroImage');
  const slug = row.id.startsWith('difficulty-') ? row.id.slice('difficulty-'.length) : row.id;
  return override ?? `/lobby/difficulties/${slug}.webp`;
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

interface CardProps {
  readonly row: TableConfigRow;
  readonly affordable: boolean;
  readonly levelLocked: boolean;
  readonly busy: boolean;
  readonly onPlay: () => void;
  readonly onGetCoins: () => void;
}

function DifficultyCard({ row, affordable, levelLocked, busy, onPlay, onGetCoins }: CardProps) {
  const palette = paletteFor(row.accent_color);
  // Per-tier hero image (metadata.heroImage override, else the slug convention),
  // layered OVER the tier gradient so a missing .webp silently falls back.
  const heroPath = heroPathFor(row);
  const heroStyle: React.CSSProperties = {
    backgroundImage: `url("${heroPath}"), ${palette.heroGrad}`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };

  const buttonDisabled = busy || levelLocked;
  const buttonLabel = levelLocked
    ? `Unlocks at Lv ${row.required_level}`
    : busy
      ? 'Searching…'
      : affordable
        ? 'Play'
        : 'Get Coins';

  // CTA palette decides the BUTTON's colour — independent of the
  // tier accent, so the green / orange / grey treatment reads as
  // a universal play / shop-nudge / locked signal. (Tier identity
  // lives in the tier name strip + stat values.)
  const ctaClass = levelLocked
    ? 'border border-slate-700/70 bg-gradient-to-b from-slate-500 to-slate-700 cursor-not-allowed opacity-90'
    : affordable
      ? 'border border-emerald-900/60 bg-gradient-to-b from-emerald-400 to-emerald-700 hover:brightness-110 disabled:cursor-wait disabled:opacity-60'
      : // "Get Coins" gets the orange palette so it reads as a
        // separate-from-Play CTA — a nudge toward the shop, not a
        // normal positive action.
        'border border-amber-900/60 bg-gradient-to-b from-amber-400 to-orange-600 hover:brightness-110 disabled:cursor-wait disabled:opacity-60';

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl bg-[#1a120a]"
      style={{
        // Per-tier halo glow only — no scale on any card so the
        // five tiles share one footprint (matches the user's
        // "make sure it's the same size" feedback on the Pro
        // card).
        boxShadow: `${palette.halo}, 0 14px 26px rgba(0,0,0,0.55)`,
        border: '1px solid rgba(211,160,78,0.35)',
        // Container query anchor — every `cqi` unit inside this
        // card now resolves to 1% of THIS card's actual width
        // (not viewport-width). That's what lets text/icons in
        // the card scale with the card itself: when 5 cards
        // share a 1200px row each card is ~230px wide, when 5
        // cards share a 400px row each is ~76px wide, and
        // `clamp(min, Xcqi, max)` adapts smoothly in both.
        // Browser support: Chrome 105+, Firefox 110+, Safari 16+
        // (Baseline since Feb 2023 — fine for this app).
        containerType: 'inline-size',
      }}
    >
      {/* Tier name strip — sits above the hero on the dark card
          background, rendered in the tier accent so the difficulty
          identity (BEGINNER / ADVANCED / PRO / EXPERT / GRAND
          MASTER) reads even when the player only glances at the
          modal. whitespace-nowrap + container-query font scales
          the longest expected name ("GRAND MASTER") down on
          narrow cards so all five tiles share one height. */}
      <div className="px-1 pt-1 pb-0.5 text-center lg:px-3 lg:pt-2">
        <div
          className="font-display font-black uppercase whitespace-nowrap"
          style={{
            color: palette.title,
            textShadow: '0 2px 0 rgba(0,0,0,0.55)',
            // 6.2cqi ≈ 6.2% of card width — at 380px → 23.5px,
            // at 200px → 12.4px, at 80px → 5px. Clamped so it
            // never gets bigger than 1.1rem (~17.5px) or smaller
            // than 0.5rem (~8px).
            fontSize: 'clamp(0.5rem, 6.2cqi, 1.1rem)',
            // Tracking scales with font-size — 0.08em widens to
            // ~1.4px at 17.5px and tightens to ~0.6px at 8px so
            // the GRAND MASTER name always fits the strip.
            letterSpacing: '0.08em',
          }}
        >
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
        className="w-full"
        style={{
          ...heroStyle,
          aspectRatio: '16 / 9',
        }}
        aria-hidden
      />

      {/* Stats panel — cream rounded outer card containing three
          icon-rows (XP boost / entry fee / time to move). Each
          value uses a container-query font-size so the longer
          numbers ("500%", "150K") shrink-to-fit on narrow cards
          instead of overflowing the pill. */}
      <div className="m-1 rounded-md border border-amber-700/40 bg-[#f4e7c5] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] sm:m-2 sm:rounded-lg sm:p-1.5 lg:m-2.5 lg:rounded-xl lg:p-2">
        <div className="space-y-0.5 sm:space-y-1 lg:space-y-1.5">
          <div className="flex items-center gap-1 rounded border border-amber-700/15 bg-[#fdf6e3] px-1 py-0.5 sm:gap-1.5 sm:rounded-md sm:px-1.5 sm:py-1 lg:gap-2 lg:rounded-lg lg:px-2 lg:py-1">
            <XpHexIcon />
            <div className="min-w-0 flex-1">
              <div
                className="font-bold uppercase text-amber-900/70 whitespace-nowrap"
                style={{
                  fontSize: 'clamp(0.4rem, 3cqi, 0.65rem)',
                  letterSpacing: '0.05em',
                }}
              >
                XP Boost
              </div>
              <div
                className="font-display font-black leading-none tabular-nums whitespace-nowrap"
                style={{
                  color: palette.title,
                  fontSize: 'clamp(0.65rem, 6cqi, 1.1rem)',
                }}
              >
                {row.xp_multiplier_pct}%
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded border border-amber-700/15 bg-[#fdf6e3] px-1 py-0.5 sm:gap-1.5 sm:rounded-md sm:px-1.5 sm:py-1 lg:gap-2 lg:rounded-lg lg:px-2 lg:py-1">
            <CoinIcon />
            <div className="min-w-0 flex-1">
              <div
                className="font-bold uppercase text-amber-900/70 whitespace-nowrap"
                style={{
                  fontSize: 'clamp(0.4rem, 3cqi, 0.65rem)',
                  letterSpacing: '0.05em',
                }}
              >
                Entry Fee
              </div>
              <div
                className="font-display font-black leading-none tabular-nums whitespace-nowrap"
                style={{
                  color: palette.title,
                  fontSize: 'clamp(0.65rem, 6cqi, 1.1rem)',
                }}
              >
                {formatCompactNumber(row.entry_fee_coins)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded border border-amber-700/15 bg-[#fdf6e3] px-1 py-0.5 sm:gap-1.5 sm:rounded-md sm:px-1.5 sm:py-1 lg:gap-2 lg:rounded-lg lg:px-2 lg:py-1">
            <ClockIcon />
            <div className="min-w-0 flex-1">
              <div
                className="font-bold uppercase text-amber-900/70 whitespace-nowrap"
                style={{
                  fontSize: 'clamp(0.4rem, 3cqi, 0.65rem)',
                  letterSpacing: '0.05em',
                }}
              >
                Time to Move
              </div>
              <div
                className="font-display font-black leading-none tabular-nums whitespace-nowrap"
                style={{
                  color: palette.title,
                  fontSize: 'clamp(0.65rem, 6cqi, 1.1rem)',
                }}
              >
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
      <div className="px-1 pb-1 sm:px-2 sm:pb-2 lg:px-2.5 lg:pb-2.5">
        {affordable && !levelLocked ? (
          // Standardized premium Play button, full-width to match the
          // cream stats block above (same horizontal inset). `block`
          // stretches it; font-size only drives the height, scaled via
          // a container-query unit so it stays proportionate per card.
          <PlayButton
            label="Play"
            block
            disabled={buttonDisabled}
            onClick={onPlay}
            // Taller font-size so the button height matches the grey
            // "Unlocks at Lv N" / orange "Get Coins" buttons rather
            // than reading as a thin strip.
            wrapStyle={{ fontSize: 'clamp(13px, 7cqi, 18px)' }}
          />
        ) : (
          // Non-Play states keep their distinct treatment: orange
          // "Get Coins" (shop nudge) and grey "Unlocks at Lv N".
          <button
            type="button"
            onClick={levelLocked ? undefined : onGetCoins}
            disabled={buttonDisabled}
            className={
              'block w-full rounded py-1 font-display font-black uppercase text-white shadow-md transition active:translate-y-[1px] disabled:active:translate-y-0 whitespace-nowrap sm:rounded-md sm:py-1.5 lg:py-2 ' +
              ctaClass
            }
            style={{
              fontSize: 'clamp(0.5rem, 4.8cqi, 1rem)',
              letterSpacing: '0.05em',
            }}
          >
            {buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
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
  const { data, error, isFetching, isUninitialized } = useGetTableConfigsQuery('difficulty', {
    skip: !open || !isSupabaseConfigured,
  });
  const rows = data ?? [];
  const loading = isFetching || (open && isUninitialized);
  const loadError = error !== undefined && !isFetching ? 'Could not load difficulties.' : null;

  // Preload the per-tier hero art so the cards reveal fully-formed instead of
  // the room images popping in a beat after the frame. Errors don't block the
  // gate (a missing .webp just shows the gradient), so it never hangs.
  const heroUrls = useMemo(() => (data ?? []).map(heroPathFor), [data]);
  const { ready: heroImagesReady } = useImagePreloader(heroUrls);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm p-1 sm:p-2 lg:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select room difficulty"
    >
      <div
        className="relative w-[min(99vw,80rem)] max-h-[98vh] overflow-y-auto rounded-xl sm:max-h-[96vh] sm:rounded-2xl lg:w-[min(96vw,80rem)] lg:max-h-[94vh]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(70,42,12,0.45) 0%, rgba(8,5,3,0.92) 60%), linear-gradient(180deg, #100a06 0%, #050302 100%)',
          border: '2px solid #d3a04e',
          boxShadow:
            'inset 0 0 0 1px rgba(0,0,0,0.55), 0 30px 60px rgba(0,0,0,0.7)',
          padding: 'clamp(0.4rem, 1.4vw, 1.75rem)',
        }}
      >
        {/* Header — title only, subtitle removed per user request.
            Vertical margins tightened across all breakpoints to
            free up more room for the 5-card grid so the modal
            fits the viewport without scrolling. */}
        <div className="relative mb-1 flex flex-col items-center text-center sm:mb-2 lg:mb-4">
          <div className="flex items-center gap-1.5 sm:gap-3 lg:gap-4">
            <span className="text-sm text-amber-300/70 sm:text-xl lg:text-2xl">✦</span>
            <h2 className="bg-gradient-to-b from-[#fde68a] via-[#fcd34d] to-[#a16207] bg-clip-text font-display text-base font-black uppercase tracking-[0.12em] text-transparent sm:text-xl sm:tracking-[0.18em] lg:text-2xl md:text-3xl">
              Select Room
            </h2>
            <span className="text-sm text-amber-300/70 sm:text-xl lg:text-2xl">✦</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-0 top-0 grid h-6 w-6 place-items-center rounded-full border-2 border-[#c89a47] bg-[#0c0908]/80 text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition hover:brightness-110 active:scale-95 sm:h-8 sm:w-8 lg:h-10 lg:w-10"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loadError ? (
          <div className="grid place-items-center py-12 text-amber-200/80">{loadError}</div>
        ) : loading || (rows.length > 0 && !heroImagesReady) ? (
          <div className="grid place-items-center py-12 text-amber-200/60">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center py-12 text-amber-200/60">
            No difficulties configured yet.
          </div>
        ) : (
          // 5-up grid at EVERY breakpoint per user spec ("all 5
          // difficulties should fit 1 line"). Card internals are
          // responsive (tiny on phones, full-size on desktop) so
          // they don't force horizontal overflow.
          <div className="grid grid-cols-5 gap-1 pt-1 sm:gap-2 sm:pt-2 lg:gap-5">
            {rows.map((row) => (
              <DifficultyCard
                key={row.id}
                row={row}
                affordable={walletCoins >= row.entry_fee_coins}
                levelLocked={playerLevel < row.required_level}
                busy={busyId === row.id}
                onPlay={() =>
                  onSelect({
                    tableConfigId: row.id,
                    displayName: row.display_name,
                    entryFeeCoins: row.entry_fee_coins,
                    turnSeconds: row.turn_seconds,
                    matchTarget: row.match_target,
                  })
                }
                onGetCoins={onGetCoins}
              />
            ))}
          </div>
        )}

        {/* Footer legend — two short tips. The "entry fee deducted
            on join" tip was dropped per user request; the entry-fee
            row on each card is already self-explanatory.
            Hidden on phones AND tablets (`hidden lg:grid`) so the
            5-card grid + header fit the viewport without scrolling.
            The stat icons + labels on each card are already self-
            explanatory; the legend is purely a nice-to-have on
            desktop. */}
        <div
          className="mt-3 hidden gap-3 rounded-xl border p-3 text-xs font-bold text-white/75 lg:mt-4 lg:grid lg:grid-cols-2 lg:p-4 lg:text-sm"
          style={{
            background: 'linear-gradient(180deg, #14100a 0%, #080604 100%)',
            borderColor: '#5a3a14',
          }}
        >
          <div className="flex items-start gap-3">
            <XpHexIcon />
            <span>Higher difficulty grants more XP per match.</span>
          </div>
          <div className="flex items-start gap-3">
            <ClockIcon />
            <span>Time to move is the total time you have for each turn.</span>
          </div>
        </div>

        {/* Matchmaking overlay — unchanged. Mounts over the card grid
            while the parent polls find_match_in_tier. */}
        {matchmaking?.searchingForTier ? (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-black/85 backdrop-blur-sm">
            {/* Compact self-contained dialog — the matchmaking state has little
                content, so it reads as a small popup rather than filling the
                whole room frame. */}
            <div className="flex w-[min(86vw,20rem)] flex-col items-center gap-4 rounded-2xl border border-emerald-400/25 bg-gradient-to-b from-[#0c1c1a] to-[#050d10] px-7 py-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
              <div className="relative grid h-16 w-16 place-items-center">
                <span className="absolute inset-0 animate-ping rounded-full border-2 border-emerald-300/40" />
                <span className="absolute inset-2 animate-pulse rounded-full border-2 border-emerald-400/60" />
                <span className="relative font-display text-lg font-black text-emerald-200">vs</span>
              </div>
              <div>
                <div className="font-display text-2xl font-black uppercase tracking-[0.18em] text-emerald-200">
                  Finding opponent
                </div>
                <div className="mt-1 text-sm font-bold text-emerald-100/70">
                  {matchmaking.tierDisplayName} room ·{' '}
                  {Math.ceil(Math.max(0, matchmaking.maxSeconds - matchmaking.elapsedSeconds))}s
                </div>
              </div>
              <div className="h-1 w-48 overflow-hidden rounded-full bg-emerald-900/50">
                <div
                  className="h-full bg-emerald-400 transition-[width] duration-200"
                  style={{
                    width: `${Math.min(100, (matchmaking.elapsedSeconds / matchmaking.maxSeconds) * 100)}%`,
                  }}
                />
              </div>
              {onCancelMatchmaking ? (
                <button
                  type="button"
                  onClick={onCancelMatchmaking}
                  className="mt-2 rounded-md border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/[0.12]"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
