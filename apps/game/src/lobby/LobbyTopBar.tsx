import type {Database} from "../../../../packages/shared/src/database"
import type {ProfileProgression} from "../../../../packages/shared/src/progression"
import {CurrencyPill} from "../components/CurrencyPill"
import {useShop} from "../features/appUi/useShop"

import {LobbyProfileCard} from "./LobbyProfileCard"
import styles from "./LobbyTopBar.module.css"
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
    <header className={styles.topBar}>
      <div className={styles.profileShell}>
        <LobbyProfileCard
          profile={profile}
          progression={progression}/>
        {/* XP-boost chip sits BELOW the premium card so it doesn't
            break the card's tight visual grid. Renders nothing when
            no boost is active. The guest "Save progress" CTA that
            used to live here was removed per operator request —
            guests can still link Google from the /profile page. */}
        <div className={styles.xpBoostRow}>
          <XpBoostBadge/>
        </div>
      </div>

      <div className={styles.topBarActions}>
        <div className={styles.currencyStrip}>
          {currencies.map((currency) => (<CurrencyPill
            key={currency.id}
            {...currency}
            onAdd={openShop}/>))}
        </div>
      </div>
    </header>)
}
