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

  const nextXpText = progression.nextLevelXp
    ? `${formatCompactNumber(progression.xpNeededForNext)} XP to next level`
    : 'Max configured level reached';

  return (
    <main className="profile-page min-h-screen px-4 py-[max(1rem,env(safe-area-inset-top))] text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[61rem] flex-col">
        <header className="profile-page-header">
          <Link to="/" className="profile-icon-button" aria-label="Back to lobby">
            <span className="profile-back-chevron" />
          </Link>
          <h1 className="font-display text-[clamp(2rem,5vw,3.45rem)] font-black uppercase drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">
            My Profile
          </h1>
          <button type="button" className="profile-icon-button" aria-label="Settings">
            <span className="profile-gear-icon" />
          </button>
        </header>

        <section className="profile-main-card">
          <div className="profile-identity-grid">
            <div className="profile-avatar-stage">
              <div className="profile-avatar-glow" />
              <Avatar
                seed={profile?.avatar_seed ?? 'profile'}
                imageUrl={profile?.avatar_url}
                size={172}
                ring="none"
                className="profile-avatar-image"
              />
              <div className="profile-level-shield">
                <span>{progression.level}</span>
              </div>
            </div>

            <div className="min-w-0">
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
                <div className="flex min-w-0 items-center gap-3">
                  <h2 className="truncate font-display text-[clamp(2.35rem,6vw,4.4rem)] font-black leading-none text-white drop-shadow-[0_5px_0_rgba(0,0,0,0.42)]">
                    {profile?.display_name ?? 'Player'}
                  </h2>
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

              <div className="mt-4 flex flex-wrap items-center gap-3">
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

              <div className="profile-progress-panel mt-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-xl font-black uppercase text-white">
                    Level {progression.level}
                  </span>
                  <span className="profile-progress-arrow" aria-hidden="true" />
                  <span className="font-display text-xl font-black uppercase text-[#c895ff]">
                    Level {progression.nextLevelXp ? progression.level + 1 : progression.level}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <div className="profile-xp-bar" aria-label={`XP progress ${progression.progressLabel}`}>
                    <span style={{ width: `${progression.progressPercent}%` }} />
                  </div>
                  <span className="profile-xp-percent">{progression.progressLabel}</span>
                </div>
                <div className="mt-3 text-lg font-bold text-white/55">{nextXpText}</div>
              </div>
            </div>
          </div>

          {isGuest && (
            <div className="profile-save-progress">
              <div>
                <div className="font-display text-lg font-black uppercase text-[#f7d76b]">
                  Save progress
                </div>
                <div className="text-sm font-semibold text-white/64">
                  Link Google to keep XP, coins, boards, purchases, and match history.
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleLinkGoogle()}
                disabled={linkingGoogle}
                className="profile-google-button"
              >
                {linkingGoogle ? 'Opening Google...' : 'Link Google account'}
              </button>
              {linkErr && <div className="text-sm font-bold text-rose-300">{linkErr}</div>}
            </div>
          )}
        </section>

        <section className="profile-stat-grid" aria-label="Player stats">
          <Stat icon="coins" label="Coins" value={wallet?.coins ?? 0} />
          <Stat icon="gems" label="Gems" value={wallet?.gems ?? 0} />
          <Stat icon="finished" label="Finished" value={stats?.totalFinished ?? 0} />
          <Stat icon="wins" label="AI Wins" value={stats?.aiWins ?? 0} />
          <Stat icon="losses" label="AI Losses" value={stats?.aiLosses ?? 0} wide />
          <Stat icon="hotseat" label="Hot-seat" value={stats?.hotseatPlayed ?? 0} wide />
        </section>

        <section className="profile-history-panel">
          <h3 className="font-display text-2xl font-black uppercase text-white">
            Match History
          </h3>
          {loadErr && <div className="mt-3 text-sm font-bold text-rose-300">{loadErr}</div>}
          {matches === null ? (
            <div className="py-8 text-center font-bold text-white/45">Loading...</div>
          ) : matches.length === 0 ? (
            <div className="py-8 text-center font-bold text-white/45">
              No matches yet. <Link to="/" className="text-[#f7d76b]">Start one</Link>.
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {matches.map((m) => {
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
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate font-display text-xl font-black text-white">
                          {MODE_LABEL[m.mode] ?? m.mode}{' '}
                          <span className="font-sans text-base font-bold text-[#f7d76b]">- to {m.target}</span>
                        </span>
                        <span className="mt-1 block text-base font-semibold text-white/48">
                          {formatDate(m.finished_at ?? m.started_at)}
                          {m.game_count > 0 && ` - ${m.game_count} game${m.game_count > 1 ? 's' : ''}`}
                        </span>
                      </span>
                      <span className="profile-history-score">
                        {m.white_score} - {m.black_score}
                      </span>
                      <span className={`profile-history-status profile-history-status--${outcome}`}>
                        {outcomeLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!isGuest ? (
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="profile-logout-button"
          >
            <span className="profile-logout-icon" aria-hidden="true" />
            {signingOut ? 'Logging out...' : 'Log Out'}
          </button>
        ) : null}
      </div>
    </main>
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
      <div className="font-display text-[clamp(2.5rem,7vw,4rem)] font-black leading-none text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.36)]">
        {formatCompactNumber(value)}
      </div>
      <div className="mt-1 text-base font-black uppercase text-white/58">{label}</div>
    </div>
  );
}
