import type {Database} from "../../../../packages/shared/src/database"
import type {ProfileProgression} from "../../../../packages/shared/src/progression"
import {CurrencyPill} from "../components/CurrencyPill"
import {useShop} from "../features/appUi/useShop"

import {LobbyProfileCard} from "./LobbyProfileCard"
import {XpBoostBadge} from "./XpBoostBadge"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
type UserWallet = Database["public"]["Tables"]["user_wallets"]["Row"]

type LobbyTopBarProps = {
  readonly profile: ProfileRow | null,
  readonly wallet: UserWallet | null,
  readonly progression: ProfileProgression,
  readonly isGuest: boolean,

}

export function LobbyTopBar({
  profile,
  wallet,
  progression,
}: LobbyTopBarProps) {
  const {openShop} = useShop()
  const currencies = [{
    id: "coins",
    flyTarget: "coins",
    label: "Coins",
    value: wallet?.coins,
    icon: "/lobby/icons/gold-coin.webp",
  }, {
    id: "gems",
    flyTarget: "gems",
    label: "Gems",
    value: wallet?.gems,
    icon: "/lobby/icons/gem.webp",
  }] as const

  return (
    <header className="lobby-topbar relative z-20 grid gap-3 py-3 md:grid-cols-[minmax(16rem,1fr)_auto] md:items-start">
      <div className="lobby-pp-shell relative flex min-w-0 flex-col gap-2">
        <LobbyProfileCard
          profile={profile}
          progression={progression}/>
        {/* XP-boost chip sits BELOW the premium card so it doesn't
            break the card's tight visual grid. Renders nothing when
            no boost is active. The guest "Save progress" CTA that
            used to live here was removed per operator request —
            guests can still link Google from the /profile page. */}
        <div className="flex flex-wrap items-center gap-2">
          <XpBoostBadge/>
        </div>
      </div>

      <div className="lobby-topbar-actions flex flex-wrap items-start justify-end gap-3">
        <div className="lobby-currency-strip flex flex-wrap justify-end gap-3">
          {currencies.map((currency) => (<CurrencyPill
            key={currency.id}
            {...currency}
            onAdd={openShop}/>))}
        </div>
      </div>
    </header>)
}
