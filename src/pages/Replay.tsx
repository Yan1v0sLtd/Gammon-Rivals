import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { applyMove, endTurn as engineEndTurn, initialBoard, pipCount } from '../engine';
import type { BoardState, Die, Move } from '../engine';
import { BAR, OFF, type Position } from '../engine/types';
import BoardCanvas from '../board/BoardCanvas';
import { useBoardThemeConfig } from '../board/theme';
import { getGameWithMoves, type GameWithMoves } from '../lib/queries';

interface SubMove {
  readonly from: number | 'bar';
  readonly to: number | 'off';
  readonly die: number;
  readonly hit: boolean;
}

function decodePos(p: number | 'bar' | 'off'): Position {
  if (p === 'bar') return BAR;
  if (p === 'off') return OFF;
  return p;
}

function reconstructStates(data: GameWithMoves): BoardState[] {
  const states: BoardState[] = [initialBoard()];
  let s = states[0]!;
  for (const moveRow of data.moves) {
    const subs = (moveRow.sub_moves as unknown) as readonly SubMove[];
    for (const sub of subs) {
      const move: Move = {
        from: decodePos(sub.from),
        to: decodePos(sub.to),
        die: sub.die as Die,
        hit: sub.hit,
      };
      s = applyMove(s, move);
    }
    s = engineEndTurn(s);
    states.push(s);
  }
  return states;
}

const MODE_LABEL: Record<string, string> = {
  hotseat: 'Hot-seat',
  'ai-easy': 'AI · Easy',
  'ai-medium': 'AI · Medium',
  'ai-hard': 'AI · Hard',
};

function describeTurn(moveRow: GameWithMoves['moves'][number]): string {
  const dice = moveRow.dice.join('-');
  const subs = (moveRow.sub_moves as unknown) as readonly SubMove[];
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
  const [data, setData] = useState<GameWithMoves | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await getGameWithMoves(gameId);
        if (cancelled) return;
        setData(d);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const states = useMemo(() => (data ? reconstructStates(data) : []), [data]);
  const boardParam = params.get('board');
  const selectedTheme = useBoardThemeConfig(boardParam);
  const totalPlies = states.length > 0 ? states.length - 1 : 0;
  const clampedPly = Math.min(Math.max(0, ply), totalPlies);
  const currentBoard = states[clampedPly] ?? null;

  useEffect(() => {
    if (!playing) return;
    if (clampedPly >= totalPlies) return;
    const t = setTimeout(() => setPly((p) => p + 1), 1400);
    return () => clearTimeout(t);
  }, [playing, clampedPly, totalPlies]);

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-board-felt/70 gap-4">
        <div>Could not load replay: {error}</div>
        <Link to="/profile" className="text-board-accent">← Back</Link>
      </main>
    );
  }

  if (!data || !currentBoard) {
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
          onChange={(e) => {
            setPlaying(false);
            setPly(parseInt(e.target.value, 10));
          }}
          className="w-full accent-amber-500"
        />

        <div className="flex gap-2">
          <button
            onClick={() => setPly(0)}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm"
          >
            ⏮
          </button>
          <button
            onClick={() => setPly((p) => Math.max(0, p - 1))}
            disabled={clampedPly === 0}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm disabled:opacity-40"
          >
            ◀ prev
          </button>
          <button
            onClick={() => {
              if (clampedPly >= totalPlies) {
                setPly(0);
                setPlaying(true);
                return;
              }
              setPlaying((p) => !p);
            }}
            className="px-4 py-1 rounded bg-amber-700 text-amber-50 border border-amber-900 text-sm hover:brightness-110 active:scale-95"
          >
            {playing ? 'pause' : clampedPly >= totalPlies ? 'replay' : 'play'}
          </button>
          <button
            onClick={() => setPly((p) => Math.min(totalPlies, p + 1))}
            disabled={clampedPly >= totalPlies}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm disabled:opacity-40"
          >
            next ▶
          </button>
          <button
            onClick={() => setPly(totalPlies)}
            className="px-3 py-1 rounded bg-board-felt/10 hover:bg-board-felt/20 border border-board-felt/20 text-sm"
          >
            ⏭
          </button>
        </div>
      </div>
    </main>
  );
}
