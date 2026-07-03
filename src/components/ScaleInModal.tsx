import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';

interface ScaleInModalProps {
  /** Fired on backdrop click (if enabled) and on Escape. */
  readonly onClose?: () => void;
  /** Close when the dimmed backdrop (not the content) is clicked. Default true. */
  readonly closeOnBackdropClick?: boolean;
  /** Close on the Escape key. Default true. */
  readonly closeOnEscape?: boolean;
  /** Classes for the centered content wrapper (sizing, etc.). */
  readonly className?: string;
  /** Inline style for the content wrapper (composed with the entrance transform). */
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}

/**
 * Shared "emerge" modal shell — the springy scale-in entrance the lobby
 * board-purchase popup uses (the diamond/lock → popup effect). Flips an
 * `entered` flag on the frame after mount so the CSS transitions run:
 *   • backdrop fades in
 *   • content springs from ~scale(0.12) up to its natural size
 *
 * The entrance transform lives on a WRAPPER around `children`, so a child
 * that carries its own transform (e.g. a responsive `scale(0.89)`) keeps
 * it — the two compose (the child emerges from 0.12× its own scale up to
 * its own scale). Use this anywhere we want the lobby's signature popup
 * open animation.
 */
export function ScaleInModal({
  onClose,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className,
  style,
  children,
}: ScaleInModalProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!onClose || !closeOnEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, closeOnEscape]);

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (!onClose || !closeOnBackdropClick) return;
    // Only a click on the backdrop itself — not bubbled from the content.
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
      style={{
        // Full-screen backdrop-filter blur was removed for mobile perf (a live
        // blur over the whole animating lobby every time a modal opens). The
        // slightly deeper dim compensates so content behind still recedes.
        background:
          'radial-gradient(circle at center, rgba(28,20,46,0.58), rgba(0,0,0,0.87))',
        opacity: entered ? 1 : 0,
        transition: 'opacity 220ms ease',
      }}
    >
      <div
        className={className}
        style={{
          transformOrigin: 'center',
          // Match the board-purchase popup's springy emerge.
          transform: entered ? 'scaleX(1) scaleY(1)' : 'scaleX(0.16) scaleY(0.12)',
          opacity: entered ? 1 : 0,
          transition:
            'transform 460ms cubic-bezier(0.2, 0.9, 0.2, 1.12), opacity 220ms ease',
          transitionDelay: entered ? '120ms' : '0ms',
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}
