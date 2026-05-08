import Avatar from './Avatar';
import type { PlayerIdentity } from '../lib/identity';

interface Props {
  identity: PlayerIdentity | null;
  /** Pip count for this player, shown under the name. */
  pipCount?: number;
  /** Match score for this player ("0–0" style — formatted by parent). */
  scoreLabel?: string;
  /** True if it's this player's turn. Drives the avatar ring + a glow. */
  isTurn?: boolean;
  /** Stack of action chips below the avatar (auto-roll toggle, store, etc.). */
  bottomSlot?: React.ReactNode;
  /** Side this panel is anchored to — affects flex alignment. */
  side: 'left' | 'right';
}

const PLACEHOLDER_NAME = '— —';

/**
 * Vertical column with avatar + name + pip/score info on top, free-form
 * action chips on the bottom. Two of these flank the board.
 */
export default function SidePanel({
  identity,
  pipCount,
  scoreLabel,
  isTurn,
  bottomSlot,
  side,
}: Props) {
  const align = side === 'left' ? 'items-start' : 'items-end';
  const textAlign = side === 'left' ? 'text-left' : 'text-right';
  return (
    <aside
      className={`flex flex-col ${align} justify-between gap-3 py-2 px-2 sm:px-3 h-full min-w-0`}
    >
      <div className={`flex flex-col ${align} gap-2 min-w-0 w-full`}>
        <Avatar
          seed={identity?.avatarSeed ?? 'placeholder'}
          size={64}
          ring={isTurn ? 'active' : 'idle'}
          badge={identity?.badge}
        />
        <div className={`flex flex-col gap-0 ${textAlign} min-w-0 w-full`}>
          <div className="text-amber-50 font-display text-sm sm:text-base truncate leading-tight">
            {identity?.name ?? PLACEHOLDER_NAME}
          </div>
          {pipCount !== undefined && (
            <div className="text-[11px] text-amber-200/60 font-mono">pip {pipCount}</div>
          )}
          {scoreLabel && (
            <div className="text-[11px] text-amber-300/80 font-mono mt-0.5">{scoreLabel}</div>
          )}
        </div>
      </div>
      {bottomSlot && (
        <div className={`flex flex-col ${align} gap-2 w-full`}>{bottomSlot}</div>
      )}
    </aside>
  );
}
