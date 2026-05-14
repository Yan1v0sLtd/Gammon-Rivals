import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { useAuth } from '../lib/auth';
import { formatCompactNumber } from '../lib/format';
import {
  getOwnerStats,
  listMatchesForOwner,
  listGamesForMatch,
  type MatchSummary,
  type OwnerStats,
} from '../lib/queries';

const MODE_LABEL: Record<string, string> = {
  hotseat: 'Hot-seat',
  'ai-easy': 'AI - Easy',
  'ai-medium': 'AI - Medium',
  'ai-hard': 'AI - Hard',
};

const profileShortcuts = [
  { label: 'Friends', icon: '/lobby/icons/friends.webp' },
  { label: 'Settings', icon: '/lobby/icons/settings-gear.webp' },
] as const;

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
    refreshProfile,
  } = useAuth();
  const navigate = useNavigate();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshProfile();
        const [s, m] = await Promise.all([
          getOwnerStats(user.id),
          listMatchesForOwner(user.id, 50),
        ]);
        if (cancelled) return;
        setStats(s);
        setMatches(m);
      } catch (err) {
        if (cancelled) return;
        setLoadErr(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refreshProfile]);

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
      navigate('/');
    } finally {
      setSigningOut(false);
    }
  };

  const openReplay = async (matchId: string) => {
    try {
      const games = await listGamesForMatch(matchId);
      const finished = games.filter((g) => g.finished_at);
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

  const xpTarget = progression.nextLevelXp ?? Math.max(progression.xp, progression.currentLevelXp + 1000);
  const xpText = `${formatCompactNumber(progression.xp)} / ${formatCompactNumber(xpTarget)} XP`;
  const nextLevelLabel = progression.nextLevelXp ? progression.level + 1 : progression.level;
  const visibleMatches = matches?.slice(0, 3) ?? null;

  return (
    <main className="profile-page text-white">
      <div className="profile-screen">
        <header className="profile-top-nav">
          <Link to="/" className="profile-icon-button" aria-label="Back to lobby">
            <span className="profile-back-chevron" />
          </Link>

          <div className="profile-currency-bar" aria-label="Wallet">
            <ProfileCurrency icon="/lobby/icons/gold-coin.webp" label="Coins" value={wallet?.coins ?? 0} />
            <span className="profile-currency-divider" aria-hidden="true" />
            <ProfileCurrency icon="/lobby/icons/gem.webp" label="Gems" value={wallet?.gems ?? 0} />
          </div>

          <nav className="profile-shortcuts" aria-label="Profile shortcuts">
            {profileShortcuts.map((shortcut) => (
              <button key={shortcut.label} type="button" className="profile-shortcut">
                <span className="profile-shortcut-icon">
                  <img src={shortcut.icon} alt="" draggable={false} />
                </span>
                <span>{shortcut.label}</span>
              </button>
            ))}
          </nav>
        </header>

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
            <div className="profile-level-shield">
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
              <div className="profile-xp-row">
                <div className="profile-xp-bar" aria-label={`XP progress ${progression.progressLabel}`}>
                  <span style={{ width: `${progression.progressPercent}%` }} />
                </div>
                <span className="profile-xp-text">{xpText}</span>
              </div>
              <div className="profile-next-reward">
                <span>Next Reward:</span>
                <img src="/lobby/icons/gold-coin.webp" alt="" draggable={false} />
                <strong>500 Coins</strong>
              </div>
              {isGuest && (
                <div className="profile-save-progress">
                  <button
                    type="button"
                    onClick={() => void handleLinkGoogle()}
                    disabled={linkingGoogle}
                    className="profile-google-button"
                  >
                    {linkingGoogle ? 'Opening Google...' : 'Link Google'}
                  </button>
                  {linkErr && <span>{linkErr}</span>}
                </div>
              )}
            </div>

          </div>

          <section className="profile-stat-grid" aria-label="Player stats">
            <Stat icon="coins" label="Coins" value={wallet?.coins ?? 0} />
            <Stat icon="gems" label="Gems" value={wallet?.gems ?? 0} />
            <Stat icon="finished" label="Finished" value={stats?.totalFinished ?? 0} />
            <Stat icon="wins" label="AI Wins" value={stats?.aiWins ?? 0} />
            <Stat icon="losses" label="AI Losses" value={stats?.aiLosses ?? 0} wide />
            <Stat icon="hotseat" label="Hot-seat" value={stats?.hotseatPlayed ?? 0} wide />
          </section>
        </section>

        <div className="profile-bottom-grid">
          <section className="profile-history-panel">
            <h2>Match History</h2>
            {loadErr && <div className="profile-panel-message profile-panel-message--error">{loadErr}</div>}
            {visibleMatches === null ? (
              <div className="profile-panel-message">Loading...</div>
            ) : visibleMatches.length === 0 ? (
              <div className="profile-panel-message">
                <span>No matches yet.</span>
                <Link to="/">Start one</Link>
              </div>
            ) : (
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
                        <span className={`profile-match-icon profile-match-icon--${modeIcon(m.mode)}`} aria-hidden="true">
                          <span />
                        </span>
                        <span className="profile-history-copy">
                          <span>
                            {MODE_LABEL[m.mode] ?? m.mode}
                            <em> to {m.target}</em>
                          </span>
                          <small>
                            {formatDate(m.finished_at ?? m.started_at)}
                            {m.game_count > 0 && ` - ${m.game_count} game${m.game_count > 1 ? 's' : ''}`}
                          </small>
                        </span>
                        <span className="profile-history-score">
                          {m.white_score} - {m.black_score}
                        </span>
                        <span className={`profile-history-status profile-history-status--${outcome}`}>
                          {outcomeLabel}
                        </span>
                        <span className="profile-history-chevron" aria-hidden="true">›</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="profile-logout-button"
          >
            <span className="profile-logout-icon" aria-hidden="true" />
            {signingOut ? 'Logging out...' : 'Log Out'}
          </button>
        </div>
      </div>
    </main>
  );
}

function ProfileCurrency({
  icon,
  label,
  value,
}: {
  readonly icon: string;
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="profile-currency-pill" aria-label={`${label}: ${formatCompactNumber(value)}`}>
      <img src={icon} alt="" draggable={false} />
      <span>{formatCompactNumber(value)}</span>
      <button type="button" aria-label={`Add ${label}`}>+</button>
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
  return (
    <div className={`profile-stat-card ${wide ? 'profile-stat-card--wide' : ''}`}>
      <span className={`profile-stat-icon profile-stat-icon--${icon}`} aria-hidden="true">
        <span />
      </span>
      <strong>{formatCompactNumber(value)}</strong>
      <small>{label}</small>
    </div>
  );
}
