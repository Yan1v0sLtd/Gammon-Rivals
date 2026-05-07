import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  cancelMatchmaking,
  createOnlineMatch,
  joinPublicMatch,
  listPublicMatches,
  matchmake,
  type PublicMatchSummary,
} from '../lib/persistence';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const TARGETS: readonly number[] = [1, 3, 5, 7, 11];

function formatAge(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hr = Math.floor(diffMin / 60);
  return `${hr}h ago`;
}

export default function Lobby() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [matches, setMatches] = useState<PublicMatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<number>(7);
  const [joining, setJoining] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const queueChannelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useMemo(
    () => async () => {
      try {
        const data = await listPublicMatches();
        setMatches(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel('lobby')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          void refresh();
        }
      )
      .subscribe();
    channelRef.current = channel;
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearInterval(interval);
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [refresh]);

  const createPublic = async () => {
    if (!user || creating) return;
    setCreating(true);
    setError(null);
    try {
      const { matchId } = await createOnlineMatch({
        ownerId: user.id,
        target,
        isPublic: true,
      });
      navigate(`/play/${matchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const join = async (matchId: string) => {
    if (joining) return;
    setJoining(matchId);
    setError(null);
    try {
      await joinPublicMatch(matchId);
      navigate(`/play/${matchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(null);
    }
  };

  const watch = (matchId: string) => navigate(`/play/${matchId}`);

  // Subscribe to my queue row so we know when we get matched.
  useEffect(() => {
    if (!queued || !user) return;
    const channel = supabase
      .channel(`queue-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchmaking_queue',
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { matched_match_id: string | null } | null;
          if (row?.matched_match_id) {
            setQueued(false);
            navigate(`/play/${row.matched_match_id}`);
          }
        }
      )
      .subscribe();
    queueChannelRef.current = channel;
    return () => {
      if (queueChannelRef.current) {
        void supabase.removeChannel(queueChannelRef.current);
        queueChannelRef.current = null;
      }
    };
  }, [queued, user, navigate]);

  const findMatch = async () => {
    if (!user || queued) return;
    setQueueError(null);
    try {
      const matchId = await matchmake(target);
      if (matchId) {
        navigate(`/play/${matchId}`);
      } else {
        setQueued(true);
      }
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    }
  };

  const cancelFind = async () => {
    try {
      await cancelMatchmaking();
    } catch {
      // ignore — the row might already be matched/deleted
    }
    setQueued(false);
  };

  const open = matches?.filter((m) => !m.is_active) ?? [];
  const active = matches?.filter((m) => m.is_active) ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
      <header className="flex items-center justify-between px-4 py-3 text-board-felt/80">
        <Link to="/" className="text-board-accent text-sm">← Home</Link>
        <div className="text-xs text-board-felt/50">Lobby</div>
        <Link to="/profile" className="text-xs text-board-felt/60 hover:text-board-accent">
          {profile?.display_name ?? 'Profile'}
        </Link>
      </header>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 flex flex-col gap-6">
        {error && (
          <div className="bg-rose-900/30 border border-rose-700/50 text-rose-200 text-sm rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-board-felt/10 bg-board-felt/5 p-4 flex flex-col gap-3">
          <div>
            <div className="font-display text-lg text-board-accent">
              {queued ? 'Searching for an opponent…' : 'Find a match'}
            </div>
            <div className="text-xs text-board-felt/50">
              {queued
                ? 'Auto-pairing by rating. Cancel any time.'
                : 'We pair you with the closest-rated waiting player.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t}
                disabled={queued}
                onClick={() => setTarget(t)}
                className={`min-w-[3.5rem] py-1.5 px-3 rounded-md border transition font-display disabled:opacity-50 ${
                  target === t
                    ? 'bg-amber-700/30 border-amber-500 text-board-accent'
                    : 'bg-board-felt/5 border-board-felt/20 text-board-felt/80 hover:border-board-felt/40'
                }`}
              >
                {t === 1 ? '1 game' : `to ${t}`}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {!queued ? (
              <>
                <button
                  onClick={findMatch}
                  disabled={!user}
                  className="py-2 rounded-md bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 font-display shadow border border-amber-700 hover:brightness-110 active:scale-[0.98] transition disabled:opacity-50"
                >
                  Find match
                </button>
                <button
                  onClick={createPublic}
                  disabled={creating || !user}
                  className="py-2 rounded-md bg-board-felt/5 border border-board-felt/20 text-board-felt hover:border-board-accent active:scale-[0.98] transition disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create public match'}
                </button>
              </>
            ) : (
              <button
                onClick={cancelFind}
                className="col-span-2 py-2 rounded-md bg-board-felt/5 border border-board-felt/30 text-board-felt hover:border-rose-400 hover:text-rose-400 transition flex items-center justify-center gap-2"
              >
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Cancel search
              </button>
            )}
          </div>
          {queueError && (
            <div className="text-xs text-rose-400">{queueError}</div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-board-felt/50">
              Waiting for opponent
            </div>
            <div className="text-[10px] text-board-felt/40">{open.length}</div>
          </div>
          {matches === null ? (
            <div className="text-board-felt/40 text-sm py-4 text-center">Loading…</div>
          ) : open.length === 0 ? (
            <div className="text-board-felt/40 text-sm py-6 text-center border border-board-felt/10 rounded-md">
              No open matches yet. Be the first.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {open.map((m) => {
                const isOwn = m.owner_id === user?.id;
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-board-felt/5 border border-transparent hover:border-board-felt/20 transition"
                  >
                    <div className="flex flex-col min-w-0">
                      <div className="text-sm font-display">
                        {m.ownerName} <span className="text-board-felt/40">·</span>{' '}
                        <span className="text-board-felt/60 font-mono">{m.ownerRating}</span>
                      </div>
                      <div className="text-xs text-board-felt/50">
                        to {m.target} · {formatAge(m.started_at)}
                      </div>
                    </div>
                    {isOwn ? (
                      <button
                        onClick={() => navigate(`/play/${m.id}`)}
                        className="px-3 py-1 rounded text-xs bg-board-felt/10 text-board-felt hover:bg-board-felt/20 transition"
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={() => join(m.id)}
                        disabled={joining !== null}
                        className="px-3 py-1 rounded text-xs bg-amber-700 text-amber-50 hover:brightness-110 active:scale-95 transition disabled:opacity-50"
                      >
                        {joining === m.id ? 'Joining…' : 'Join'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-board-felt/50">
              In progress (spectate)
            </div>
            <div className="text-[10px] text-board-felt/40">{active.length}</div>
          </div>
          {active.length === 0 ? (
            <div className="text-board-felt/40 text-sm py-6 text-center border border-board-felt/10 rounded-md">
              Nothing live right now.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {active.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-board-felt/5 border border-transparent hover:border-board-felt/20 transition"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="text-sm font-display">{m.ownerName}'s match</div>
                    <div className="text-xs text-board-felt/50">
                      to {m.target} · started {formatAge(m.started_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => watch(m.id)}
                    className="px-3 py-1 rounded text-xs bg-board-felt/10 text-board-felt hover:bg-board-felt/20 transition"
                  >
                    Watch
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
