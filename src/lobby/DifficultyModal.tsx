import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { formatCompactNumber } from '../lib/format';
import type { Database, Json } from '../types/database';

/**
 * Server row shape we need. We only read enabled difficulty rows
 * (kind = 'difficulty') so the lobby grid stays clean even if BO
 * operators add half-built rows.
 */
type TableConfigRow = Database['public']['Tables']['table_configs']['Row'];

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
/* Per-tier accent palettes                                                   */
/*                                                                            */
/* Each accent slug (stored on table_configs.accent_color so a new tier can   */
/* pick its colour without a code change) maps to a full visual palette:      */
/*   - title  → hex used for the tier display name                            */
/*   - value  → hex used for the stat numbers                                 */
/*   - btnTop / btnBot → gradient stops for the SELECT button                 */
/*   - heroGrad → fallback gradient when no /lobby/difficulties/{id}.webp     */
/*                hero image is provided yet                                  */
/*   - shadow → ambient glow under the card                                   */
/* -------------------------------------------------------------------------- */

interface TierPalette {
  title: string;
  value: string;
  btnTop: string;
  btnBot: string;
  btnBorder: string;
  heroGrad: string;
  shadow: string;
}

const PALETTES: Record<string, TierPalette> = {
  green: {
    title: '#4ade80',
    value: '#4ade80',
    btnTop: '#22c55e',
    btnBot: '#14532d',
    btnBorder: 'rgba(187,247,208,0.9)',
    heroGrad:
      'linear-gradient(180deg, rgba(8,30,17,0.0) 0%, rgba(4,16,10,0.65) 100%), radial-gradient(circle at 50% 30%, #1f6b3a 0%, #082514 70%)',
    shadow: '0 0 28px -8px rgba(34,197,94,0.55)',
  },
  blue: {
    title: '#60a5fa',
    value: '#60a5fa',
    btnTop: '#3b82f6',
    btnBot: '#1e3a8a',
    btnBorder: 'rgba(191,219,254,0.9)',
    heroGrad:
      'linear-gradient(180deg, rgba(7,16,33,0.0) 0%, rgba(4,9,20,0.65) 100%), radial-gradient(circle at 50% 30%, #1e3a8a 0%, #0b1530 70%)',
    shadow: '0 0 28px -8px rgba(59,130,246,0.55)',
  },
  purple: {
    title: '#c084fc',
    value: '#c084fc',
    btnTop: '#a855f7',
    btnBot: '#581c87',
    btnBorder: 'rgba(233,213,255,0.9)',
    heroGrad:
      'linear-gradient(180deg, rgba(28,9,42,0.0) 0%, rgba(12,5,22,0.65) 100%), radial-gradient(circle at 50% 30%, #6b21a8 0%, #2b0a4a 70%)',
    shadow: '0 0 28px -8px rgba(168,85,247,0.55)',
  },
  red: {
    title: '#f87171',
    value: '#f87171',
    btnTop: '#ef4444',
    btnBot: '#7f1d1d',
    btnBorder: 'rgba(254,202,202,0.9)',
    heroGrad:
      'linear-gradient(180deg, rgba(37,10,12,0.0) 0%, rgba(16,6,8,0.65) 100%), radial-gradient(circle at 50% 30%, #991b1b 0%, #3b0a0a 70%)',
    shadow: '0 0 28px -8px rgba(239,68,68,0.55)',
  },
  gold: {
    title: '#fcd34d',
    value: '#fcd34d',
    btnTop: '#fbbf24',
    btnBot: '#92400e',
    btnBorder: 'rgba(254,243,199,0.9)',
    heroGrad:
      'linear-gradient(180deg, rgba(42,28,8,0.0) 0%, rgba(18,12,4,0.65) 100%), radial-gradient(circle at 50% 30%, #b45309 0%, #2b1a05 70%)',
    shadow: '0 0 28px -8px rgba(251,191,36,0.55)',
  },
};

