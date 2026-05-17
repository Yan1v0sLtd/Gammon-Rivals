import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AILevel } from '../ai';
import { useAuth } from '../lib/auth';
import { createOnlineMatch } from '../lib/persistence';
import { isSupabaseConfigured } from '../lib/supabase';
import { LobbyActionCard } from './LobbyActionCard';
import { LobbyBoardCarousel } from './LobbyBoardCarousel';
import { LobbyBottomNav } from './LobbyBottomNav';
import { LobbySideOffers } from './LobbySideOffers';
import { LobbyTopBar } from './LobbyTopBar';
import type { LobbyBoard, LobbyBoardId } from './lobbyData';
import { useLobbyBoards } from './useLobbyBoards';

type OpponentChoice = 'hotseat' | AILevel;

function LobbyBackgroundLayer({
  board,
  state,
}: {
  readonly board: LobbyBoard;
  readonly state: 'entering' | 'leaving';
}) {
  return (
    <div
      className={`lobby-background-layer fixed inset-0 ${
        state === 'leaving'
          ? 'lobby-background-layer--leaving'
          : 'lobby-background-layer--entering'
      }`}
      aria-hidden="true"
    >
      <img
        src={board.background}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0" style={{ background: board.backgroundTone }} />
    </div>
  );
}

export function LobbyScreen() {
  const navigate = useNavigate();
  const { profile, user, wallet, progression, isGuest, linkGoogleIdentity } = useAuth();
  const boards = useLobbyBoards();
  const [selectedBoardId, setSelectedBoardId] = useState<LobbyBoardId>('classic-green');
  const [creatingOnline, setCreatingOnline] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const effectiveSelectedBoardId = boards.some((board) => board.id === selectedBoardId)
    ? selectedBoardId
    : (boards[0]?.id ?? 'classic-green');
  const selectedBoard =
    boards.find((board) => board.id === effectiveSelectedBoardId) ?? boards[0]!;
  const previousBoardRef = useRef<LobbyBoard>(selectedBoard);
  const [fadingBoard, setFadingBoard] = useState<LobbyBoard | null>(null);

  useEffect(() => {
    const previousBoard = previousBoardRef.current;
    if (previousBoard.id === selectedBoard.id) return;

    setFadingBoard(previousBoard);
    previousBoardRef.current = selectedBoard;

    const clearPrevious = window.setTimeout(() => setFadingBoard(null), 560);
    return () => window.clearTimeout(clearPrevious);
  }, [selectedBoard]);

  const startMatch = (opponent: OpponentChoice, target = 7) => {
    const params = new URLSearchParams();
    params.set('opp', opponent);
    params.set('target', String(target));
    params.set('board', effectiveSelectedBoardId);
    navigate(`/hotseat?${params.toString()}`);
  };

  const startOnline = async () => {
    if (!isSupabaseConfigured) {
      navigate('/lobby');
      return;
    }
    if (!user || creatingOnline) return;
    setCreatingOnline(true);
    setOnlineError(null);
    try {
      const { matchId } = await createOnlineMatch({ ownerId: user.id, target: 7 });
      navigate(`/play/${matchId}?board=${effectiveSelectedBoardId}`);
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingOnline(false);
    }
  };

  return (
    <main className="lobby-screen relative min-h-dvh overflow-x-hidden bg-[#071120] text-white">
      {fadingBoard ? (
        <LobbyBackgroundLayer key={`leaving-${fadingBoard.id}`} board={fadingBoard} state="leaving" />
      ) : null}
      <LobbyBackgroundLayer
        key={`entering-${selectedBoard.id}`}
        board={selectedBoard}
        state="entering"
      />

      <div className="lobby-shell relative z-10 flex min-h-dvh flex-col px-4 pb-0 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-9">
        <LobbyTopBar
          profile={profile}
          wallet={wallet}
          progression={progression}
          isGuest={isGuest}
          onLinkGoogle={() => linkGoogleIdentity({ redirectTo: `${window.location.origin}/auth/callback?next=/` })}
        />

        <div className="lobby-main-grid grid flex-1 items-center gap-4 py-3 xl:grid-cols-[17rem_minmax(30rem,1fr)_19rem] xl:gap-6 2xl:grid-cols-[19rem_minmax(34rem,1fr)_22rem]">
          <LobbySideOffers />

          <div className="lobby-board-region min-w-0">
            <LobbyBoardCarousel
              boards={boards}
              selectedId={effectiveSelectedBoardId}
              onSelectedIdChange={setSelectedBoardId}
              onPlay={() => startMatch('medium')}
            />
          </div>

          <aside className="lobby-action-stack grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <LobbyActionCard
              title={creatingOnline ? 'Creating' : 'Play Online'}
              subtitle="Challenge players around the world"
              tone="blue"
              iconSrc="/lobby/icons/online-players.webp"
              onClick={startOnline}
              disabled={creatingOnline || (isSupabaseConfigured && !user)}
            />
            <LobbyActionCard
              title="Play Friends"
              subtitle="Two players on this device"
              tone="green"
              compactIcon="2"
              onClick={() => startMatch('hotseat')}
            />
            <LobbyActionCard
              title="Tournaments"
              subtitle="Warm up against Bailey"
              tone="purple"
              iconSrc="/lobby/icons/trophy.webp"
              onClick={() => startMatch('medium')}
            />
            {onlineError ? (
              <div className="rounded-md border border-rose-300/30 bg-rose-950/55 px-3 py-2 text-xs text-rose-100 sm:col-span-3 xl:col-span-1">
                {onlineError}
              </div>
            ) : null}
          </aside>
        </div>

        <LobbyBottomNav />
      </div>
    </main>
  );
}
