import { useEffect } from 'react';

interface HowToPlayModalProps {
  readonly onClose: () => void;
}

/**
 * Static tutorial popup — triggered from the "How to Play" side-rail
 * icon in the lobby. Shows the prepared backgammon tutorial image
 * (`/lobby/cards/how-to-play-popup.webp`) centred over a darkened
 * backdrop with a CSS gold-gradient PLAY button at the bottom that
 * closes the popup.
 *
 * The image is rendered at 75% of its natural size (operator spec —
 * "25% smaller than its original") via `width: 75%` on the inner
 * panel. The image keeps its native aspect ratio so the tutorial
 * artwork doesn't distort.
 *
 * Tap-outside the panel + the Escape key + the PLAY button all
 * dismiss via the same `onClose` handler.
 */
export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  // Escape closes. Same pattern used by DifficultyModal and friends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="How to play backgammon"
    >
      {/* Inner panel — 75% width so the popup is "25% smaller than
       *  its original" per operator request. The image carries its
       *  own gold frame so we don't add an outer card chrome. */}
      <div
        className="relative w-[75%] max-w-[1100px]"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src="/lobby/cards/how-to-play-popup.webp"
          alt="How to play backgammon"
          className="block w-full select-none drop-shadow-[0_25px_50px_rgba(0,0,0,0.55)]"
          draggable={false}
        />

        {/* PLAY button — gold gradient, centred under the popup.
         *  Tapping it dismisses (the player returns to the lobby
         *  to actually play). */}
        <button
          type="button"
          onClick={onClose}
          className="absolute left-1/2 bottom-[-1.5rem] grid h-12 min-w-[10rem] -translate-x-1/2 place-items-center rounded-xl border-2 border-[#8a5100] bg-gradient-to-b from-[#fff7b3] via-[#ffc21a] to-[#d66c00] px-8 font-display text-xl font-black uppercase tracking-[0.16em] text-[#3a1f08] shadow-[0_8px_18px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.5)] transition hover:brightness-110 active:translate-y-[1px]"
        >
          Play
        </button>
      </div>
    </div>
  );
}