function paletteFor(slug: string): TierPalette {
  return PALETTES[slug] ?? PALETTES.gold!;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s} Sec`;
  if (s % 60 === 0) return `${s / 60} Min`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function metadataText(metadata: Json, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, Json>)[key];
  return typeof value === 'string' ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Icon components                                                            */
/* -------------------------------------------------------------------------- */

/** XP boost stat icon — a 6-sided badge with "XP" text. Tinted by the
 *  active tier so the icon matches the value colour below it. */
function XpHexBadge({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 40 44" className="h-9 w-9 shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]" aria-hidden>
      <polygon points="20,2 38,12 38,32 20,42 2,32 2,12" fill={colour} opacity="0.95" />
      <polygon points="20,5 35,13.5 35,30.5 20,39 5,30.5 5,13.5" fill="#0f0a1a" />
      <text
        x="20" y="27" textAnchor="middle"
        fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="13" fill="#fff"
      >XP</text>
    </svg>
  );
}

/** Entry-fee stat icon — gold coin with star centre. Static gold
 *  across all tiers so it reads as "currency" rather than a
 *  tier-specific decoration. */
function StarCoinBadge() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]" aria-hidden>
      <defs>
        <linearGradient id="diff-star-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="17" fill="url(#diff-star-bg)" stroke="#5a3413" strokeWidth="2" />
      <polygon
        points="20,8 23,16 32,16.8 25,22 27.4,30.5 20,25.6 12.6,30.5 15,22 8,16.8 17,16"
        fill="#fff8e1"
        stroke="#7c2d12"
        strokeWidth="0.6"
      />
    </svg>
  );
}

/** Time-to-move stat icon — analog clock face. Static gold so the
 *  three legend rows form a consistent visual trio. */
function ClockBadge() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]" aria-hidden>
      <circle cx="20" cy="20" r="17" fill="#fde68a" stroke="#5a3413" strokeWidth="2" />
      <circle cx="20" cy="20" r="13" fill="none" stroke="#7c2d12" strokeWidth="0.8" />
      <line x1="20" y1="20" x2="20" y2="10" stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="20" y1="20" x2="27" y2="23" stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="1.5" fill="#7c2d12" />
    </svg>
  );
}

/** Tier crest — small icon on a circular badge sitting at the top of
 *  each card. The symbol varies per tier and visually reinforces the
 *  difficulty's "vibe" (chips for beginner, drink for advanced,
 *  crown for pro, helmet for expert, laurel wreath for grand master).
 *
 *  All five share the same gold rim + dark interior so the strip of
 *  five crests reads as a set. */
function TierCrest({ accent }: { accent: string }) {
  const palette = paletteFor(accent);
  // Symbol path varies per tier. Each is sized to a 24×24 viewBox
  // so the crests all balance visually.
  let symbol: React.ReactNode = null;
  switch (accent) {
    case 'green':
      // Stacked poker chips — three flat ovals.
      symbol = (
        <g fill="none" stroke={palette.title} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="9" rx="6.5" ry="1.8" fill={palette.title} fillOpacity="0.18" />
          <ellipse cx="12" cy="13" rx="6.5" ry="1.8" fill={palette.title} fillOpacity="0.18" />
          <ellipse cx="12" cy="17" rx="6.5" ry="1.8" fill={palette.title} fillOpacity="0.32" />
        </g>
      );
      break;
    case 'blue':
      // Two overlapping chips — represents a higher-stakes table.
      symbol = (
        <g fill="none" stroke={palette.title} strokeWidth="1.8">
          <circle cx="9" cy="13" r="5.5" fill={palette.title} fillOpacity="0.25" />
          <circle cx="15" cy="13" r="5.5" fill={palette.title} fillOpacity="0.4" />
        </g>
      );
      break;
    case 'purple':
      // Crown — 3 peaks on a base. The "pro" / featured tier.
      symbol = (
        <g fill={palette.title} stroke={palette.title} strokeWidth="0.5" strokeLinejoin="round">
          <path d="M4 17 L6 8 L9 12 L12 6 L15 12 L18 8 L20 17 Z" />
          <rect x="4" y="17" width="16" height="2.5" />
        </g>
      );
      break;
    case 'red':
      // Knight helmet — simple silhouette.
      symbol = (
        <g fill={palette.title} stroke={palette.title} strokeWidth="0.5">
          <path d="M6 8 Q6 4 12 4 Q18 4 18 8 L18 14 Q18 17 16 18 L16 20 L8 20 L8 18 Q6 17 6 14 Z" fillOpacity="0.85" />
          <rect x="8" y="10" width="8" height="1.2" fill="#0f0a1a" />
        </g>
      );
      break;
    case 'gold':
    default:
      // Laurel wreath + crown for grand master.
      symbol = (
        <g fill={palette.title} stroke={palette.title} strokeWidth="0.5">
          <path d="M5 18 Q3 13 5 9 Q7 11 8 14 Q7 17 5 18 Z" />
          <path d="M19 18 Q21 13 19 9 Q17 11 16 14 Q17 17 19 18 Z" />
          <path d="M7 17 L9 9 L12 13 L15 9 L17 17 Z" />
        </g>
      );
      break;
  }
  return (
    <div
      className="relative grid h-14 w-14 place-items-center rounded-full border-[3px]"
      style={{
        background: 'radial-gradient(circle at 35% 30%, #2b2820 0%, #0a0805 75%)',
        borderColor: '#d3a04e',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 10px rgba(0,0,0,0.55)',
      }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-9 w-9 drop-shadow-[0_2px_3px_rgba(0,0,0,0.65)]">
        {symbol}
      </svg>
    </div>
  );
}

/** Four-corner gold bracket decoration. Used on the modal frame and
 *  on every SELECT button so the trim reads as a set. Each corner is
 *  a small L-shape drawn with two CSS borders on a fixed-size span.
 *  Pure presentational — `aria-hidden` so screen readers skip the
 *  decoration. */
function CornerBrackets({
  size = '0.7rem',
  thickness = '2px',
  colour = '#d3a04e',
  inset = '0.18rem',
}: {
  size?: string;
  thickness?: string;
  colour?: string;
  inset?: string;
}) {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    pointerEvents: 'none',
  };
  return (
    <>
      <span
        aria-hidden
        style={{
          ...base,
          top: inset,
          left: inset,
          borderTop: `${thickness} solid ${colour}`,
          borderLeft: `${thickness} solid ${colour}`,
        }}
      />
      <span
        aria-hidden
        style={{
          ...base,
          top: inset,
          right: inset,
          borderTop: `${thickness} solid ${colour}`,
          borderRight: `${thickness} solid ${colour}`,
        }}
      />
      <span
        aria-hidden
        style={{
          ...base,
          bottom: inset,
          left: inset,
          borderBottom: `${thickness} solid ${colour}`,
          borderLeft: `${thickness} solid ${colour}`,
        }}
      />
      <span
        aria-hidden
        style={{
          ...base,
          bottom: inset,
          right: inset,
          borderBottom: `${thickness} solid ${colour}`,
          borderRight: `${thickness} solid ${colour}`,
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

interface CardProps {
  readonly row: TableConfigRow;
  readonly affordable: boolean;
  readonly levelLocked: boolean;
  readonly busy: boolean;
  readonly featured: boolean;
  readonly onPlay: () => void;
  readonly onGetCoins: () => void;
}

function DifficultyCard({ row, affordable, levelLocked, busy, featured, onPlay, onGetCoins }: CardProps) {
  const palette = paletteFor(row.accent_color);
  const heroOverride = metadataText(row.metadata, 'heroImage');
  // The hero panel layers a (potentially missing) per-tier image
  // OVER the tier gradient. If the .webp file doesn't exist the
  // browser silently falls through to the gradient — no broken
  // <img> icon. Operators can override by setting metadata.heroImage
  // in the BO Difficulties section without redeploying the client.
  const heroPath = heroOverride ?? `/lobby/difficulties/${row.id}.webp`;
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
        ? 'Select'
        : 'Get Coins';

  // Gray-out the button when level-locked; otherwise honour the tier
  // palette (so SELECT reads as the tier colour). Get-Coins still
  // gets the orange palette so it stands apart from a normal SELECT.
  const buttonBg = levelLocked
    ? 'linear-gradient(180deg, #64748b 0%, #1e293b 100%)'
    : !affordable
      ? 'linear-gradient(180deg, #fbbf24 0%, #ea580c 100%)'
      : `linear-gradient(180deg, ${palette.btnTop} 0%, ${palette.btnBot} 100%)`;

  return (
    <div
      className="relative flex flex-col rounded-2xl border-2"
      style={{
        background: 'linear-gradient(180deg, #1a120a 0%, #0a0604 100%)',
        // Featured (centre) card gets a brighter gold rim + bigger
        // glow so it draws the eye.
        borderColor: featured ? '#fcd34d' : '#5a3a14',
        boxShadow: featured
          ? '0 0 32px -4px rgba(252,211,77,0.6), 0 14px 30px rgba(0,0,0,0.55)'
          : `${palette.shadow}, 0 14px 30px rgba(0,0,0,0.55)`,
        // Slight scale on the featured card matches the reference's
        // "this one is special" lift.
        transform: featured ? 'scale(1.04)' : undefined,
        zIndex: featured ? 1 : 0,
      }}
    >
      {/* Hero panel — image (or gradient fallback) for the top ~55%
          of the card. Crest sits absolutely on top of this panel so
          the rest of the card flow stays simple. */}
      <div
        className="relative h-44 w-full overflow-hidden rounded-t-2xl"
        style={heroStyle}
      >
        {/* Crest — sits at the top, half overlapping the rounded
            top edge of the hero. */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2">
          <TierCrest accent={row.accent_color} />
        </div>

        {/* Tier name centred below the crest, on the hero. */}
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <div
            className="inline-block font-display text-xl font-black uppercase tracking-[0.18em] drop-shadow-[0_3px_4px_rgba(0,0,0,0.75)]"
            style={{ color: palette.title }}
          >
            {row.display_name}
          </div>
        </div>
      </div>

      {/* Stats panel — 3 rows separated by hairline dividers. */}
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <XpHexBadge colour={palette.value} />
          <div className="min-w-0 flex-1">
            <div className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-white/55">XP Boost</div>
            <div
              className="font-display text-lg font-black tabular-nums"
              style={{ color: palette.value }}
            >
              {row.xp_multiplier_pct}%
            </div>
          </div>
        </div>

        <div className="h-px bg-white/8" />

        <div className="flex items-center gap-3">
          <StarCoinBadge />
          <div className="min-w-0 flex-1">
            <div className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-white/55">Entry Fee</div>
            <div
              className="font-display text-lg font-black tabular-nums"
              style={{ color: palette.value }}
            >
              {formatCompactNumber(row.entry_fee_coins)}
            </div>
          </div>
        </div>

        <div className="h-px bg-white/8" />

        <div className="flex items-center gap-3">
          <ClockBadge />
          <div className="min-w-0 flex-1">
            <div className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-white/55">Time to Move</div>
            <div
              className="font-display text-lg font-black tabular-nums"
              style={{ color: palette.value }}
            >
              {formatSeconds(row.turn_seconds)}
            </div>
          </div>
        </div>

        {/* SELECT button. Tier-coloured gradient + small gold
            corner brackets on the four corners to match the
            reference design. */}
        <button
          type="button"
          onClick={levelLocked ? undefined : affordable ? onPlay : onGetCoins}
          disabled={buttonDisabled}
          className="relative mt-3 rounded-md py-2.5 font-display text-base font-black uppercase tracking-[0.22em] text-white shadow-md transition active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 hover:brightness-110"
          style={{
            background: buttonBg,
            border: `2px solid ${levelLocked ? '#475569' : palette.btnBorder}`,
            opacity: buttonDisabled && !levelLocked ? 0.65 : 1,
          }}
        >
          {/* Gold corner brackets — same idiom as the outer modal
              frame, repeated here so the SELECT CTA visually echoes
              the parent. Hidden on the locked / unaffordable states
              because the gold accent would clash with their grey /
              orange palette. */}
          {!levelLocked && affordable ? (
            <CornerBrackets size="0.55rem" thickness="2px" colour="#fde68a" inset="0.2rem" />
          ) : null}
          <span className="relative z-10">{buttonLabel}</span>
        </button>
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
  const [rows, setRows] = useState<readonly TableConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isSupabaseConfigured) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void supabase
      .from('table_configs')
      .select('*')
      .eq('kind', 'difficulty')
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError('Could not load difficulties.');
          setLoading(false);
          return;
        }
        setRows((data ?? []) as readonly TableConfigRow[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Pick the "featured" card — middle of the visible row when there
  // are 5 tiers (matches the reference's centred Pro card). For other
  // counts, no featured card is highlighted.
  const featuredIndex = rows.length === 5 ? 2 : -1;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select room difficulty"
    >
      <div
        className="relative w-[min(96vw,80rem)] max-h-[94vh] overflow-y-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(70,42,12,0.45) 0%, rgba(8,5,3,0.92) 60%), linear-gradient(180deg, #100a06 0%, #050302 100%)',
          border: '3px solid #d3a04e',
          boxShadow:
            'inset 0 0 0 1px rgba(0,0,0,0.55), 0 30px 60px rgba(0,0,0,0.7)',
          padding: 'clamp(1rem, 2vw, 1.75rem)',
        }}
      >
        {/* Outer-frame corner brackets — same trim as the SELECT
            buttons so the modal reads as one styled family. */}
        <CornerBrackets size="1.6rem" thickness="3px" colour="#fcd34d" inset="0.55rem" />

        {/* Header — title + sparkle flourishes + subtitle + close. */}
        <div className="relative mb-6 flex flex-col items-center text-center">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-amber-300/70">✦</span>
            <h2 className="bg-gradient-to-b from-[#fde68a] via-[#fcd34d] to-[#a16207] bg-clip-text font-display text-3xl font-black uppercase tracking-[0.18em] text-transparent md:text-4xl">
              Select Room Difficulty
            </h2>
            <span className="text-2xl text-amber-300/70">✦</span>
          </div>
          <div className="mt-1 text-sm font-bold text-white/65 md:text-base">
            Choose your challenge and enter the arena
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-0 top-0 grid h-10 w-10 place-items-center rounded-full border-2 border-[#c89a47] bg-[#0c0908]/80 text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition hover:brightness-110 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error ? (
          <div className="grid place-items-center py-12 text-amber-200/80">{error}</div>
        ) : loading ? (
          <div className="grid place-items-center py-12 text-amber-200/60">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center py-12 text-amber-200/60">
            No difficulties configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">
            {rows.map((row, index) => (
              <DifficultyCard
                key={row.id}
                row={row}
                affordable={walletCoins >= row.entry_fee_coins}
                levelLocked={playerLevel < row.required_level}
                busy={busyId === row.id}
                featured={index === featuredIndex}
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

        {/* Footer legend — 3 tips matching the reference's layout
            (XP / Entry / Time). */}
        <div
          className="mt-6 grid gap-3 rounded-xl border p-4 text-xs font-bold text-white/75 md:grid-cols-3 md:text-sm"
          style={{
            background: 'linear-gradient(180deg, #14100a 0%, #080604 100%)',
            borderColor: '#5a3a14',
          }}
        >
          <div className="flex items-start gap-3">
            <XpHexBadge colour="#c084fc" />
            <span>Higher difficulty grants more XP for your victories.</span>
          </div>
          <div className="flex items-start gap-3">
            <StarCoinBadge />
            <span>Entry fee is deducted from your balance when you join the room.</span>
          </div>
          <div className="flex items-start gap-3">
            <ClockBadge />
            <span>Time to move is the total time you have for each turn.</span>
          </div>
        </div>

        {/* Matchmaking overlay. Unchanged from the previous design —
            renders inside the modal panel while the parent polls
            find_match_in_tier. */}
        {matchmaking?.searchingForTier ? (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-black/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 px-6 text-center">
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
                  {Math.max(0, matchmaking.maxSeconds - matchmaking.elapsedSeconds)}s
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
