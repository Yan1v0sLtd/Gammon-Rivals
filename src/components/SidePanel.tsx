import Avatar from './Avatar';
import TurnTimerBar from './TurnTimerBar';
import type { PlayerIdentity } from '../lib/identity';

interface Props {
  identity: PlayerIdentity | null;
  /** Pip count for this player, shown under the name. */
  pipCount?: number;
  /** Match score for this player ("0–0" style — formatted by parent). */
  scoreLabel?: string;
  level?: number;
  stateLabel?: string;
  coinsLabel?: string;
  /** True if it's this player's turn. Drives the avatar ring + a glow. */
  isTurn?: boolean;
  timerProgress?: number;
  timerSecondsLeft?: number;
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

function firstNameOnly(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return PLACEHOLDER_NAME;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/**
 * Vertical column with avatar + name + pip/score info on top, free-form
 * action chips on the bottom. Two of these flank the board.
 */
export default function SidePanel({
  identity,
  pipCount,
  scoreLabel,
  level = 23,
  stateLabel = 'Rookie',
  coinsLabel = '400',
  isTurn,
  timerProgress,
  timerSecondsLeft,
  hudSlot,
  bottomSlot,
  side,
  compact = false,
}: Props) {
  const align = side === 'left' ? 'items-start' : 'items-end';
  const textAlign = side === 'left' ? 'text-left' : 'text-right';
  const avatarSize = compact ? 66 : 106;
  const innerAvatarSize = Math.round(avatarSize * 0.66);
  const hudOffset = avatarSize + (compact ? 6 : 12);
  const hudStyle =
    side === 'left'
      ? { left: hudOffset, top: avatarSize / 2, transform: 'translateY(-50%)' }
      : { right: hudOffset, top: avatarSize / 2, transform: 'translateY(-50%)' };
  const displayName = firstNameOnly(identity?.name);

  if (!compact) {
    return (
      <aside
        className={`game-player-panel game-player-panel--${side} ${
          isTurn ? 'is-turn' : ''
        }`}
      >
        <section className="game-player-card">
          <div className="game-player-card-glow" />
          <div className="game-player-top">
            <div className="game-avatar-stage">
              <div className="game-avatar-ring" />
              <Avatar
                seed={identity?.avatarSeed ?? 'placeholder'}
                imageUrl={identity?.avatarUrl}
                size={104}
                ring="none"
                className="game-avatar-image"
              />
              <span className="game-level-shield">{level}</span>
            </div>

            <div className={`game-player-identity ${textAlign}`}>
              <h2>{displayName}</h2>
              <div className="game-player-line">
                <span className="game-meta-icon game-meta-icon--level">★</span>
                <span>Level {level}</span>
              </div>
              <div className="game-player-line">
                <span className="game-meta-flag" />
                <span>{stateLabel}</span>
              </div>
              <div className="game-player-line">
                <span className="game-meta-icon game-meta-icon--coin">$</span>
                <span>{coinsLabel}</span>
              </div>
            </div>
          </div>

          <div className="game-stat-list">
            <div className="game-stat-row">
              <span className="game-stat-icon game-stat-icon--dice" />
              <span className="game-stat-copy">
                <span className="game-stat-label">Pip Count</span>
                <strong>{pipCount ?? '—'}</strong>
              </span>
            </div>
            <div className="game-stat-row">
              <span className="game-stat-icon game-stat-icon--score" />
              <span className="game-stat-copy">
                <span className="game-stat-label">Score</span>
                <strong>{scoreLabel ?? '0/7'}</strong>
              </span>
            </div>
          </div>

          {isTurn && timerProgress !== undefined && timerSecondsLeft !== undefined && (
            <TurnTimerBar
              progress={timerProgress}
              secondsLeft={timerSecondsLeft}
            />
          )}
          {hudSlot && (
            <div className="pointer-events-none absolute z-30" style={hudStyle}>
              {hudSlot}
            </div>
          )}
        </section>
        {bottomSlot && <div className="game-panel-bottom">{bottomSlot}</div>}
      </aside>
    );
  }

  return (
    <aside
      className={`flex flex-col ${align} justify-between gap-3 ${
        compact
          ? `w-full max-w-[10.75rem] overflow-hidden p-0 ${
              side === 'right' ? 'justify-self-end' : 'justify-self-start'
            }`
          : 'py-2 px-2 sm:px-3'
      } h-full min-w-0`}
    >
      <div className={`relative flex flex-col ${align} gap-2 min-w-0 w-full`}>
        <div
          className={`relative grid shrink-0 place-items-center ${
            isTurn ? 'drop-shadow-[0_0_18px_rgba(255,211,77,0.38)]' : ''
          }`}
          style={{ width: avatarSize, height: avatarSize }}
        >
          <div className="absolute inset-[17%] rounded-full bg-gradient-to-b from-[#fff2bd] to-[#68411f]" />
          <Avatar
            seed={identity?.avatarSeed ?? 'placeholder'}
            imageUrl={identity?.avatarUrl}
            size={innerAvatarSize}
            ring="none"
            className="relative z-10"
          />
          <img
            src="/lobby/icons/avatar-frame.webp"
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          <span
            className={`absolute bottom-[8%] right-[9%] z-20 grid place-items-center rounded-full border border-[#ffd56c] bg-[#19233a] font-black text-[#ffe9a5] shadow-[0_2px_5px_rgba(0,0,0,0.42)] ${
              compact ? 'h-5 min-w-5 px-1 text-[0.62rem]' : 'h-7 min-w-7 px-1 text-sm'
            }`}
          >
            {level}
          </span>
        </div>
        <div className={`flex flex-col gap-1 ${textAlign} min-w-0 w-full`}>
          <div
            className={`text-amber-50 font-display truncate leading-tight ${
              compact ? 'max-w-[10rem] text-sm' : 'text-lg sm:text-xl'
            }`}
          >
            {displayName}
          </div>
          <div
            className={`grid w-full gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${
              compact ? 'text-[0.65rem]' : 'text-xs'
            }`}
          >
            <div className={`flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-sky-500 text-[0.62rem] font-black text-white shadow">
                ★
              </span>
              <span className="font-black text-sky-100">Level {level}</span>
            </div>
            <div className={`flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}>
              <span className="grid h-4 w-4 place-items-center rounded-sm bg-gradient-to-r from-blue-700 via-yellow-300 to-red-600 shadow" />
              <span className="font-semibold text-white/80">{stateLabel}</span>
            </div>
            <div className={`flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}>
              <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-b from-yellow-200 to-amber-600 text-[0.6rem] font-black text-amber-950 shadow">
                $
              </span>
              <span className="font-black text-amber-100">{coinsLabel}</span>
            </div>
            {pipCount !== undefined && (
              <div className={`text-amber-200/70 ${side === 'right' ? 'text-right' : 'text-left'}`}>
                pip {pipCount}
              </div>
            )}
            {scoreLabel && (
              <div className={`font-black text-amber-300 ${side === 'right' ? 'text-right' : 'text-left'}`}>
                {scoreLabel}
              </div>
            )}
          </div>
          {isTurn && timerProgress !== undefined && timerSecondsLeft !== undefined && (
            <TurnTimerBar
              progress={timerProgress}
              secondsLeft={timerSecondsLeft}
              compact={compact}
            />
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
