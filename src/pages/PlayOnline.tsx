import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getMatchById } from '../lib/persistence';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database';

type MatchRow = Database['public']['Tables']['matches']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export default function PlayOnline() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [opponentProfile, setOpponentProfile] = useState<ProfileRow | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<ProfileRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollIdRef = useRef<number | null>(null);

  const refresh = useMemo(
    () => async () => {
      if (!matchId) return;
      try {
        const m = await getMatchById(matchId);
        if (!m) {
          setError('match not found');
          return;
        }
        setMatch(m);
        const ids = [m.owner_id, m.opponent_id].filter(Boolean) as string[];
        if (ids.length > 0) {
          const { data: profs, error: profErr } = await supabase
            .from('profiles')
            .select('*')
            .in('id', ids);
          if (profErr) throw profErr;
          setOwnerProfile(profs?.find((p) => p.id === m.owner_id) ?? null);
          setOpponentProfile(profs?.find((p) => p.id === m.opponent_id) ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [matchId]
  );

  useEffect(() => {
    if (authLoading || !user) return;
    void refresh();
    // Poll every 2s while waiting for opponent (5c will replace this with Realtime)
    pollIdRef.current = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      if (pollIdRef.current !== null) window.clearInterval(pollIdRef.current);
    };
  }, [authLoading, user, refresh]);

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-board-felt/70 gap-4">
        <div>Couldn't load match: {error}</div>
        <Link to="/" className="text-board-accent">← Home</Link>
      </main>
    );
  }
  if (authLoading || !match || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center text-board-felt/60">
        Loading…
      </main>
    );
  }

  const isOwner = user.id === match.owner_id;
  const isOpponent = user.id === match.opponent_id;
  const role = isOwner ? 'owner' : isOpponent ? 'opponent' : 'spectator';
  const waiting = match.opponent_id === null;

  const inviteUrl = match.invite_code
    ? `${window.location.origin}/join/${match.invite_code}`
    : null;

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback: select + copy via input is omitted for brevity
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
      <header className="w-full flex items-center justify-between px-4 py-3 text-board-felt/80">
        <Link to="/" className="text-board-accent text-sm">← Home</Link>
        <div className="text-xs text-board-felt/50">Online match · to {match.target}</div>
        <Link to="/profile" className="text-xs text-board-felt/60 hover:text-board-accent">
          Profile
        </Link>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md w-full p-6">
        <div className="font-display text-3xl text-board-accent text-center">
          {waiting ? 'Waiting for opponent…' : 'Both players ready'}
        </div>

        <div className="w-full bg-board-felt/5 border border-board-felt/10 rounded-lg p-4 flex flex-col gap-3">
          <Player
            label="White"
            name={
              match.owner_color === 'white'
                ? ownerProfile?.display_name ?? '—'
                : opponentProfile?.display_name ?? (waiting ? 'waiting…' : '—')
            }
            isYou={
              (match.owner_color === 'white' && isOwner) ||
              (match.owner_color === 'black' && isOpponent)
            }
          />
          <div className="text-center text-board-felt/40 text-xs">vs</div>
          <Player
            label="Black"
            name={
              match.owner_color === 'black'
                ? ownerProfile?.display_name ?? '—'
                : opponentProfile?.display_name ?? (waiting ? 'waiting…' : '—')
            }
            isYou={
              (match.owner_color === 'black' && isOwner) ||
              (match.owner_color === 'white' && isOpponent)
            }
          />
        </div>

        {waiting && isOwner && inviteUrl && (
          <div className="w-full bg-board-felt/5 border border-board-felt/10 rounded-lg p-4 flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-board-felt/50">
              Send this link to your opponent
            </div>
            <div className="flex gap-2">
              <input
                value={inviteUrl}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-board-felt/10 border border-board-felt/20 rounded px-2 py-1 text-sm font-mono text-board-felt focus:outline-none focus:border-board-accent"
              />
              <button
                onClick={copyLink}
                className="px-3 py-1 rounded bg-amber-700 text-amber-50 text-sm hover:brightness-110 active:scale-95 transition"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="text-[11px] text-board-felt/50">
              Code: <span className="font-mono text-board-accent">{match.invite_code}</span>{' '}
              · expires in 24h
            </div>
          </div>
        )}

        {!waiting && (
          <div className="text-center text-board-felt/60 text-sm max-w-sm">
            Gameplay loop coming next sub-phase. For now, both players are connected to the same
            match record — that's Phase 5a.
          </div>
        )}

        {isOwner && waiting && (
          <button
            onClick={async () => {
              if (!confirm('Cancel this online match?')) return;
              await supabase
                .from('matches')
                .update({ finished_at: new Date().toISOString() })
                .eq('id', match.id);
              navigate('/');
            }}
            className="text-xs text-board-felt/50 hover:text-rose-400 transition"
          >
            Cancel match
          </button>
        )}
        {role === 'spectator' && (
          <div className="text-xs text-board-felt/40">
            You're not part of this match.
          </div>
        )}
      </div>
    </main>
  );
}

function Player({ label, name, isYou }: { label: string; name: string; isYou: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-xs uppercase tracking-wider text-board-felt/50">{label}</div>
      <div className="font-display text-board-felt flex items-center gap-2">
        {name}
        {isYou && (
          <span className="text-[10px] uppercase tracking-wider text-board-accent border border-board-accent/40 rounded px-1.5 py-0.5">
            you
          </span>
        )}
      </div>
    </div>
  );
}
