import {ModalCloseButton} from "../../components/ModalCloseButton"
import {ScaleInModal} from "../../components/ScaleInModal"
import {useImagePreloader} from "../../lib/useImagePreloader"

import styles from "./HowToPlayModal.module.css"

type HowToPlayModalProps = {
  readonly onClose: () => void,
}

const HOW_TO_PLAY_IMG = "/lobby/cards/how-to-play-popup.webp"
const HOW_TO_PLAY_ASSETS: readonly string[] = [HOW_TO_PLAY_IMG]

/**
 * Static tutorial popup — triggered from the "How to Play" side-rail
 * icon in the lobby. Shows the prepared backgammon tutorial image
 * (`/lobby/cards/how-to-play-popup.webp`) centred over a darkened
 * backdrop with a close (X) button in the top-right corner.
 *
 * Opens with the shared ScaleInModal "emerge" animation (same springy
 * scale-in the board-purchase popup uses). ScaleInModal owns the
 * backdrop, the tap-outside-to-close, and the Escape key.
 *
 * The image + close button are held until the image is decoded so the
 * close button never appears over an empty (zero-height) panel — the old
 * "X shows before the popup" jank. The asset is prefetched on idle from
 * the lobby (LOBBY_SECONDARY_ASSETS), so `ready` is normally instant; the
 * brief spinner only shows if the popup is opened before that finished.
 *
 * The image is rendered at 75% of its natural size (operator spec —
 * "25% smaller than its original") via `width: 75%` on the inner panel.
 */
export function HowToPlayModal({onClose}: HowToPlayModalProps) {
  const {ready} = useImagePreloader(HOW_TO_PLAY_ASSETS)

  return (<ScaleInModal
    className={styles.modalRoot}
    onClose={onClose}>
    {ready ? (<>
      <img
        alt="How to play backgammon"
        className={styles.tutorialImg}
        draggable={false}
        src={HOW_TO_PLAY_IMG}/>

      {/* Close (X) — INSIDE the frame's top-right corner, on the navy
           *  field just inside the gold border bracket. Replaces the old
           *  PLAY button; the popup is purely informational (PLAY lives on
           *  the board carousel). Shared with the Daily Bonus modal so both
           *  close buttons are identical in size + style. */}
      <ModalCloseButton
        ariaLabel="Close how to play"
        className={styles.closeButton}
        onClose={onClose}/>
    </>) : (// Brief placeholder so the panel has size while the image decodes
      // (only visible if opened before the idle prefetch warmed the cache).
      <div className={styles.loadingGrid}>
        <span className={styles.spinner}/>
      </div>)}
  </ScaleInModal>)
}
