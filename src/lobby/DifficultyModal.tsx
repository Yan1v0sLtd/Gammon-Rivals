import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { formatCompactNumber } from '../lib/format';
import type { Database } from '../types/database';

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

interface DifficultyModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Called when the user picks a tier. The parent is responsible for
   * calling the enter_room RPC and navigating — keeping that out of the
   * modal lets the parent show a route-level loading overlay during the
   * RPC. The modal's only job is presentation + selection.
   */
  readonly onSelect: (selection: DifficultySelection) => void;
  /** Wallet coins, shown on each card so the player can see whether
   *  they can afford the entry fee before tapping SELECT. */
  readonly walletCoins: number;
  /** Used to dim cards the player isn't high enough level for. */
  readonly playerLevel: number;
  /** While the parent's enter_room call is in flight, busyId is the
   *  table_config_id being purchased so we can disable just that card. */
  readonly busyId: string | null;
}

/**
 * Accent slug → Tailwind classes. Slugs live in the DB
 * (table_configs.accent_color) so a new tier can pick its colour
 * without a code change; if a slug isn't in this map the card falls
 * back to the gold styling.
 */
const ACCENTS: Record<
  string,
  {
    frame: string;
    headerText: string;
    chipText: string;
    button: string;
    glow: string;
  }
> = {
  green: {
    frame: 'border-emerald-500/60',
    headerText: 'text-emerald-300',
    chipText: 'text-emerald-300',
    button: 'from-emerald-400 to-emerald-700 border-emerald-900/60',
    glow: 'shadow-[0_0_24px_-4px_rgba(16,185,129,0.55)]',
  },
  blue: {
    frame: 'border-sky-400/60',
    headerText: 'text-sky-300',
    chipText: 'text-sky-300',
    button: 'from-sky-400 to-sky-700 border-sky-900/60',
    glow: 'shadow-[0_0_24px_-4px_rgba(56,189,248,0.55)]',
  },
  purple: {
    frame: 'border-violet-400/70',
    headerText: 'text-violet-300',
    chipText: 'text-violet-300',
    button: 'from-violet-400 to-violet-700 border-violet-900/60',
    glow: 'shadow-[0_0_24px_-4px_rgba(167,139,250,0.55)]',
  },
  red: {
    frame: 'border-rose-400/60',
    headerText: 'text-rose-300',
    chipText: 'text-rose-300',
    button: 'from-rose-400 to-rose-700 border-rose-900/60',
    glow: 'shadow-[0_0_24px_-4px_rgba(244,114,182,0.55)]',
  },
  gold: {
    frame: 'border-amber-400/70',
    headerText: 'text-amber-300',
    chipText: 'text-amber-300',
    button: 'from-amber-400 to-amber-700 border-amber-900/60',
    glow: 'shadow-[0_0_24px_-4px_rgba(251,191,36,0.55)]',
  },
};

