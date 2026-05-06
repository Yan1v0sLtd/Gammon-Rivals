import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import BoardCanvas from '../board/BoardCanvas';
import DiceTray from '../components/DiceTray';
import DoublingCube from '../components/DoublingCube';
import CubeOfferDecision from '../components/CubeOfferDecision';
import EndOfGameModal from '../components/EndOfGameModal';
import MatchHeader from '../components/MatchHeader';
import { useGame, type AIConfig, type TurnRecord } from '../game/useGame';
import { pipCount } from '../engine';
import type { Position } from '../engine/types';
import type { GameResult, MatchState } from '../engine';
import { woodTheme } from '../board/theme';
import { AI_LEVELS, type AILevel } from '../ai';
import { useAuth } from '../lib/auth';
import { createMatch, finishMatch, modeFromAi, saveGame } from '../lib/persistence';

function parseOpponent(raw: string | null): AIConfig | null {
  if (!raw || raw === 'hotseat') return null;
  if ((AI_LEVELS as readonly string[]).includes(raw)) {
    return { player: 'black', level: raw as AILevel };
  }
  return null;
}

function parseTarget(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return 7;
  return n;
}

export default function HotSeat() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const opp = params.get('opp');
  const aiConfig = useMemo(() => parseOpponent(opp), [opp]);
  const target = useMemo(() => parseTarget(params.get('target')), [params]);

  const game = useGame({ initialTarget: target, ai: aiConfig });
  const whitePip = pipCount(game.board, 'white');
  const blackPip = pipCount(game.board, 'black');

  // ---- Persistence ----
  const [matchId, setMatchId] = useState<string | null>(null);
  const persistedGameNumberRef = useRef(0);
  const persistedMatchOverRef = useRef(false);
  const matchCreatedForUserRef = useRef<string | null>(null);

  // Create the match record once user is authenticated
  useEffect(() => {
    if (authLoading || !user || matchId) return;
    if (matchCreatedForUserRef.current === user.id) return;
    matchCreatedForUserRef.current = user.id;
    (async () => {
      try {
        const id = await createMatch({
          ownerId: user.id,
          mode: modeFromAi(aiConfig),
          target,
        });
        setMatchId(id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('createMatch failed', err);
      }
    })();
  }, [authLoading, user, matchId, aiConfig, target]);

  // Save game when one finishes
  useEffect(() => {
    if (!matchId) return;
    if (!game.lastGameResult) return;
    if (persistedGameNumberRef.current >= game.match.gameNumber - (game.matchOver ? 0 : 1)) return;

    const result: GameResult = game.lastGameResult;
    const gameNumber = persistedGameNumberRef.current + 1;
    persistedGameNumberRef.current = gameNumber;

    const turnsForDb = (game.turnLog as readonly TurnRecord[]).map((t) => ({
      player: t.player,
      dice: t.dice,
      subMoves: t.subMoves,
    }));

    const wasCrawford =
      game.match.crawfordGameNumber !== null &&
      game.match.crawfordGameNumber === gameNumber;

    saveGame({
      matchId,
      gameNumber,
      result,
      cubeOwner: game.match.cube.owner,
      wasCrawford,
      moves: turnsForDb,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('saveGame failed', err);
    });
  }, [matchId, game.lastGameResult, game.match, game.matchOver, game.turnLog]);

  // Mark match finished
  useEffect(() => {
    if (!matchId) return;
    if (!game.matchOver) return;
    if (persistedMatchOverRef.current) return;
    persistedMatchOverRef.current = true;
    const winner = game.match.winner;
    if (!winner) return;
    finishMatch({
      matchId,
      whiteScore: game.match.score.white,
      blackScore: game.match.score.black,
      winner,
      crawfordGameNumber: game.match.crawfordGameNumber,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('finishMatch failed', err);
    });
  }, [matchId, game.matchOver, game.match]);

  // ---- Game UI ----
  const humanCanInteract = !game.isAITurn && !game.isAIThinking;

  const handlePointClick = (pos: Position) => {
    if (game.lastGameResult || game.matchOver) return;
    if (game.pendingOffer) return;
    if (!humanCanInteract) return;
    if (game.selectedFrom === null) {
      game.selectFrom(pos);
      return;
    }
    if (game.validDestinations.includes(pos)) {
      game.selectTo(pos);
    } else if (game.legalOrigins.includes(pos)) {
      game.selectFrom(pos);
    } else {
      game.cancelSelection();
    }
  };

  const turnLabel = game.matchOver
    ? 'match over'
    : game.lastGameResult
    ? 'game over'
    : game.pendingOffer
    ? `${game.pendingOffer === 'white' ? 'black' : 'white'} decides`
    : game.isAIThinking
    ? `${game.board.turn} (AI) thinking…`
    : game.isAITurn
    ? `${game.board.turn} (AI)`
    : game.roll === null
    ? `${game.board.turn} to roll`
    : `${game.board.turn} to move`;

  const showGameEndModal = (game.lastGameResult !== null || game.matchOver) && game.lastGameResult;
  const showCubeDecision =
    game.pendingOffer !== null &&
    !game.lastGameResult &&
    !(aiConfig && game.pendingOffer !== aiConfig.player);

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-[#1a1410] to-[#0d0907]">
      <MatchHeader
        match={game.match as MatchState}
        whitePip={whitePip}
        blackPip={blackPip}
        turnLabel={turnLabel}
        inCrawford={game.inCrawfordGame}
        onNewMatch={() => navigate('/')}
      />

      <div className="flex-1 flex items-center justify-center p-2 sm:p-4">
        <div className="relative w-full max-w-[1100px] aspect-[3/2] rounded-lg overflow-hidden shadow-2xl">
          <BoardCanvas
            state={game.board}
            theme={woodTheme}
            selection={{
              selectedFrom: game.selectedFrom,
              validDestinations: game.validDestinations,
              legalOrigins: game.legalOrigins,
            }}
            onPointClick={handlePointClick}
          />

          <DoublingCube
            value={game.match.cube.value}
            owner={game.match.cube.owner}
            canOffer={game.canOfferDouble}
            pendingOffer={game.pendingOffer}
            onOffer={game.offerDouble}
          />

          {!showGameEndModal && !showCubeDecision && (
            <DiceTray
              turn={game.board.turn}
              roll={game.roll}
              remaining={game.remaining}
              canRoll={
                game.roll === null && !game.lastGameResult && !game.matchOver && humanCanInteract
              }
              canEndTurn={game.canEndTurn && humanCanInteract}
              onRoll={game.rollDice}
              onEndTurn={game.endTurn}
            />
          )}

          {showCubeDecision && (
            <CubeOfferDecision
              offeredBy={game.pendingOffer!}
              currentValue={game.match.cube.value}
              onAccept={game.acceptDouble}
              onDrop={game.dropDouble}
            />
          )}

          {showGameEndModal && (
            <EndOfGameModal
              result={game.lastGameResult!}
              match={game.match}
              matchOver={game.matchOver}
              onNextGame={game.nextGame}
              onNewMatch={() => navigate('/')}
            />
          )}
        </div>
      </div>
    </main>
  );
}
