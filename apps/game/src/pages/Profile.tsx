import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { skipToken } from '@reduxjs/toolkit/query/react';
import Avatar from '../components/Avatar';
import { useAuth } from '../lib/auth';
import { useShop } from '../features/appUi/useShop';
import { formatCompactNumber } from '../lib/format';
import {
  playerDataApi,
  useGetMatchHistoryQuery,
  useGetOwnerStatsQuery,
} from '../features/playerData/playerDataApi';
import type { MatchSummary } from '../lib/queries';
import { useAppDispatch } from '../store/hooks';

const MODE_LABEL: Record<string, string> = {
  hotseat: 'Hot-seat',
  'ai-easy': 'AI - Easy',
  'ai-medium': 'AI - Medium',
  'ai-hard': 'AI - Hard',
};

// Friends + Settings shortcuts removed from the Profile top bar
// (operator preference — those entry points live elsewhere).

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function ownerOutcome(m: MatchSummary): 'won' | 'lost' | 'open' | 'hotseat' {
  if (!m.finished_at) return 'open';
  if (m.mode === 'hotseat') return 'hotseat';
  return m.winner === 'white' ? 'won' : 'lost';
}

function modeIcon(mode: string): 'hotseat' | 'online' | 'ai' {
  if (mode === 'hotseat') return 'hotseat';
  if (mode.startsWith('ai-')) return 'ai';
  return 'online';
}

