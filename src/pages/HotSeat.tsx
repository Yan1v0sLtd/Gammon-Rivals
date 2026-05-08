import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import BoardCanvas from '../board/BoardCanvas';
import DiceTray from '../components/DiceTray';
import DoublingCube from '../components/DoublingCube';
import CubeOfferDecision from '../components/CubeOfferDecision';
import EndOfGameModal from '../components/EndOfGameModal';
import MatchHeader from '../components/MatchHeader';
import BoardLayout from '../components/BoardLayout';
import ActionButtons from '../components/ActionButtons';
import AutoRollToggle from '../components/AutoRollToggle';
import { useGame, type AIConfig, type TurnRecord } from '../game/useGame';
import { pipCount } from '../engine';
import type { Position } from '../engine/types';
import type { GameResult, MatchState } from '../engine';
import { woodTheme } from '../board/theme';
import { AI_LEVELS, type AILevel } from '../ai';
import { useAuth } from '../lib/auth';
import { createMatch, finishMatch, modeFromAi, saveGame } from '../lib/persistence';
import {
  makeAIIdentity,
  makeGuestIdentity,
  type PlayerIdentity,
} from '../lib/identity';
import { useAutoRoll, useAutoRollEffect } from '../lib/useAutoRoll';

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
  const { user, profile, isLoading: authLoading } = useAuth();

  const opp = params.get('opp');
  const aiConfig = useMemo(() => parseOpponent(opp), [opp]);
  const target = useMemo(() => parseTarget(params.get('target')), [params]);

  const game = useGame({ initialTarget: target, ai: aiConfig });
  const whitePip = pipCount(game.board, 'white');
  const blackPip = pipCount(game.board, 'black');

  // ---- Identities ----
  // Self identity comes from the auth profile when available; otherwise a
  // local guest identity (random name + random avatar) until the profile
  // loads. Opponent is either an AI identity (for vs-AI mode) or another
  // local guest for true hot-seat 2-player.
  const selfIdentity: PlayerIdentity = useMemo(() => {
    if (profile) {
      return { name: profile.display_name, avatarSeed: profile.avatar_seed };
    }
    return makeGuestIdentity();
  }, [profile]);

  // We freeze the opponent identity once per match start so its avatar
  // doesn't reshuffle on every render.
  const opponentIdentityRef = useRef<PlayerIdentity | null>(null);
  if (
    opponentIdentityRef.current === null ||
    (aiConfig && opponentIdentityRef.current.badge !== aiConfig.level.toUpperCase())
  ) {
    opponentIdentityRef.current = aiConfig
      ? makeAIIdentity(aiConfig.level)
      : makeGuestIdentity();
  }
  const opponentIdentity = opponentIdentityRef.current;

  // ---- Persistence ----
  const [matchId, setMatchId] = useState<string | null>(null);
  const persistedGameNumberRef = useRef(0);
  const persistedMatchOverRef = useRef(false);
  const matchCreatedForUserRef = useRef<string | null>(null);

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

  // ---- Auto-roll preference ----
  const [autoRollOn, setAutoRollOn] = useAutoRoll();
  const humanCanInteract = !game.isAITurn && !game.isAIThinking;
  const playerCanRoll =
    game.roll === null && !game.lastGameResult && !game.matchOver && humanCanInteract;
  useAutoRollEffect(autoRollOn, playerCanRoll, game.rollDice);

  // ---- Game UI ----
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

  // ---- Layout ----
  // Local player is white in 2-player hot-seat (and when there's no AI);
  // when playing vs AI, the AI plays black and local player is white.
  const localColor = aiConfig ? (aiConfig.player === 'black' ? 'white' : 'black') : 'white';
  const opponentColor = localColor === 'white' ? 'black' : 'white';
  const localPip = localColor === 'white' ? whitePip : blackPip;
  const opponentPip = opponentColor === 'white' ? whitePip : blackPip;
  const isLocalTurn = game.board.turn === localColor && !game.isAITurn;

  return (
    <BoardLayout
      header={
        <MatchHeader
          match={game.match as MatchState}
          whitePip={whitePip}
          blackPip={blackPip}
          turnLabel={turnLabel}
          inCrawford={game.inCrawfordGame}
          onNewMatch={() => navigate('/')}
        />
      }
      opponent={{
        identity: opponentIdentity,
        pipCount: opponentPip,
        scoreLabel: `${game.match.score[opponentColor]} / ${game.match.target}`,
        isTurn: !isLocalTurn && !showGameEndModal,
      }}
      self={{
        identity: selfIdentity,
        pipCount: localPip,
        scoreLabel: `${game.match.score[localColor]} / ${game.match.target}`,
        isTurn: isLocalTurn && !showGameEndModal,
        bottomSlot: (
          <AutoRollToggle enabled={autoRollOn} onChange={setAutoRollOn} />
        ),
      }}
      actionsOverlay={
        !showGameEndModal && !showCubeDecision ? (
          <ActionButtons
            canRoll={playerCanRoll}
            onRoll={game.rollDice}
            canEndTurn={game.canEndTurn && humanCanInteract}
            onEndTurn={game.endTurn}
            canDouble={game.canOfferDouble}
            onDouble={game.offerDouble}
            cubeValue={game.match.cube.value}
            canUndo={game.canUndo}
            onUndo={game.undoLastMove}
          />
        ) : null
      }
      centerOverlay={
        showCubeDecision ? (
          <CubeOfferDecision
            offeredBy={game.pendingOffer!}
            currentValue={game.match.cube.value}
            onAccept={game.acceptDouble}
            onDrop={game.dropDouble}
          />
        ) : showGameEndModal ? (
          <EndOfGameModal
            result={game.lastGameResult!}
            match={game.match}
            matchOver={game.matchOver}
            onNextGame={game.nextGame}
            onNewMatch={() => navigate('/')}
          />
        ) : null
      }
    >
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
        canOffer={false /* button is in ActionButtons now; we keep the cube
                          as a visual indicator of value/owner only */}
        pendingOffer={game.pendingOffer}
        onOffer={game.offerDouble}
      />
      <DiceTray roll={game.roll} remaining={game.remaining} />
    </BoardLayout>
  );
}
