import {memo} from "react"

import {skipToken} from "@reduxjs/toolkit/query"

import {IntroBanner} from "../../components/IntroBanner"
import {aiIdentityFromSeed} from "../../lib/identity"
import {useAppSelector} from "../../store/hooks"
import {selectCurrentProfile} from "../auth/authSelectors"
import {useGetProfileQuery} from "../playerData/playerDataApi"

import {selectEffectiveTurn, selectIsBot, selectLocalColor, selectRemoteOpponentId} from "./onlineMatchSelectors"

export type OnlineIntroBannerProps = {
  matchId: string,
  onDismiss: () => void,
}

export const OnlineIntroBanner = memo(function OnlineIntroBanner({matchId, onDismiss}: OnlineIntroBannerProps) {
  const selfProfile = useAppSelector(selectCurrentProfile)
  const isBot = useAppSelector((state) => selectIsBot(state, matchId))
  const remoteId = useAppSelector((state) => selectRemoteOpponentId(state, matchId))
  const localColor = useAppSelector((state) => selectLocalColor(state, matchId))
  const firstRollerColor = useAppSelector((state) => selectEffectiveTurn(state, matchId))
  const {data: remoteProfile} = useGetProfileQuery(isBot ? skipToken : remoteId ?? skipToken)

  const selfName = selfProfile?.display_name
  const opponentName = isBot ? aiIdentityFromSeed(matchId).name : remoteProfile?.display_name
  const firstRollerIsLocal = firstRollerColor === localColor
  const firstRollerName = firstRollerIsLocal ? selfName ?? "You" : opponentName ?? "Opponent"

  return (
    <IntroBanner
      subtitle={firstRollerIsLocal
        ? `${selfName ?? "You"} (${firstRollerColor}) start the match.`
        : `${firstRollerName} (${firstRollerColor}) starts the match.`}
      title={firstRollerIsLocal ? "You roll first" : `${firstRollerName} rolls first`}
      onDismiss={onDismiss}/>
  )
})
