import type { GameResult, MatchState } from '../engine';

interface Props {
  result: GameResult;
  match: MatchState;
  matchOver: boolean;
  onNextGame(): void;
  onNewMatch(): void;
}

const winLabel: Record<GameResult['winType'], string> = {
  single: 'wins',
  gammon: 'gammons',
  backgammon: 'backgammons',
};

export default function EndOfGameModal({
  result,
  match,
  matchOver,
  onNextGame,
  onNewMatch,
}: Props) {
  const verb = result.droppedDouble ? 'wins by drop' : winLabel[result.winType];
  const gameLine = `${result.winner} ${verb} +${result.points}`;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/65 z-30">
      <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-md">
        {matchOver ? (
          <>
            <div className="font-display text-3xl uppercase tracking-wider mb-1">Match over</div>
            <div className="capitalize text-xl mb-3 font-display">
              {match.winner} wins {match.score.white}–{match.score.black}
            </div>
            <div className="text-xs text-amber-900/80 mb-5 capitalize">{gameLine}</div>
            <button
              onClick={onNewMatch}
              className="px-6 py-2 rounded-md bg-amber-700 text-amber-50 font-medium border border-amber-900 shadow hover:brightness-110 active:scale-95 transition"
            >
              New match
            </button>
          </>
        ) : (
          <>
            <div className="font-display text-2xl uppercase tracking-wider mb-1 capitalize">
              {gameLine}
            </div>
            {!result.droppedDouble && result.cubeValue > 1 && (
              <div className="text-xs text-amber-900/80 mb-2">
                {result.winType} × cube {result.cubeValue}
              </div>
            )}
            <div className="text-sm mb-4 text-amber-900/90">
              Match {match.score.white}–{match.score.black} (to {match.target})
            </div>
            <button
              onClick={onNextGame}
              className="px-6 py-2 rounded-md bg-amber-700 text-amber-50 font-medium border border-amber-900 shadow hover:brightness-110 active:scale-95 transition"
            >
              Next game
            </button>
          </>
        )}
      </div>
    </div>
  );
}
