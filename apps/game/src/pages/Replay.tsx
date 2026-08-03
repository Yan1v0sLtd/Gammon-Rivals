import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { pipCount } from '../../../../packages/engine/src/board';
import BoardCanvas from '../../../../packages/board-renderer/src/BoardCanvas';
import { useBoardThemeConfig } from '../board/theme/remote';
import { useGetReplayQuery } from '../features/replay/replayApi';
import {
  replayPause,
  replayPlay,
  replayRouteEntered,
  replayRouteExited,
  replaySeek,
} from '../features/replay/replaySlice';
import {
  selectClampedPly,
  selectCurrentBoard,
  selectIsPlaying,
  selectTotalPlies,
  type SubMove,
} from '../features/replay/replaySelectors';
import type { MoveRow } from '../features/replay/replayData';
import { useAppDispatch, useAppSelector } from '../store/hooks';

const MODE_LABEL: Record<string, string> = {
  hotseat: 'Hot-seat',
  'ai-easy': 'AI · Easy',
  'ai-medium': 'AI · Medium',
  'ai-hard': 'AI · Hard',
};

function describeTurn(moveRow: MoveRow): string {
  const dice = moveRow.dice.join('-');
  const subs = moveRow.sub_moves as unknown as readonly SubMove[];
  if (subs.length === 0) return `rolled ${dice}, no legal play`;
  const parts = subs.map((s) => {
    const from = s.from === 'bar' ? 'bar' : String(s.from);
    const to = s.to === 'off' ? 'off' : String(s.to);
    const arrow = s.hit ? '×' : '→';
    return `${from}${arrow}${to}`;
  });
  return `rolled ${dice}: ${parts.join(', ')}`;
}

export default function Replay() {
  const { gameId } = useParams<{ gameId: string }>();
  const [params] = useSearchParams();
  const dispatch = useAppDispatch();

  const { data, error, isLoading } = useGetReplayQuery(gameId ?? '', { skip: !gameId });

  useEffect(() => {
    if (!gameId) return;
    dispatch(replayRouteEntered());
    return () => {
      dispatch(replayRouteExited());
    };
  }, [dispatch, gameId]);

  const totalPlies = useAppSelector((s) => selectTotalPlies(s, data));
  const clampedPly = useAppSelector((s) => selectClampedPly(s, data));
  const currentBoard = useAppSelector((s) => selectCurrentBoard(s, data));
  const isPlaying = useAppSelector((s) => selectIsPlaying(s, data));

  const boardParam = params.get('board');
  const { theme: selectedTheme } = useBoardThemeConfig(boardParam);

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-board-felt/70 gap-4">
        <div>Could not load replay: {error.message}</div>
        <Link to="/profile" className="text-board-accent">← Back</Link>
      </main>
    );
  }

  if (isLoading || !data || !currentBoard) {
    return (
      <main className="min-h-screen flex items-center justify-center text-board-felt/60">
        Loading replay…
      </main>
    );
  }

  const turnDescription =
    clampedPly === 0
      ? 'starting position'
      : describeTurn(data.moves[clampedPly - 1]!);

  const modeLabel = MODE_LABEL[data.match.mode] ?? data.match.mode;
  const winnerLine = data.game.winner
    ? `${data.game.winner} ${data.game.dropped_double ? 'wins by drop' : data.game.win_type ?? 'wins'} +${data.game.points_awarded}`
    : 'unfinished';

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-[#1a1410] to-[#0d0907] text-board-felt">
      <header className="flex items-center justify-between px-4 py-2 text-board-felt/80 gap-3">
        <Link to="/profile" className="text-board-accent text-sm">← Profile</Link>
        <div className="text-xs font-mono">
          <span className="text-chip-cream">w {pipCount(currentBoard, 'white')}</span>
          <span className="mx-2 text-board-felt/40">·</span>
          <span className="text-board-felt">b {pipCount(currentBoard, 'black')} </span>
          <span className="text-board-felt/40 ml-3">{modeLabel}</span>
          <span className="text-board-felt/40 ml-2">game {data.game.game_number}</span>
          <span className="text-board-felt/40 ml-2 capitalize">{winnerLine}</span>
        </div>
        <div className="text-xs text-board-felt/60 whitespace-nowrap">
          ply {clampedPly} / {totalPlies}
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-2 sm:p-4">
        <div className="relative w-full max-w-[1100px] aspect-[3/2] rounded-lg overflow-hidden shadow-2xl">
          <BoardCanvas state={currentBoard} theme={selectedTheme} />
        </div>
      </div>

      <div className="px-4 pb-4 flex flex-col items-center gap-3 max-w-2xl mx-auto w-full">
        <div className="text-xs text-board-felt/70 capitalize text-center min-h-[1.2em]">
          {clampedPly > 0 && (
            <>
              <strong className="text-board-accent">{data.moves[clampedPly - 1]!.player}</strong>{' '}
              {turnDescription}
            </>
          )}
          {clampedPly === 0 && <em>{turnDescription}</em>}
        </div>

        <input
          type="range"
          min={0}
          max={totalPlies}
          value={clampedPly}
          onChange={(e) =>
            dispatch(replaySeek({ ply: parseInt(e.target.value, 10), totalPlies }))
          }
          className="w-full accent-amber-500"
        />

        <div className="flex gap-2">
          <button
            onClick={() => dispatch(replaySeek({ ply: 0, totalPlies }))}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm"
          >
            ⏮
          </button>
          <button
            onClick={() => dispatch(replaySeek({ ply: clampedPly - 1, totalPlies }))}
            disabled={clampedPly === 0}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm disabled:opacity-40"
          >
            ◀ prev
          </button>
          <button
            onClick={() => {
              if (isPlaying) dispatch(replayPause());
              else dispatch(replayPlay({ totalPlies }));
            }}
            className="px-4 py-1 rounded bg-amber-700 text-amber-50 border border-amber-900 text-sm hover:brightness-110 active:scale-95"
          >
            {isPlaying ? 'pause' : clampedPly >= totalPlies ? 'replay' : 'play'}
          </button>
          <button
            onClick={() => dispatch(replaySeek({ ply: clampedPly + 1, totalPlies }))}
            disabled={clampedPly >= totalPlies}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm disabled:opacity-40"
          >
            next ▶
          </button>
          <button
            onClick={() => dispatch(replaySeek({ ply: totalPlies, totalPlies }))}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm"
          >
            ⏭
          </button>
        </div>
      </div>
    </main>
  );
}
