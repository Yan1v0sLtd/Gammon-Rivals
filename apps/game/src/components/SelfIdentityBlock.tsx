import {memo} from "react"

import {selectCurrentProfile, selectCurrentWallet, selectProfileProgression} from "../features/auth/authSelectors"
import {formatCompactNumber} from "../lib/format"
import {getSessionGuestIdentity} from "../lib/identity"
import {useAppSelector} from "../store/hooks"

import {PlayerIdentityBlock} from "./PlayerIdentityBlock"

export const SelfIdentityBlock = memo(function SelfIdentityBlock({compact = false}: {readonly compact?: boolean}) {
  const profile = useAppSelector(selectCurrentProfile)
  const wallet = useAppSelector(selectCurrentWallet)
  const progression = useAppSelector(selectProfileProgression)
  const identity = profile ? {
    name: profile.display_name,
    avatarSeed: profile.avatar_seed,
    avatarUrl: profile.avatar_url,
  } : getSessionGuestIdentity()
  const avatarSize = compact ? 58 : 106

  return (
    <PlayerIdentityBlock
      avatarSize={avatarSize}
      coinsLabel={formatCompactNumber(wallet?.coins)}
      compact={compact}
      identity={identity}
      innerAvatarSize={Math.round(avatarSize * 0.66)}
      level={progression.level}
      side="right"
      stateLabel={progression.statusLabel}/>
  )
})
