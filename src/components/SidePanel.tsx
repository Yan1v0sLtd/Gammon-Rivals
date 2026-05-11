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
  /** Compact turn-adjacent visual, such as dice, rendered near the avatar. */
  hudSlot?: React.ReactNode;
  /** Stack of action chips below the avatar (auto-roll toggle, store, etc.). */
  bottomSlot?: React.ReactNode;
  /** Side this panel is anchored to — affects flex alignment. */
  side: 'left' | 'right';
  /** Compact HUD mode used on narrow mobile screens. */
  compact?: boolean;
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
  hudSlot,
  bottomSlot,
  side,
  compact = false,
}: Props) {
  const align = side === 'left' ? 'items-start' : 'items-end';
  const textAlign = side === 'left' ? 'text-left' : 'text-right';
  const avatarSize = compact ? 64 : 96;
  const hudOffset = avatarSize + (compact ? 6 : 12);
  const hudStyle =
    side === 'left'
      ? { left: hudOffset, top: avatarSize / 2, transform: 'translateY(-50%)' }
      : { right: hudOffset, top: avatarSize / 2, transform: 'translateY(-50%)' };
  return (
    <aside
      className={`flex flex-col ${align} justify-between gap-3 ${
        compact ? 'p-0' : 'py-2 px-2 sm:px-3'
      } h-full min-w-0`}
    >
      <div className={`relative flex flex-col ${align} gap-2 min-w-0 w-full`}>
        <Avatar
          seed={identity?.avatarSeed ?? 'placeholder'}
          size={avatarSize}
          ring={isTurn ? 'active' : 'idle'}
          badge={identity?.badge}
        />
        <div className={`flex flex-col gap-0 ${textAlign} min-w-0 w-full`}>
          <div
            className={`text-amber-50 font-display truncate leading-tight ${
              compact ? 'max-w-[10rem] text-sm' : 'text-base sm:text-lg'
            }`}
          >
            {identity?.name ?? PLACEHOLDER_NAME}
          </div>
          {pipCount !== undefined && (
            <div
              className={`${compact ? 'text-xs' : 'text-sm'} text-amber-200/70 font-medium`}
            >
              pip {pipCount}
            </div>
          )}
          {scoreLabel && (
            <div
              className={`${compact ? 'text-xs' : 'text-sm'} text-amber-300/85 font-medium mt-0.5`}
            >
              {scoreLabel}
            </div>
          )}
        </div>
        {hudSlot && (
          <div className="pointer-events-none absolute z-30" style={hudStyle}>
            {hudSlot}
          </div>
        )}
      </div>
      {bottomSlot && (
        <div className={`flex flex-col ${align} gap-2 w-full`}>{bottomSlot}</div>
      )}
    </aside>
  );
}
