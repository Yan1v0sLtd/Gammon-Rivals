import { ScaleInModal } from '../components/ScaleInModal';

interface HowToPlayModalProps {
  readonly onClose: () => void;
}

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
 * The image is rendered at 75% of its natural size (operator spec —
 * "25% smaller than its original") via `width: 75%` on the inner panel.
 */
export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  return (
    <ScaleInModal onClose={onClose} className="relative w-[75%] max-w-[1100px]">
      <img
        src="/lobby/cards/how-to-play-popup.webp"
        alt="How to play backgammon"
        className="block w-full select-none drop-shadow-[0_25px_50px_rgba(0,0,0,0.55)]"
        draggable={false}
      />

      {/* Close (X) — top-right corner. Replaces the old PLAY button; the
       *  popup is purely informational (PLAY lives on the board carousel). */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close how to play"
        className="absolute -right-3 -top-3 z-[1] grid h-10 w-10 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-xl font-black leading-none text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.5)] transition hover:brightness-110 active:scale-95"
      >
        ✕
      </button>
    </ScaleInModal>
  );
}
