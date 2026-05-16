import Avatar from './Avatar';
import TurnTimerBar from './TurnTimerBar';
import type { PlayerIdentity } from '../lib/identity';

interface Props {
  identity: PlayerIdentity | null;
  /** Pip count for this player, shown under the name. */
  pipCount?: number;
  /** Match score for this player ("0–0" style — formatted by parent). */
  scoreLabel?: string;
  /** Cube/double status for this player. */
  doublesLabel?: string;
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
  doublesLabel = '0',
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
  const avatarSize = compact ? 58 : 106;
  const innerAvatarSize = Math.round(avatarSize * 0.66);
  const hudOffset = avatarSize + (compact ? 6 : 12);
  const hudStyle =
    side === 'left'
      ? { left: hudOffset, top: avatarSize / 2, transform: 'translateY(-50%)' }
      : { right: hudOffset, top: avatarSize / 2, transform: 'translateY(-50%)' };
  const displayName = firstNameOnly(identity?.name);
  const playerArt =
    side === 'left'
      ? '/gameplay/premium-purple/left-player.webp'
      : '/gameplay/premium-purple/right-player.webp';

  if (!compact) {
    return (
      <aside
        className={`game-player-panel game-player-panel--${side} ${
          isTurn ? 'is-turn' : ''
        }`}
      >
        <section className="game-player-card">
          <img
            src={playerArt}
            alt=""
            className="game-player-frame-art"
            draggable={false}
          />
          <div className="game-player-card-glow" />
          <div className="game-player-top">
            <div className="game-avatar-stage">
              <div className="game-avatar-clip">
                <Avatar
                  seed={identity?.avatarSeed ?? 'placeholder'}
                  imageUrl={identity?.avatarUrl}
                  size={104}
                  ring="none"
                  className="game-avatar-image"
                />
              </div>
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
            <img
              src="/gameplay/premium-purple/player-stats.webp"
              alt=""
              className="game-player-stats-art"
              draggable={false}
            />
            <div className="game-stat-row game-stat-row--pip">
              <span className="game-stat-icon game-stat-icon--dice" />
              <span className="game-stat-copy">
                <span className="game-stat-label">Pip Count</span>
                <strong>{pipCount ?? '—'}</strong>
              </span>
            </div>
            <div className="game-stat-row game-stat-row--score">
              <span className="game-stat-icon game-stat-icon--score" />
              <span className="game-stat-copy">
                <span className="game-stat-label">Score</span>
                <strong>{scoreLabel ?? '0/7'}</strong>
              </span>
            </div>
            <div className="game-stat-row game-stat-row--doubles">
              <span className="game-stat-icon game-stat-icon--cube" />
              <span className="game-stat-copy">
                <span className="game-stat-label">Doubles</span>
                <strong>{doublesLabel}</strong>
              </span>
            </div>
          </div>

          {isTurn && timerProgress !== undefined && timerSecondsLeft !== undefined && (
            <TurnTimerBar
              progress={timerProgress}
              secondsLeft={timerSecondsLeft}
              side={side}
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
      className={`game-compact-panel game-player-panel--${side} ${isTurn ? 'is-turn' : ''} ${
        side === 'right' ? 'justify-self-end' : 'justify-self-start'
      }`}
    >
      <div className="game-compact-top">
        <div
          className="game-compact-avatar-stage"
          style={{ width: avatarSize, height: avatarSize }}
        >
          <Avatar
            seed={identity?.avatarSeed ?? 'placeholder'}
            imageUrl={identity?.avatarUrl}
            size={innerAvatarSize}
            ring="none"
            className="game-compact-avatar-image"
          />
          <span className="game-compact-level">
            {level}
          </span>
        </div>
        <div className={`game-compact-identity ${textAlign}`}>
          <div className="game-compact-name">
            {displayName}
          </div>
          <div className="game-compact-details">
            <div className="game-compact-line">
              <span className="game-compact-meta game-compact-meta--level">
                ★
              </span>
              <span>Level {level}</span>
            </div>
            <div className="game-compact-line">
              <span className="game-compact-meta game-compact-meta--flag" />
              <span>{stateLabel}</span>
            </div>
            <div className="game-compact-line">
              <span className="game-compact-meta game-compact-meta--coin">
                $
              </span>
              <span>{coinsLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="game-compact-stat-list">
        {pipCount !== undefined && (
          <div className="game-compact-stat-row">
            <span className="game-compact-stat-icon game-compact-stat-icon--dice" />
            <span className="game-compact-stat-copy">
              <span>Pip Count</span>
              <strong>{pipCount}</strong>
            </span>
          </div>
        )}
      {scoreLabel && (
        <div className="game-compact-stat-row">
            <span className="game-compact-stat-icon game-compact-stat-icon--score" />
            <span className="game-compact-stat-copy">
              <span>Score</span>
              <strong>{scoreLabel}</strong>
            </span>
        </div>
      )}
      <div className="game-compact-stat-row">
        <span className="game-compact-stat-icon game-compact-stat-icon--cube" />
        <span className="game-compact-stat-copy">
          <span>Doubles</span>
          <strong>{doublesLabel}</strong>
        </span>
      </div>
    </div>

      {isTurn && timerProgress !== undefined && timerSecondsLeft !== undefined && (
        <TurnTimerBar
          progress={timerProgress}
          secondsLeft={timerSecondsLeft}
          compact={compact}
          side={side}
        />
      )}
      {hudSlot && (
        <div className="pointer-events-none absolute z-30" style={hudStyle}>
          {hudSlot}
        </div>
      )}
      {bottomSlot && <div className={`flex flex-col ${align} gap-2 w-full`}>{bottomSlot}</div>}
    </aside>
  );
}
