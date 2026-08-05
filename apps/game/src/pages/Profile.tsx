import {selectAuthInitializing} from "../features/auth/authSelectors"
import {ProfileAccountActions} from "../features/profile/ProfileAccountActions"
import {ProfileMainCard} from "../features/profile/ProfileMainCard"
import {ProfileMatchHistory} from "../features/profile/ProfileMatchHistory"
import {ProfileSaveProgress} from "../features/profile/ProfileSaveProgress"
import {ProfileStats} from "../features/profile/ProfileStats"
import {ProfileTopNav} from "../features/profile/ProfileTopNav"
import {useAppSelector} from "../store/hooks"

import styles from "./Profile.module.css"

export function Profile() {
  const isLoading = useAppSelector(selectAuthInitializing)

  if (isLoading) {
    return (<main className={`${styles.profilePage} ${styles.profilePageLoading}`}>
      <div className={styles.profileLoadingText}>
        Loading
      </div>
    </main>)
  }

  return (<main className={styles.profilePage}>
    <div className={styles.profileScreen}>
      <ProfileTopNav/>

      {/* Two-column body: profile + stats + logout on the left,
          * match history (tall) on the right so the player can scan
          * more matches without scrolling. */}
      <div className={styles.profileBodyGrid}>
        <div className={styles.profileLeftStack}>
          <ProfileMainCard/>

          {/* Guest-only "save your progress" CTA — a full-width banner
              * directly below the card. Absent for signed-in users, so
              * their stack stays card -> stats -> logout. */}
          <ProfileSaveProgress/>

          {/* Four match-stats under the avatar/info card. Wallet
              * balances live in the top bar, not here. */}
          <ProfileStats/>

          <ProfileAccountActions/>
        </div>

        <ProfileMatchHistory/>
      </div>
    </div>
  </main>)
}