export default function Profile() {
  const {
    user,
    profile,
    wallet,
    progression,
    isLoading,
    setDisplayName,
    isGuest,
    linkGoogleIdentity,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { openShop } = useShop();
  const { data: stats } = useGetOwnerStatsQuery(user?.id ?? skipToken);
  const { data: matches, error: historyError } = useGetMatchHistoryQuery(
    user?.id ?? skipToken,
  );
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Reset the "Opening Google..." button state when the user returns to
  // the app. handleLinkGoogle sets linkingGoogle=true and kicks off the
  // OAuth flow; on a successful link the app redirects through
  // /auth/callback and this component remounts fresh. But if the user
  // opens the Google sheet and then CANCELS (no redirect fires), the
  // promise resolves without throwing and linkingGoogle would stick on
  // true forever — leaving the button stuck on "Opening Google..." and
  // disabled. Whenever the page becomes visible/focused again, clear it
  // so the button is clickable again. (If the link actually succeeded,
  // auth state refreshes, isGuest flips false, and the button is gone.)
  useEffect(() => {
    const reset = () => {
      if (document.visibilityState === 'visible') setLinkingGoogle(false);
    };
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('focus', reset);
    return () => {
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('focus', reset);
    };
  }, []);

  const startEditName = () => {
    setDraftName(profile?.display_name ?? '');
    setEditing(true);
  };

  const saveName = async () => {
    setSavingName(true);
    try {
      await setDisplayName(draftName);
      setEditing(false);
    } catch (err) {
      console.warn('saveName failed', err);
    } finally {
      setSavingName(false);
    }
  };

  const handleLinkGoogle = async () => {
    setLinkErr(null);
    setLinkingGoogle(true);
    try {
      await linkGoogleIdentity({
        redirectTo: `${window.location.origin}/auth/callback?next=/profile`,
      });
    } catch (err) {
      setLinkErr(errorMessage(err));
      setLinkingGoogle(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/play');
    } finally {
      setSigningOut(false);
    }
  };

  const openReplay = async (matchId: string) => {
    try {
      const result = await dispatch(
        playerDataApi.endpoints.getGamesForMatch.initiate(matchId, {
          subscribe: false,
        }),
      );
      if (result.error) {
        console.warn('open replay failed', result.error);
        return;
      }
      const finished = (result.data ?? []).filter((g) => g.finished_at);
      if (finished.length === 0) return;
      navigate(`/replay/${finished[0]!.id}`);
    } catch (err) {
      console.warn('open replay failed', err);
    }
  };

  if (isLoading) {
    return (
      <main className="profile-page grid min-h-screen place-items-center">
        <div className="font-display text-sm uppercase text-[#f7d76b]/70">
          Loading
        </div>
      </main>
    );
  }

  // Canonical per-level label from getProfileProgression — same source the lobby
  // card uses, so the two XP bars can't drift (was cumulative xp/target here).
  const xpText = progression.xpBarLabel;
  const nextLevelLabel = progression.nextLevelXp ? progression.level + 1 : progression.level;
  // Show ALL match history rows (was capped at 3). The list
  // scrolls when > 4 entries thanks to the max-h + overflow-y-auto
  // wrapper applied around .profile-history-list in the JSX below.
  const visibleMatches = matches ?? null;

  return (
    <main className="profile-page text-white">
      <div className="profile-screen">
        <header className="profile-top-nav">
          <Link to="/play" className="profile-icon-button" aria-label="Back to lobby">
            <span className="profile-back-chevron" />
          </Link>

          {/* Wallet pills centered in the top nav (was right-aligned).
            * Same pill design as the lobby top-bar, but the size-modifier
            * class shrinks the pill ~20 % so the centered cluster sits
            * comfortably in the available room without crowding the
            * back button. */}
          <div
            className="profile-top-currency flex items-center gap-3"
            aria-label="Wallet"
          >
            <CurrencyPill
              flyTarget="coins"
              icon="/lobby/icons/gold-coin.webp"
              label="Coins"
              value={wallet?.coins ?? 0}
              onAdd={openShop}
            />
            <CurrencyPill
              flyTarget="gems"
              icon="/lobby/icons/gem.webp"
              label="Gems"
              value={wallet?.gems ?? 0}
              onAdd={openShop}
            />
          </div>
        </header>

        {/* Two-column body: profile + stats + logout on the left,
          * match history (tall) on the right so the player can scan
          * more matches without scrolling. */}
        <div className="profile-body-grid">
          <div className="profile-left-stack">
            <section className="profile-main-card">
              <div className="profile-avatar-stage">
                <div className="profile-avatar-glow" />
                <Avatar
                  seed={profile?.avatar_seed ?? 'profile'}
                  imageUrl={profile?.avatar_url}
                  size={220}
                  ring="none"
                  className="profile-avatar-image"
                />
                {/* Same rounded shield shape as the lobby profile card
                  * (.lobby-pp-shield), scaled up + anchored to the
                  * bottom-centre of the avatar circle via .profile-pp-shield. */}
                <div className="profile-pp-shield">
                  <span>{progression.level}</span>
                </div>
              </div>

              <div className="profile-info-column">
                {editing ? (
                  <div className="profile-name-editor">
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="profile-name-input"
                      maxLength={32}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => void saveName()}
                      disabled={savingName || draftName.trim().length === 0}
                      className="profile-small-action"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="profile-small-action profile-small-action--ghost"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="profile-name-row">
                    <h1>{profile?.display_name ?? 'Player'}</h1>
                    <button
                      type="button"
                      onClick={startEditName}
                      className="profile-edit-button"
                      aria-label="Edit name"
                    >
                      <span />
                    </button>
                  </div>
                )}

                <div className="profile-rank-row">
                  <span className="profile-rank-badge">
                    <span className="profile-rank-shield" aria-hidden="true">
                      <span />
                    </span>
                    <span>{progression.statusLabel}</span>
                  </span>
                  <span className="profile-rating">
                    <span className="profile-rating-cup" aria-hidden="true" />
                    Rating <strong>{formatCompactNumber(profile?.rating ?? 1500)}</strong>
                  </span>
                </div>

                <div className="profile-xp-section">
                  <div className="profile-level-row">
                    <span>Level {progression.level}</span>
                    <span>Level {nextLevelLabel}</span>
                  </div>
                  {/* Lobby lava-XP bar — reuses the .lobby-profile-progress
                    * class (orange→yellow gradient with animated bubble
                    * layers riding the filled portion). profile-xp-wide
                    * scope widens it to the profile card's column. */}
                  <div className="profile-xp-row">
                    <span
                      className="lobby-profile-progress profile-xp-wide"
                      aria-label={`XP progress ${progression.progressLabel}`}
                    >
                      <span
                        className="lobby-profile-progress-fill"
                        style={{ width: `${progression.progressPercent}%` }}
                      >
                        <span className="lobby-profile-progress-bubbles" aria-hidden="true" />
                      </span>
                      <span className="lobby-profile-progress-label">{xpText}</span>
                    </span>
                  </div>
                  <div className="profile-next-reward">
                    <span>Next Reward:</span>
                    <img src="/lobby/icons/gold-coin.webp" alt="" draggable={false} />
                    <strong>500 Coins</strong>
                  </div>
                </div>
              </div>
            </section>

            {/* Guest-only "save your progress" CTA. Moved OUT of the
              * profile card's info column (where it was crammed under the
              * XP bar and read as an afterthought) to a dedicated
              * full-width banner directly below the card — a clear,
              * uncramped call to action. Absent entirely for signed-in
              * users, so their stack stays card -> stats -> logout. */}
            {isGuest && (
              <div className="profile-save-progress">
                <button
                  type="button"
                  onClick={() => void handleLinkGoogle()}
                  disabled={linkingGoogle}
                  className="profile-google-button"
                >
                  <span className="profile-google-glyph" aria-hidden="true">G</span>
                  {linkingGoogle ? 'Opening Google...' : 'Connect with Google'}
                </button>
                {linkErr && <span className="profile-save-progress-err">{linkErr}</span>}
              </div>
            )}

            {/* Stats live UNDER the avatar/info card (was on the right).
              * Wallet balances are no longer duplicated here — the top
              * bar already shows them. Four match-stats only. */}
            <section className="profile-stat-grid" aria-label="Player stats">
              <Stat icon="finished" label="Finished" value={stats?.totalFinished ?? 0} />
              <Stat icon="wins" label="AI Wins" value={stats?.aiWins ?? 0} />
              <Stat icon="losses" label="AI Losses" value={stats?.aiLosses ?? 0} />
              <Stat icon="hotseat" label="Hot-seat" value={stats?.hotseatPlayed ?? 0} />
            </section>

            {/* Full-width pill that fills the left column so it visually
              * matches the cards above. Reshaped from the prior square
              * 1×1 button. */}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="profile-logout-button"
            >
              <span className="profile-logout-icon" aria-hidden="true" />
              {signingOut ? 'Logging out...' : 'Log Out'}
            </button>

            {/* Account deletion (Google Play requirement + privacy commitment).
                Links to the public /delete-account page, which handles the
                confirm + delete flow. */}
            <Link
              to="/delete-account"
              className="mt-2 block text-center text-xs font-semibold uppercase tracking-wide text-rose-300/50 transition hover:text-rose-300"
            >
              Delete account
            </Link>
          </div>

          <section className="profile-history-panel">
            <h2>Match History</h2>
            {historyError && (
              <div className="profile-panel-message profile-panel-message--error">
                {errorMessage(historyError)}
              </div>
            )}
            {visibleMatches === null ? (
              <div className="profile-panel-message">Loading...</div>
            ) : visibleMatches.length === 0 ? (
              <div className="profile-panel-message">
                <span>No matches yet.</span>
                <Link to="/play">Start one</Link>
              </div>
            ) : (
              // History panel is the full height of the right column now,
              // so the inner scroll container takes 100 % and shows ~10
              // rows on a typical landscape viewport.
              <div className="profile-history-scroll">
                <ul className="profile-history-list">
                  {visibleMatches.map((m) => {
                    const outcome = ownerOutcome(m);
                    const outcomeLabel =
                      outcome === 'won'
                        ? 'Won'
                        : outcome === 'lost'
                        ? 'Lost'
                        : outcome === 'open'
                        ? 'In Progress'
                        : 'Hot-seat';
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="profile-history-row"
                          onClick={() => m.finished_at && void openReplay(m.id)}
                          disabled={!m.finished_at}
                        >
                          <span
                            className={`profile-match-icon profile-match-icon--${modeIcon(m.mode)}`}
                            aria-hidden="true"
                          >
                            <span />
                          </span>
                          <span className="profile-history-copy">
                            <span>
                              {MODE_LABEL[m.mode] ?? m.mode}
                              <em> to {m.target}</em>
                            </span>
                            <small>
                              {formatDate(m.finished_at ?? m.started_at)}
                              {m.game_count > 0 &&
                                ` - ${m.game_count} game${m.game_count > 1 ? 's' : ''}`}
                            </small>
                          </span>
                          <span className="profile-history-score">
                            {m.white_score} - {m.black_score}
                          </span>
                          <span
                            className={`profile-history-status profile-history-status--${outcome}`}
                          >
                            {outcomeLabel}
                          </span>
                          <span className="profile-history-chevron" aria-hidden="true">
                            ›
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/**
 * Profile-page CurrencyPill — same VISUAL design as the lobby's
 * top-bar pill, but does NOT reuse the lobby's CSS class names
 * (`.lobby-currency-pill`, `.lobby-currency-icon`, etc).
 *
 * Why: the lobby has desktop-only overrides like
 *   .lobby-currency-icon { width: calc(46 * var(--lobby-u)); }
 * where `--lobby-u` is defined on `.lobby-shell`. Outside that
 * scope (e.g. on /profile) `--lobby-u` is undefined → the calc()
 * becomes invalid → width falls back to `auto` → the <img>
 * renders at its intrinsic webp size (~512-1024px), which on the
 * profile page made the icons full-screen.
 *
 * Update: to make these EXACTLY match the lobby pills (the operator
 * kept seeing a mismatch — the lobby restyles its pills via the
 * `.lobby-currency-*` rules into a flat, --lobby-u-scaled shape with a
 * green-bordered "+", which the bare Tailwind copy never reproduced),
 * we now reuse the `.lobby-currency-*` class hooks AND supply
 * `--lobby-u` ourselves on `.profile-top-currency` (landscape uses the
 * same formula as `.lobby-shell`; portrait uses a fixed fallback) plus
 * an explicit pill height, so the lobby rules resolve correctly here.
 */
function CurrencyPill({
  flyTarget,
  icon,
  label,
  value,
  onAdd,
}: {
  readonly flyTarget: 'coins' | 'gems' | 'xp';
  readonly icon: string;
  readonly label: string;
  readonly value: number;
  readonly onAdd: () => void;
}) {
  return (
    <div
      aria-label={`${label}: ${value ?? 0}`}
      data-fly-target={flyTarget}
      className="lobby-currency-pill relative flex h-[2.76rem] min-w-[7.87rem] items-center rounded-md border border-[#28577d]/80 bg-gradient-to-b from-[#114f83]/80 to-[#073768]/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_7px_14px_rgba(0,0,0,0.32)] backdrop-blur"
    >
      <span className="lobby-currency-icon -ml-[0.92rem] grid h-[3.22rem] w-[3.22rem] shrink-0 place-items-center">
        <img
          src={icon}
          alt=""
          className="h-full w-full object-contain drop-shadow-[0_5px_5px_rgba(0,0,0,0.42)]"
          draggable={false}
        />
      </span>
      <span className="lobby-currency-value -ml-[0.46rem] flex h-[2.35rem] min-w-0 flex-1 items-center justify-center rounded bg-[#071f3f]/82 px-[0.92rem] text-center font-display text-lg font-black tracking-wide text-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
        {formatCompactNumber(value)}
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Get more ${label}`}
        className="lobby-currency-add relative mr-[0.23rem] grid h-[2.3rem] w-[2.3rem] shrink-0 place-items-center rounded bg-gradient-to-b from-[#8dff68] via-[#47d039] to-[#17831c] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_3px_0_#0c5710] transition hover:brightness-110 active:translate-y-[1px]"
      >
        <span className="absolute left-1/2 top-1/2 h-[1.38rem] w-[0.345rem] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
        <span className="absolute left-1/2 top-1/2 h-[0.345rem] w-[1.38rem] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
      </button>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  wide = false,
}: {
  readonly icon: 'coins' | 'gems' | 'finished' | 'wins' | 'losses' | 'hotseat';
  readonly label: string;
  readonly value: number;
  readonly wide?: boolean;
}) {
  // Coins + Gems use the real webp icons (same artwork as the
  // wallet pills + lobby) instead of the CSS-painted profile-
  // stat-icon sprites. Other stat icons stay on the sprites.
  const realIcon = icon === 'coins' ? '/lobby/icons/gold-coin.webp'
    : icon === 'gems' ? '/lobby/icons/gem.webp'
    : null;

  return (
    <div className={`profile-stat-card ${wide ? 'profile-stat-card--wide' : ''}`}>
      {realIcon ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center" aria-hidden="true">
          <img
            src={realIcon}
            alt=""
            draggable={false}
            className="h-full w-full object-contain drop-shadow-[0_3px_3px_rgba(0,0,0,0.45)]"
          />
        </span>
      ) : (
        <span className={`profile-stat-icon profile-stat-icon--${icon}`} aria-hidden="true">
          <span />
        </span>
      )}
      {/* text-[1.35rem] is smaller than the previous default (~2rem
          via .profile-stat-card strong) so a value like "16.6K" fits
          comfortably without overflowing the stat box. */}
      <strong className="!text-[1.35rem] !leading-none">{formatCompactNumber(value)}</strong>
      <small>{label}</small>
    </div>
  );
}
