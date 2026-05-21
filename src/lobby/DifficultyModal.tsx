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
  title: string;
  stat: string;
  statBorder: string;
  selectTop: string;
  selectBot: string;
  heroGrad: string;
  halo: string;
}

const PALETTES: Record<string, TierPalette> = {
  green: {
    title: '#16a34a',
    stat: '#22c55e',
    statBorder: '#16a34a',
    selectTop: '#16a34a',
    selectBot: '#14532d',
    heroGrad:
      'radial-gradient(circle at 50% 35%, #1f6b3a 0%, #082514 70%)',
    halo: '0 0 28px -8px rgba(34,197,94,0.55)',
  },
  blue: {
    title: '#2563eb',
    stat: '#3b82f6',
    statBorder: '#1d4ed8',
    selectTop: '#1d4ed8',
    selectBot: '#1e3a8a',
    heroGrad:
      'radial-gradient(circle at 50% 35%, #1e3a8a 0%, #0b1530 70%)',
    halo: '0 0 28px -8px rgba(59,130,246,0.55)',
  },
  purple: {
    title: '#9333ea',
    stat: '#a855f7',
    statBorder: '#7e22ce',
    selectTop: '#7e22ce',
    selectBot: '#4c1d95',
    heroGrad:
      'radial-gradient(circle at 50% 35%, #6b21a8 0%, #2b0a4a 70%)',
    halo: '0 0 28px -8px rgba(168,85,247,0.55)',
  },
  red: {
    title: '#dc2626',
    stat: '#ef4444',
    statBorder: '#b91c1c',
    selectTop: '#b91c1c',
    selectBot: '#7f1d1d',
    heroGrad:
      'radial-gradient(circle at 50% 35%, #991b1b 0%, #3b0a0a 70%)',
    halo: '0 0 28px -8px rgba(239,68,68,0.55)',
  },
  gold: {
    title: '#b45309',
    stat: '#f59e0b',
    statBorder: '#b45309',
    selectTop: '#b45309',
    selectBot: '#78350f',
    heroGrad:
      'radial-gradient(circle at 50% 35%, #b45309 0%, #2b1a05 70%)',
    halo: '0 0 28px -8px rgba(251,191,36,0.55)',
  },
};

function paletteFor(slug: string): TierPalette {
  return PALETTES[slug] ?? PALETTES.gold!;
}

/* Default headline copy per tier — used when table_configs.description
 * is empty. Short, evocative, matches the in-image text on the
 * provided hero artwork. */
