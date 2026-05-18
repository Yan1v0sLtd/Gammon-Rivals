import type { FC } from 'react';

interface Props {
  /** Optional 0..1 progress fraction. When provided, a percentage is
   *  shown after the label. */
  readonly progress?: number;
  readonly label?: string;
}

export const LoadingScreen: FC<Props> = ({ progress, label = 'Loading' }) => {
  const pct =
    typeof progress === 'number'
      ? Math.round(Math.max(0, Math.min(1, progress)) * 100)
      : null;

  return (
    <main
      className="fixed inset-0 z-[999] flex items-center justify-center bg-[radial-gradient(circle_at_center,#1a1027_0%,#070310_70%,#000000_100%)]"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center">
        <h1 className="font-display text-3xl font-black uppercase tracking-[0.32em] text-[#ffd16f] drop-shadow-[0_4px_18px_rgba(255,200,80,0.45)] md:text-5xl">
          Gammon Rivals
        </h1>
        <div className="mt-10 flex flex-col items-center gap-3">
          <div
            className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#ffd16f]/25 border-t-[#ffd16f]"
            aria-hidden="true"
          />
          <div className="text-xs font-bold uppercase tracking-[0.32em] text-[#ffe0a0]/80">
            {label}
            {pct !== null ? <span className="ml-1">{pct}%</span> : null}
          </div>
        </div>
      </div>
    </main>
  );
};
