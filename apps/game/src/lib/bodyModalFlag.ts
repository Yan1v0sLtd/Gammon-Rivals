import {useEffect} from "react"

/**
 * Ref-counted `<body data-fullscreen-modal>` flag — "a full-screen modal is open".
 *
 * Why: the lobby keeps animating underneath open modals (Sunbeam canvas,
 * XP-bar flow, PLAY shimmer, wheel halo). None of it is visible behind the
 * dimmed backdrop, but phones still pay style/paint/composite for every
 * frame of it — while ALSO rendering the modal. The flag lets one CSS rule
 * pause the known infinite animations and lets the Sunbeam's rAF loop skip
 * drawing, so an open modal gets the whole GPU/CPU budget.
 *
 * Ref-counted because two independent owners write it (ShopHost for the
 * shop popup, LobbyScreen for the lobby modals) and modals can stack.
 */
let openCount = 0

function applyFlag(): void {
  if (openCount > 0) {
    document.body.dataset.fullscreenModal = "1"
  }
  else {
    delete document.body.dataset.fullscreenModal
  }
}

export function useBodyModalFlag(active: boolean): void {
  useEffect(() => {
    if (!active) return
    openCount += 1
    applyFlag()
    return () => {
      openCount = Math.max(0, openCount - 1)
      applyFlag()
    }
  }, [active])
}
