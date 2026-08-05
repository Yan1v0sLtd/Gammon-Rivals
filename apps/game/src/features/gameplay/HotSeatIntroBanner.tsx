import {memo} from "react"

import {IntroBanner} from "../../components/IntroBanner"
import {useAppSelector} from "../../store/hooks"

import {selectLocalColor, selectOpeningPlayer, selectOpponentIdentity} from "./gameplaySelectors"

// Who opens THIS match (game 1). The opening turn is randomized per game by
// the slice's randomFirstBoard (gameplayActions.gameplayRouteEntered's prepare callback);
// selectOpeningPlayer derives the opener live — turnLog[0].player once the
// first turn is logged, board.turn before any roll — so the banner label
// stays correct even after the opener (esp. the AI) takes its turn and
// flips board.turn.
export const HotSeatIntroBanner = memo(function HotSeatIntroBanner({onDismiss}: {onDismiss: () => void}) {
  const starterColor = useAppSelector(selectOpeningPlayer)
  const localColor = useAppSelector(selectLocalColor)
  const opponentIdentity = useAppSelector(selectOpponentIdentity)
  const starterIsLocal = starterColor === localColor

  return (
    <IntroBanner
      subtitle={starterIsLocal ? `You start the match as ${starterColor}.` : `${opponentIdentity.name} starts the match as ${starterColor}.`}
      title={starterIsLocal ? "You roll first" : `${opponentIdentity.name} rolls first`}
      onDismiss={onDismiss}/>
  )
})