function accent(slug: string) {
  return ACCENTS[slug] ?? ACCENTS.gold!;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s} Sec`;
  if (s % 60 === 0) return `${s / 60} Min`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function XpHexBadge({ accentSlug }: { accentSlug: string }) {
  const palette = accent(accentSlug);
  return (
    <svg
      viewBox="0 0 40 44"
      className={`h-7 w-7 drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]`}
      aria-hidden="true"
    >
      <polygon points="20,2 38,12 38,32 20,42 2,32 2,12" className={`fill-current ${palette.headerText}`} opacity="0.85" />
      <polygon points="20,5 35,13.5 35,30.5 20,39 5,30.5 5,13.5" fill="#1d1233" />
      <text
        x="20"
        y="27"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="13"
        fill="#fcd34d"
      >
        XP
      </text>
    </svg>
  );
}

function StarBadge() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]" aria-hidden="true">
      <defs>
        <linearGradient id="diff-star-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#diff-star-fill)" stroke="#7c2d12" strokeWidth="1" />
      <polygon
        points="12,5 14,10 19,10.5 15,14 16,19 12,16.5 8,19 9,14 5,10.5 10,10"
        fill="#fff"
        stroke="#7c2d12"
        strokeWidth="0.6"
      />
    </svg>
  );
}

function ClockBadge() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#fde68a" stroke="#7c2d12" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="12" y2="6" stroke="#7c2d12" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="12" x2="16" y2="14" stroke="#7c2d12" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface CardProps {
  readonly row: TableConfigRow;
  readonly affordable: boolean;
  readonly levelMet: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
}

function DifficultyCard({ row, affordable, levelMet, busy, onSelect }: CardProps) {
  const palette = accent(row.accent_color);
  const disabledReason = !levelMet
    ? `Reach level ${row.required_level} to unlock`
    : !affordable
      ? 'Not enough coins'
      : null;
  const disabled = disabledReason !== null || busy;
  return (
    <div
      className={`relative flex flex-col rounded-2xl border-2 ${palette.frame} bg-gradient-to-b from-[#231a16]/95 to-[#0d0805]/95 p-3 ${
        disabled ? 'opacity-60 saturate-50' : palette.glow
      }`}
    >
      <h3
        className={`text-center font-display text-base font-black uppercase tracking-[0.18em] ${palette.headerText}`}
      >
        {row.display_name}
      </h3>

      <div className="mt-2 grid gap-2 rounded-xl bg-[#fdf6e3]/95 p-2 text-[#3a1f08]">
        {/* XP boost row */}
        <div className="flex items-center gap-2 rounded-lg bg-[#f4e7c5]/70 px-2 py-1">
          <XpHexBadge accentSlug={row.accent_color} />
          <div className="min-w-0 flex-1">
            <div className="text-[0.55rem] font-bold uppercase tracking-wider text-amber-900/70">XP Boost</div>
            <div className={`font-display text-base font-black tabular-nums ${palette.chipText}`}>
              {row.xp_multiplier_pct}%
            </div>
          </div>
        </div>
        {/* Entry fee row */}
        <div className="flex items-center gap-2 rounded-lg bg-[#f4e7c5]/70 px-2 py-1">
          <StarBadge />
          <div className="min-w-0 flex-1">
            <div className="text-[0.55rem] font-bold uppercase tracking-wider text-amber-900/70">Entry Fee</div>
            <div className="font-display text-base font-black tabular-nums text-amber-900">
              {formatCompactNumber(row.entry_fee_coins)}
            </div>
          </div>
        </div>
        {/* Turn time row */}
        <div className="flex items-center gap-2 rounded-lg bg-[#f4e7c5]/70 px-2 py-1">
          <ClockBadge />
          <div className="min-w-0 flex-1">
            <div className="text-[0.55rem] font-bold uppercase tracking-wider text-amber-900/70">Time to Move</div>
            <div className={`font-display text-base font-black tabular-nums ${palette.chipText}`}>
              {formatSeconds(row.turn_seconds)}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        title={disabledReason ?? undefined}
        className={`mt-3 rounded-md border bg-gradient-to-b ${palette.button} py-2 font-display text-sm font-black uppercase tracking-[0.18em] text-white shadow-md transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0`}
      >
        {busy ? 'Entering...' : 'Select'}
      </button>
    </div>
  );
}

export function DifficultyModal({
  open,
  onClose,
  onSelect,
  walletCoins,
  playerLevel,
  busyId,
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

  // Esc to close. Mounted as an effect so we don't add the listener
  // while the modal is closed.
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select room difficulty"
    >
      <div
        className="relative w-[min(96vw,72rem)] max-h-[92vh] overflow-y-auto rounded-3xl border-2 border-[#c89a47] bg-gradient-to-b from-[#1d1612] via-[#0f0a08] to-[#070403] p-5 shadow-[0_30px_60px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative mb-4 flex items-center justify-center">
          <h2 className="bg-gradient-to-b from-[#fcd34d] via-[#d97706] to-[#7c2d12] bg-clip-text font-display text-3xl font-black uppercase tracking-[0.22em] text-transparent md:text-4xl">
            Select Room Difficulty
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-0 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] to-[#0c0908] text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition hover:brightness-110 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="-mt-2 mb-4 text-center text-sm font-bold text-amber-200/75">
          Choose your challenge and enter the arena
        </p>

        {error ? (
          <div className="grid place-items-center py-12 text-amber-200/80">{error}</div>
        ) : loading ? (
          <div className="grid place-items-center py-12 text-amber-200/60">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center py-12 text-amber-200/60">
            No difficulties configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {rows.map((row) => (
              <DifficultyCard
                key={row.id}
                row={row}
                affordable={walletCoins >= row.entry_fee_coins}
                levelMet={playerLevel >= row.required_level}
                busy={busyId === row.id}
                onSelect={() =>
                  onSelect({
                    tableConfigId: row.id,
                    displayName: row.display_name,
                    entryFeeCoins: row.entry_fee_coins,
                    turnSeconds: row.turn_seconds,
                    matchTarget: row.match_target,
                  })
                }
              />
            ))}
          </div>
        )}

        {/* Footer legend */}
        <div className="mt-5 grid gap-2 rounded-xl border border-amber-300/30 bg-[#1a1208]/70 p-3 text-xs font-bold text-amber-100/80 md:grid-cols-3">
          <div className="flex items-center gap-2">
            <XpHexBadge accentSlug="purple" />
            <span>Higher difficulty grants more XP for your victories.</span>
          </div>
          <div className="flex items-center gap-2">
            <StarBadge />
            <span>Entry fee is deducted from your balance when you join the room.</span>
          </div>
          <div className="flex items-center gap-2">
            <ClockBadge />
            <span>Time to move is the total time you have for each turn.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
