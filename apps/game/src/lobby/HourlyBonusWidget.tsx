import { formatCooldown, useCountdownSeconds, type WheelStateResult } from './useWheelState';

interface Props {
  readonly result: WheelStateResult;
  readonly onClaim: () => void;
}

/**
 * The lobby nav's center slot: the hourly-bonus wheel graphic plus
 * a CSS pill underneath that switches between three states:
 *
 *   - Ready    → orange gradient "CLAIM" button (large label)
 *   - Cooldown → gold-trimmed pill with the HH:MM:SS countdown
 *   - Unavailable → grey pill with "UNAVAILABLE" text
 *
 * The graphic is the same on all three states; only the pill
 * changes. State transitions cross-fade via CSS so the player
 * sees the pill morph rather than swap abruptly.
 *
 * Click handling lives in the parent (LobbyScreen) so the modal
 * trigger / matchmaking overlays stay co-located with the rest of
 * the lobby modals.
 */
export function HourlyBonusWidget({ result, onClaim }: Props) {
  const { state, canSpin } = result;
  // The 1 Hz countdown ticks HERE (a few DOM nodes), not in useWheelState —
  // that hook is consumed by LobbyScreen, and ticking it re-rendered the
  // entire lobby tree every second (a permanent CPU tax on phones).
  const secondsUntilSpin = useCountdownSeconds(state?.next_spin_at ?? null);

  const pillKind: 'ready' | 'cooldown' | 'unavailable' =
    !state || !state.is_enabled
      ? 'unavailable'
      : canSpin
        ? 'ready'
        : 'cooldown';

  return (
    <div className="lobby-hourly-bonus" aria-label="Hourly bonus wheel">
      {/* Pre-rendered wheel + frame asset. Tap target is the whole
          widget — clicking the image is identical to clicking the
          pill when ready (better discoverability on touch). */}
      <button
        type="button"
        className={`lobby-hourly-bonus-image ${pillKind === 'ready' ? 'is-ready' : ''}`}
        onClick={pillKind === 'ready' ? onClaim : undefined}
        disabled={pillKind !== 'ready'}
        aria-label={
          pillKind === 'ready'
            ? 'Claim hourly bonus'
            : pillKind === 'cooldown'
              ? `Next bonus in ${formatCooldown(secondsUntilSpin)}`
              : 'Hourly bonus unavailable'
        }
      >
        <img src="/lobby/HourlyBonusFinal.webp" alt="" draggable={false} />
      </button>

      {pillKind === 'ready' ? (
        <button
          type="button"
          className="lobby-hourly-bonus-pill is-ready"
          onClick={onClaim}
        >
          Claim
        </button>
      ) : pillKind === 'cooldown' ? (
        <div className="lobby-hourly-bonus-pill is-cooldown" aria-live="polite">
          {formatCooldown(secondsUntilSpin)}
        </div>
      ) : (
        <div className="lobby-hourly-bonus-pill is-unavailable">
          Unavailable
        </div>
      )}
    </div>
  );
}
