import type { GameResult, MatchState } from '../engine';

/**
 * Optional reward summary attached to the match-over state. Populated
 * by the server-side finish_match RPC when the match was started from
 * a difficulty room and the local player won; left undefined for
 * legacy matches that bypass the reward path.
 */
export interface EndOfGameReward {
  xpAwarded: number;
  xpMultiplier: number;
  coinsAwarded: number;
}

interface Props {
  result: GameResult;
  match: MatchState;
  matchOver: boolean;
  reward?: EndOfGameReward | null;
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
  reward,
  onNextGame,
  onNewMatch,
}: Props) {
  const verb = result.droppedDouble ? 'wins by drop' : winLabel[result.winType];
  const gameLine = `${result.winner} ${verb} +${result.points}`;
  // Single-game (target=1) matches: the match IS the game, so use single-game
  // language and drop the running match-score framing.
  const singleGame = match.target <= 1;
  // Show reward chips only when something was actually awarded — losing
  // a difficulty match still calls finish_match, but xp/coins come
  // back as 0, and we don't want a "+0" chip.
  const showReward =
    matchOver &&
    reward !== undefined &&
    reward !== null &&
    (reward.xpAwarded > 0 || reward.coinsAwarded > 0);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/65 z-30">
      <div className="bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950 px-8 py-6 rounded-xl shadow-2xl border-2 border-amber-700 text-center max-w-md">
        {matchOver ? (
          <>
            <div className="font-display text-3xl uppercase tracking-wider mb-1">
              {singleGame ? 'Game over' : 'Match over'}
            </div>
            {singleGame ? (
              <div className="capitalize text-xl mb-5 font-display">
                {result.winner} {verb}
              </div>
            ) : (
              <>
                <div className="capitalize text-xl mb-3 font-display">
                  {match.winner} wins {match.score.white}–{match.score.black}
                </div>
                <div className="text-xs text-amber-900/80 mb-5 capitalize">{gameLine}</div>
              </>
            )}
            {showReward ? (
              <div className="mb-4 flex items-center justify-center gap-3 rounded-lg border border-amber-600/40 bg-amber-50/60 px-3 py-2">
                {reward!.xpAwarded > 0 ? (
                  <span className="flex items-baseline gap-1">
                    <span className="font-display text-lg font-black tabular-nums text-violet-700">
                      +{reward!.xpAwarded.toLocaleString()}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wide text-violet-900/80">
                      XP{reward!.xpMultiplier > 1 ? ` (×${reward!.xpMultiplier})` : ''}
                    </span>
                  </span>
                ) : null}
                {reward!.coinsAwarded > 0 ? (
                  <span className="flex items-baseline gap-1">
                    <span className="font-display text-lg font-black tabular-nums text-amber-700">
                      +{reward!.coinsAwarded.toLocaleString()}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wide text-amber-900/80">
                      coins
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
            <button
              onClick={onNewMatch}
              className="px-6 py-2 rounded-md bg-amber-700 text-amber-50 font-medium border border-amber-900 shadow hover:brightness-110 active:scale-95 transition"
            >
              {singleGame ? 'Play again' : 'New match'}
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
