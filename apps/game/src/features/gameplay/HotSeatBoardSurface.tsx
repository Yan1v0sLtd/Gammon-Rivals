import {memo, useCallback, useMemo} from "react"

import {BoardCanvas} from "../../../../../packages/board-renderer/src/BoardCanvas"
import type {AlignmentDebugSelection} from "../../../../../packages/board-renderer/src/pixi/BoardRenderer"
import type {Theme, ThemeLayout} from "../../../../../packages/board-renderer/src/theme/types"
import type {Position} from "../../../../../packages/engine/src/types"
import {DiceTray} from "../../components/DiceTray"
import {createEmptyArray} from "../../lib/constants"
import {useAppDispatch, useAppSelector} from "../../store/hooks"

import {selectBoardPositionViewModel, selectInteractionViewModel, selectPendingOffer, selectSelectionViewModel} from "./gameplaySelectors"
import {checkerMoved, checkerSelected, checkerSelectionCancelled} from "./gameplaySlice"

type Props = {
  readonly canvasMountAllowed: boolean,
  readonly selectedTheme: Theme,
  readonly alignmentEnabled: boolean,
  readonly alignmentDebug: AlignmentDebugSelection,
  readonly alignmentLayout: ThemeLayout,
  readonly onReady: () => void,
  readonly settleSide: "left" | "right",
}

const EMPTY_POSITIONS = createEmptyArray<Position>()

export const HotSeatBoardSurface = memo(function HotSeatBoardSurface({
  canvasMountAllowed,
  selectedTheme,
  alignmentEnabled,
  alignmentDebug,
  alignmentLayout,
  onReady,
  settleSide,
}: Props) {
  const dispatch = useAppDispatch()
  const {board, roll, remaining} = useAppSelector(selectBoardPositionViewModel)
  const selection = useAppSelector(selectSelectionViewModel)
  const interaction = useAppSelector(selectInteractionViewModel)
  const pendingOffer = useAppSelector(selectPendingOffer)

  const renderSelection = useMemo(() => ({
    selectedFrom: !alignmentEnabled && interaction.canInteract && pendingOffer === null ? selection.selectedFrom : null,
    validDestinations: !alignmentEnabled && interaction.canInteract && pendingOffer === null ? selection.validDestinations : EMPTY_POSITIONS,
    legalOrigins: !alignmentEnabled && interaction.canInteract && pendingOffer === null ? selection.legalOrigins : EMPTY_POSITIONS,
    opponentOrigins: alignmentEnabled ? EMPTY_POSITIONS : selection.opponentOrigins,
    opponentDestinations: alignmentEnabled ? EMPTY_POSITIONS : selection.opponentDestinations,
    alignmentDebug: alignmentEnabled ? alignmentDebug : undefined,
  }), [alignmentDebug, alignmentEnabled, interaction.canInteract, pendingOffer, selection])

  const handlePointClick = useCallback((pos: Position) => {
    if (alignmentEnabled || interaction.isFrozen || !interaction.canInteract || pendingOffer !== null) return
    if (selection.selectedFrom === null) {
      dispatch(checkerSelected({from: pos}))
    }
    else if (selection.validDestinations.includes(pos)) {
      dispatch(checkerMoved({from: selection.selectedFrom, to: pos}))
    }
    else if (selection.legalOrigins.includes(pos)) {
      dispatch(checkerSelected({from: pos}))
    }
    else {
      dispatch(checkerSelectionCancelled())
    }
  }, [alignmentEnabled, dispatch, interaction.canInteract, interaction.isFrozen, pendingOffer, selection])

  return (<>
    {canvasMountAllowed ? (<BoardCanvas
      interactionEnabled={!alignmentEnabled && !interaction.isFrozen && interaction.canInteract && pendingOffer === null}
      layoutOverride={alignmentEnabled ? alignmentLayout : undefined}
      selection={renderSelection}
      state={board}
      theme={selectedTheme}
      onPointClick={alignmentEnabled ? undefined : handlePointClick}
      onReady={onReady}/>) : null}
    <DiceTray
      remaining={remaining}
      roll={roll}
      settleSide={settleSide}
      themeSprite={selectedTheme.diceImage}/>
  </>)
})
