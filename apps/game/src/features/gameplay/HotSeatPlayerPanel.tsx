import {memo} from "react"

import {MatchSecondaryControls} from "../../components/MatchSecondaryControls"
import {AutoRollToggle} from "../../components/AutoRollToggle"
import {DoublesStat} from "../../components/DoublesStat"
import {PipCountStat} from "../../components/PipCountStat"
import {ScoreStat} from "../../components/ScoreStat"
import {SeatTurnTimer} from "../../components/SeatTurnTimer"
import {SelfIdentityBlock} from "../../components/SelfIdentityBlock"
import {PlayerIdentityBlock} from "../../components/PlayerIdentityBlock"
import {PlayerPanelShell} from "../../components/PlayerPanelShell"
import {useIsMobileLayout} from "../../lib/useMediaQuery"
import {useAppSelector} from "../../store/hooks"

import {selectCubeValue, selectMatchTarget, selectOpponentIdentity, selectOpponentIsTurn, selectOpponentLevel, selectOpponentStateLabel, selectSelfIsTurn} from "./gameplaySelectors"

type Props = {
  readonly seat: "self" | "opponent",
  readonly controlsVisible?: boolean,
  readonly canDouble?: boolean,
  readonly autoRollEnabled?: boolean,
  readonly onAutoRollChange?: (next: boolean) => void,
  readonly onDouble?: () => void,
}

const noop = () => undefined

const OpponentIdentity = memo(function OpponentIdentity({compact}: {readonly compact: boolean}) {
  const level = useAppSelector(selectOpponentLevel)
  const stateLabel = useAppSelector(selectOpponentStateLabel)
  const identity = useAppSelector(selectOpponentIdentity)
  const avatarSize = compact ? 58 : 106

  return (<PlayerIdentityBlock
    avatarSize={avatarSize}
    coinsLabel="—"
    compact={compact}
    identity={identity}
    innerAvatarSize={Math.round(avatarSize * 0.66)}
    level={level}
    stateLabel={stateLabel}
    textAlign="text-center"/>)
})

const HotSeatControls = memo(function HotSeatControls({
  autoRollEnabled = false,
  canDouble = false,
  onAutoRollChange,
  onDouble,
}: Pick<Props, "canDouble" | "autoRollEnabled" | "onAutoRollChange" | "onDouble">) {
  const cubeValue = useAppSelector(selectCubeValue)
  const matchTarget = useAppSelector(selectMatchTarget)

  return (
    <MatchSecondaryControls
      autoRollSlot={<AutoRollToggle
        enabled={autoRollEnabled}
        variant="inline"
        onChange={onAutoRollChange ?? noop}/>}
      canDouble={canDouble}
      cubeValue={cubeValue}
      showCube={matchTarget > 1}
      onDouble={onDouble ?? noop}/>
  )
})

export const HotSeatPlayerPanel = memo(function HotSeatPlayerPanel({
  seat,
  controlsVisible = false,
  canDouble = false,
  autoRollEnabled = false,
  onAutoRollChange,
  onDouble,
}: Props) {
  const compact = useIsMobileLayout()
  const isTurn = useAppSelector(seat === "self" ? selectSelfIsTurn : selectOpponentIsTurn)
  const side = seat === "opponent" ? "left" : "right"

  const identity = seat === "self"
    ? (<SelfIdentityBlock
      compact={compact}/>)
    : (<OpponentIdentity
      compact={compact}/>)
  const stats = (<>
    <PipCountStat
      compact={compact}
      mode="hotseat"
      seat={seat}/>
    <ScoreStat
      compact={compact}
      mode="hotseat"
      seat={seat}/>
    <DoublesStat
      compact={compact}
      mode="hotseat"/>
  </>)
  const bottomSlot = seat === "self" && controlsVisible
    ? (<HotSeatControls
      autoRollEnabled={autoRollEnabled}
      canDouble={canDouble}
      onAutoRollChange={onAutoRollChange}
      onDouble={onDouble}/>)
    : undefined

  return (<PlayerPanelShell
    align={side === "left" ? "items-start" : "items-end"}
    bottomSlot={bottomSlot}
    compact={compact}
    identity={identity}
    isTurn={isTurn}
    side={side}
    stats={stats}
    timer={<SeatTurnTimer
      compact={compact}
      mode="hotseat"
      seat={seat}/>}/>)
})
