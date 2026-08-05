import {memo, useCallback, useMemo} from "react"

import {BoardCanvas} from "../../../../../packages/board-renderer/src/BoardCanvas"
import type {Theme} from "../../../../../packages/board-renderer/src/theme/types"
import type {Position} from "../../../../../packages/engine/src/types"
import {DiceTray} from "../../components/DiceTray"
import {createEmptyArray} from "../../lib/constants"
import {toApiError} from "../../store/baseApi"
import {useAppDispatch, useAppSelector} from "../../store/hooks"

import {useSubmitSubMoveMutation} from "./onlineMatchApi"
import {encodeMove, selectBoardPositionViewModel, selectCurrentTurn, selectGameWinner, selectInteractionViewModel, selectLocalLegalMoves, selectMatch, selectSelectionViewModel} from "./onlineMatchSelectors"
import {checkerSelected, checkerSelectionCancelled} from "./onlineMatchSlice"

type Props = {
  readonly matchId: string,
  readonly selectedTheme: Theme,
  readonly isSpectator: boolean,
  readonly onActionError: (message: string) => void,
  readonly settleSide: "left" | "right",
}

const EMPTY_POSITIONS = createEmptyArray<Position>()

export const OnlineBoardSurface = memo(function OnlineBoardSurface({matchId, selectedTheme, isSpectator, onActionError, settleSide}: Props) {
  const dispatch = useAppDispatch()
  const {board, roll, remaining} = useAppSelector((state) => selectBoardPositionViewModel(state, matchId))
  const selection = useAppSelector((state) => selectSelectionViewModel(state, matchId))
  const interaction = useAppSelector((state) => selectInteractionViewModel(state, matchId))
  const currentTurn = useAppSelector((state) => selectCurrentTurn(state, matchId))
  const match = useAppSelector((state) => selectMatch(state, matchId))
  const localLegalMoves = useAppSelector((state) => selectLocalLegalMoves(state, matchId))
  const gameWinner = useAppSelector((state) => selectGameWinner(state, matchId))
  const [triggerSubmitSubMove, {isLoading: submitPending}] = useSubmitSubMoveMutation()

  const renderSelection = useMemo(() => ({
    selectedFrom: interaction.canInteract && !isSpectator && gameWinner === null ? selection.selectedFrom : null,
    validDestinations: interaction.canInteract && !isSpectator && gameWinner === null ? selection.validDestinations : EMPTY_POSITIONS,
    legalOrigins: interaction.canInteract && !isSpectator && gameWinner === null ? selection.legalOrigins : EMPTY_POSITIONS,
    opponentOrigins: selection.opponentOrigins,
    opponentDestinations: selection.opponentDestinations,
  }), [gameWinner, interaction.canInteract, isSpectator, selection])

  const selectFrom = useCallback((pos: Position) => {
    if (isSpectator || !interaction.canInteract || gameWinner !== null || !currentTurn) return
    if (!selection.legalOrigins.includes(pos)) {
      dispatch(checkerSelectionCancelled())
      return
    }
    dispatch(checkerSelected({from: pos}))
  }, [currentTurn, dispatch, gameWinner, interaction.canInteract, isSpectator, selection.legalOrigins])

  const selectTo = useCallback(async (pos: Position) => {
    if (isSpectator || !interaction.canInteract || gameWinner !== null || !matchId || !match || !currentTurn || selection.selectedFrom === null || submitPending) return
    const move = localLegalMoves.find((candidate) => candidate.from === selection.selectedFrom && candidate.to === pos)
    if (!move) return
    const newSubMoves = [...currentTurn.subMoves, encodeMove(move)]
    const index = currentTurn.remaining.indexOf(move.die)
    const newRemaining = index >= 0
      ? [...currentTurn.remaining.slice(0, index), ...currentTurn.remaining.slice(index + 1)]
      : [...currentTurn.remaining]
    dispatch(checkerSelectionCancelled())
    try {
      await triggerSubmitSubMove({matchId, currentTurn: {...currentTurn, subMoves: newSubMoves, remaining: newRemaining}}).unwrap()
    }
    catch (err) {
      onActionError(toApiError(err).message)
    }
  }, [currentTurn, dispatch, gameWinner, interaction.canInteract, isSpectator, localLegalMoves, match, matchId, onActionError, selection.selectedFrom, submitPending, triggerSubmitSubMove])

  const handlePointClick = useCallback((pos: Position) => {
    if (isSpectator || !interaction.canInteract || gameWinner !== null) return
    if (selection.selectedFrom === null) selectFrom(pos)
    else if (selection.validDestinations.includes(pos)) void selectTo(pos)
    else if (selection.legalOrigins.includes(pos)) selectFrom(pos)
    else dispatch(checkerSelectionCancelled())
  }, [dispatch, gameWinner, interaction.canInteract, isSpectator, selectFrom, selectTo, selection])

  return (<>
    <BoardCanvas
      interactionEnabled={!isSpectator && interaction.isLocalTurn && interaction.canInteract && !interaction.isFinished}
      selection={renderSelection}
      state={board}
      theme={selectedTheme}
      onPointClick={handlePointClick}/>
    <DiceTray
      remaining={remaining}
      roll={roll}
      settleSide={settleSide}
      themeSprite={selectedTheme.diceImage}/>
  </>)
})