const DEFAULT_HEADLINES: Record<string, string> = {
  green: 'Good moves, good friends, great games.',
  blue: 'Strategy. Discipline. Patience. Victory.',
  purple: 'High stakes. VIP only.',
  red: 'Elite challengers welcome.',
  gold: 'Legends are not born — they are made.',
};

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
  // Layer the per-tier image OVER the tier gradient. If the .webp
  // file is missing, the browser silently drops the image layer and
  // the gradient shows — no broken-image icon. Operators can swap
  // images per tier without redeploying by setting
  // metadata.heroImage in the BO Difficulties section.
  //
  // Path convention: strip the `difficulty-` prefix so the seed's
  // row.id `difficulty-grand-master` resolves to the cleaner asset
  // path `/lobby/difficulties/grand-master.webp`. Operators
  // creating custom tiers without that prefix get their bare id
  // used as-is.
  const heroSlug = row.id.startsWith('difficulty-')
    ? row.id.slice('difficulty-'.length)
    : row.id;
  const heroPath = heroOverride ?? `/lobby/difficulties/${heroSlug}.webp`;
  const heroStyle: React.CSSProperties = {
    backgroundImage: `url("${heroPath}"), ${palette.heroGrad}`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };

  const description =
    (row.description && row.description.trim().length > 0
      ? row.description
      : DEFAULT_HEADLINES[row.accent_color] ?? '');

  const buttonDisabled = busy || levelLocked;
  const buttonLabel = levelLocked
    ? `Unlocks at Lv ${row.required_level}`
    : busy
      ? 'Searching…'
      : affordable
        ? 'Select'
        : 'Get Coins';

  // Locked / unaffordable states swap the SELECT bar's palette so
  // the CTA's colour matches its intent (grey = locked, orange =
  // shop nudge, tier-colour = ready-to-play).
  const selectBg = levelLocked
    ? 'linear-gradient(180deg, #64748b 0%, #1e293b 100%)'
    : !affordable
      ? 'linear-gradient(180deg, #ea580c 0%, #7c2d12 100%)'
      : `linear-gradient(180deg, ${palette.selectTop} 0%, ${palette.selectBot} 100%)`;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl bg-[#fdfaf3]"
      style={{
        // Featured tier (middle of the row) gets a brighter halo +
        // gentle scale lift to signal "this is the spotlight".
        boxShadow: featured
          ? `0 0 32px -2px rgba(252,211,77,0.7), 0 18px 30px rgba(0,0,0,0.55)`
          : `${palette.halo}, 0 14px 26px rgba(0,0,0,0.55)`,
        transform: featured ? 'scale(1.04)' : undefined,
        zIndex: featured ? 1 : 0,
      }}
    >
      {/* Hero panel — the per-tier room image. Aspect-ratio is
          locked so all five cards stay perfectly aligned regardless
          of the source image's intrinsic size. */}
      <div
        className="w-full"
        style={{
          ...heroStyle,
          aspectRatio: '4 / 3',
        }}
        aria-hidden
      />

      {/* Title block — tier name in colour over a cream body, with
          a short headline beneath. Centred to match the reference
          Clash-card composition. */}
      <div className="flex flex-col items-center px-4 pt-3 pb-2 text-center">
        <div
          className="font-display text-xl font-black uppercase tracking-[0.16em] sm:text-2xl"
          style={{ color: palette.title }}
        >
          {row.display_name}
        </div>
        <div className="mt-1.5 line-clamp-2 text-[0.72rem] font-bold leading-snug text-stone-600 sm:text-xs">
          {description}
        </div>
      </div>

      {/* Stats strip — solid tier colour, 3 equal columns with
          slightly-darker dividers between them. Values stay BIG and
          labels small + uppercase, matching the reference. */}
      <div
        className="grid grid-cols-3 text-center text-white"
        style={{ background: palette.stat }}
      >
        <div className="px-2 py-3" style={{ borderRight: `1px solid ${palette.statBorder}` }}>
          <div className="font-display text-base font-black leading-none sm:text-lg">
            {row.xp_multiplier_pct}%
          </div>
          <div className="mt-1 text-[0.55rem] font-bold uppercase tracking-[0.14em] opacity-90 sm:text-[0.6rem]">
            XP Boost
          </div>
        </div>
        <div className="px-2 py-3" style={{ borderRight: `1px solid ${palette.statBorder}` }}>
          <div className="font-display text-base font-black leading-none tabular-nums sm:text-lg">
            {formatCompactNumber(row.entry_fee_coins)}
          </div>
          <div className="mt-1 text-[0.55rem] font-bold uppercase tracking-[0.14em] opacity-90 sm:text-[0.6rem]">
            Entry Fee
          </div>
        </div>
        <div className="px-2 py-3">
          <div className="font-display text-base font-black leading-none tabular-nums sm:text-lg">
            {formatSeconds(row.turn_seconds)}
          </div>
          <div className="mt-1 text-[0.55rem] font-bold uppercase tracking-[0.14em] opacity-90 sm:text-[0.6rem]">
            Time to Move
          </div>
        </div>
      </div>

      {/* SELECT footer — darker tier gradient (or grey / orange in
          the locked / unaffordable cases). Acts as the primary CTA;
          the rest of the card is information. */}
      <button
        type="button"
        onClick={levelLocked ? undefined : affordable ? onPlay : onGetCoins}
        disabled={buttonDisabled}
        className="font-display py-3 text-center text-base font-black uppercase tracking-[0.22em] text-white transition active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 hover:brightness-110"
        style={{
          background: selectBg,
          opacity: buttonDisabled && !levelLocked ? 0.65 : 1,
        }}
      >
        {buttonLabel}
      </button>
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm p-4"
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
        {/* Header */}
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
          <div className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">
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

        {/* Footer legend — three short tips matching the reference's
            information density. Cream/dark contrast so the legend
            visually anchors the dark frame without pulling focus
            from the bright cards. */}
        <div
          className="mt-6 grid gap-3 rounded-xl border p-4 text-xs font-bold text-white/75 md:grid-cols-3 md:text-sm"
          style={{
            background: 'linear-gradient(180deg, #14100a 0%, #080604 100%)',
            borderColor: '#5a3a14',
          }}
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: '#a855f7' }}>
              <strong className="text-[0.6rem]">XP</strong>
            </span>
            <span>Higher difficulty grants more XP for your victories.</span>
          </div>
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-amber-900" style={{ background: 'linear-gradient(180deg, #fde68a, #f59e0b)' }}>
              ★
            </span>
            <span>Entry fee is deducted from your balance when you join the room.</span>
          </div>
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-amber-900 text-base" style={{ background: 'linear-gradient(180deg, #fde68a, #f59e0b)' }}>
              ⏱
            </span>
            <span>Time to move is the total time you have for each turn.</span>
          </div>
        </div>

        {/* Matchmaking overlay — unchanged. Mounts over the card grid
            while the parent polls find_match_in_tier. */}
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
