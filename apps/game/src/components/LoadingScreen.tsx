import type { FC } from 'react';
import { getLoadingScreenImage } from '../lib/loadingScreenImage';

interface Props {
  /** Optional 0..1 progress fraction. When provided the bar is
   *  deterministic; otherwise it eases toward ~90% on its own. */
  readonly progress?: number;
  readonly label?: string;
}

/**
 * Full-art loading screen: BO-managed background image (see
 * lib/loadingScreenImage.ts — localStorage-cached, bundled fallback) with
 * the gold striped progress bar from the brand mockup overlaid near the
 * bottom. Used as the Suspense fallback and inside NavigationOverlay, so
 * it must render instantly with zero network — the image getter is
 * synchronous and the bar is pure CSS (composited transform animation).
 */
export const LoadingScreen: FC<Props> = ({ progress, label = 'Loading' }) => {
  const pct =
    typeof progress === 'number'
      ? Math.round(Math.max(0, Math.min(1, progress)) * 100)
      : null;

  return (
    <main
      className="fixed inset-0 z-[999] bg-[radial-gradient(circle_at_center,#1a1027_0%,#070310_70%,#000000_100%)]"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={pct !== null ? `${label} ${pct}%` : label}
    >
      <img
        src={getLoadingScreenImage()}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover"
      />

      {/* Bar block — sits in the art's dark bottom band, mockup-style. */}
      <div className="gr-loadingscreen-hud">
        <div className="gr-loadingscreen-label" aria-hidden="true">
          <span className="gr-loadingscreen-tail gr-loadingscreen-tail--l" />
          <span>
            {label}
            {pct !== null ? <span className="ml-2">{pct}%</span> : null}
          </span>
          <span className="gr-loadingscreen-tail gr-loadingscreen-tail--r" />
        </div>
        <div className="gr-loadingscreen-track">
          {/* The clip wrapper is what keeps the sliding fill INSIDE the
              rounded track — clip-path on the fill itself travels with its
              transform, so it never clipped anything (the bar visibly slid
              in from outside the frame). */}
          <div className="gr-loadingscreen-clip">
            <div
              className="gr-loadingscreen-fill"
              style={
                pct !== null
                  ? {
                      // Deterministic: driven by the caller's real progress.
                      animation: 'none',
                      transform: `translateX(-${100 - Math.max(pct, 4)}%)`,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
};
