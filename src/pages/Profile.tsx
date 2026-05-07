import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  getOwnerStats,
  listMatchesForOwner,
  listGamesForMatch,
  type MatchSummary,
  type OwnerStats,
} from '../lib/queries';

const MODE_LABEL: Record<string, string> = {
  hotseat: 'Hot-seat',
  'ai-easy': 'AI · Easy',
  'ai-medium': 'AI · Medium',
  'ai-hard': 'AI · Hard',
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

function ownerOutcome(m: MatchSummary): 'won' | 'lost' | 'open' | 'hotseat' {
  if (!m.finished_at) return 'open';
  if (m.mode === 'hotseat') return 'hotseat';
  return m.winner === 'white' ? 'won' : 'lost';
}

export default function Profile() {
  const {
    user,
    profile,
    isLoading,
    setDisplayName,
    sendMagicLink,
    isAnonymous,
    refreshProfile,
  } = useAuth();
  const navigate = useNavigate();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [email, setEmail] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [magicErr, setMagicErr] = useState<string | null>(null);

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
        setLoadErr(err instanceof Error ? err.message : String(err));
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
      // eslint-disable-next-line no-console
      console.warn('saveName failed', err);
    } finally {
      setSavingName(false);
    }
  };

  const handleMagicLink = async () => {
    setMagicErr(null);
    try {
      await sendMagicLink(email.trim());
      setMagicSent(true);
    } catch (err) {
      setMagicErr(err instanceof Error ? err.message : String(err));
    }
  };

  const openReplay = async (matchId: string) => {
    try {
      const games = await listGamesForMatch(matchId);
      const finished = games.filter((g) => g.finished_at);
      if (finished.length === 0) return;
      navigate(`/replay/${finished[0]!.id}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('open replay failed', err);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-board-felt/60">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
      <header className="flex items-center justify-between px-4 py-3 text-board-felt/80">
        <Link to="/" className="text-board-accent text-sm">
          ← Home
        </Link>
        <div className="text-xs text-board-felt/50">Profile</div>
        <div className="w-12" />
      </header>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 flex flex-col gap-6">
        <section className="rounded-lg border border-board-felt/10 bg-board-felt/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="flex gap-2">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="flex-1 bg-board-felt/10 border border-board-felt/20 rounded px-2 py-1 text-board-felt focus:outline-none focus:border-board-accent"
                    maxLength={32}
                    autoFocus
                  />
                  <button
                    onClick={saveName}
                    disabled={savingName || draftName.trim().length === 0}
                    className="px-3 py-1 rounded bg-amber-700 text-amber-50 text-sm disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-3 py-1 rounded text-board-felt/60 text-sm hover:text-board-felt"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <h1 className="font-display text-2xl text-board-accent truncate">
                    {profile?.display_name ?? '…'}
                  </h1>
                  <button
                    onClick={startEditName}
                    className="text-xs text-board-felt/50 hover:text-board-accent transition"
                  >
                    edit
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 mt-1">
                {profile && (
                  <div className="text-xs text-board-felt/60">
                    Rating <span className="text-board-accent font-mono">{profile.rating}</span>
                  </div>
                )}
                {isAnonymous && (
                  <div className="text-xs text-board-felt/50">Guest account</div>
                )}
              </div>
            </div>
          </div>

          {isAnonymous && (
            <div className="mt-4 pt-4 border-t border-board-felt/10">
              <div className="text-xs uppercase tracking-wider text-board-felt/50 mb-2">
                Save progress
              </div>
              {magicSent ? (
                <div className="text-sm text-board-accent">
                  Magic link sent to <strong>{email}</strong>. Open it to link this guest profile to
                  your email.
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1 bg-board-felt/10 border border-board-felt/20 rounded px-2 py-1 text-sm focus:outline-none focus:border-board-accent"
                  />
                  <button
                    onClick={handleMagicLink}
                    disabled={!email.includes('@')}
                    className="px-3 py-1 rounded bg-amber-700/80 text-amber-50 text-sm disabled:opacity-50"
                  >
                    Send link
                  </button>
                </div>
              )}
              {magicErr && <div className="text-xs text-red-400 mt-2">{magicErr}</div>}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Finished" value={stats?.totalFinished ?? 0} />
          <Stat label="AI wins" value={stats?.aiWins ?? 0} accent />
          <Stat label="AI losses" value={stats?.aiLosses ?? 0} />
          <Stat label="Hot-seat" value={stats?.hotseatPlayed ?? 0} />
        </section>

        <section>
          <div className="text-xs uppercase tracking-wider text-board-felt/50 mb-2">
            Match history
          </div>
          {loadErr && <div className="text-xs text-red-400">{loadErr}</div>}
          {matches === null ? (
            <div className="text-board-felt/40 text-sm">Loading…</div>
          ) : matches.length === 0 ? (
            <div className="text-board-felt/40 text-sm py-6 text-center">
              No matches yet. <Link to="/" className="text-board-accent">Start one</Link>.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {matches.map((m) => {
                const outcome = ownerOutcome(m);
                const outcomeClass =
                  outcome === 'won'
                    ? 'text-emerald-400'
                    : outcome === 'lost'
                    ? 'text-rose-400'
                    : outcome === 'open'
                    ? 'text-amber-300/70'
                    : 'text-board-felt/60';
                const outcomeLabel =
                  outcome === 'won'
                    ? 'won'
                    : outcome === 'lost'
                    ? 'lost'
                    : outcome === 'open'
                    ? 'in progress'
                    : 'hot-seat';
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-board-felt/5 hover:bg-board-felt/10 cursor-pointer border border-transparent hover:border-board-felt/20 transition"
                    onClick={() => m.finished_at && openReplay(m.id)}
                    title={m.finished_at ? 'Open replay' : 'Open match'}
                  >
                    <div className="flex flex-col min-w-0">
                      <div className="text-sm">
                        <span className="font-display">{MODE_LABEL[m.mode] ?? m.mode}</span>
                        <span className="text-board-felt/40"> · to {m.target}</span>
                      </div>
                      <div className="text-xs text-board-felt/50">
                        {formatDate(m.finished_at ?? m.started_at)}
                        {m.game_count > 0 && ` · ${m.game_count} game${m.game_count > 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm tabular-nums">
                        {m.white_score}–{m.black_score}
                      </div>
                      <div className={`text-xs uppercase tracking-wider w-16 text-right ${outcomeClass}`}>
                        {outcomeLabel}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-board-felt/5 border border-board-felt/10 rounded-md p-3 text-center">
      <div className={`font-display text-2xl ${accent ? 'text-board-accent' : 'text-board-felt'}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-board-felt/50">{label}</div>
    </div>
  );
}
