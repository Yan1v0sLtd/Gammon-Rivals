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

        {/* PLAY button — sits inside the popup near the bottom
         *  (was at bottom: -1.5rem which clipped off-screen on
         *  shorter viewports). Visual style mirrors the carousel
         *  `.lobby-play-button` green-gradient pill but inlined
         *  here so the carousel's mobile-landscape size override
         *  doesn't shrink this one. Tapping it dismisses — the
         *  player returns to the lobby to actually play. */}
        <button
          type="button"
          onClick={onClose}
          className="absolute left-1/2 bottom-[5%] grid h-11 min-w-[8rem] -translate-x-1/2 place-items-center rounded-full border-2 border-[#e0ff8f]/95 px-7 font-display text-lg font-black uppercase tracking-[0.18em] text-[#132109] shadow-[0_5px_0_#06450a,0_13px_22px_rgba(0,0,0,0.34),inset_0_2px_0_rgba(255,255,255,0.74),inset_0_-5px_0_rgba(0,78,5,0.34),0_0_0_2px_rgba(7,27,11,0.85)] transition hover:brightness-110 active:translate-y-[1px]"
          style={{
            background:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.74) 0%, rgba(191, 255, 88, 0.86) 13%, transparent 39%), linear-gradient(180deg, #d6ff73 0%, #8cf244 40%, #20bd1f 68%, #07810d 100%)',
            textShadow: '0 1px 0 rgba(255, 255, 255, 0.28)',
          }}
        >
          Play
        </button>
      </div>
    </div>
  );
}
