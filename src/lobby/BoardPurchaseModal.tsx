interface BoardPurchaseModalProps {
  readonly boardName: string;
  readonly priceGems: number;
  readonly isPurchasing: boolean;
  readonly errorMessage: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function BoardPurchaseModal({
  boardName,
  priceGems,
  isPurchasing,
  errorMessage,
  onConfirm,
  onCancel,
}: BoardPurchaseModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-w-sm rounded-xl border-2 border-amber-700 bg-gradient-to-b from-amber-100 to-amber-300 px-8 py-6 text-center text-amber-950 shadow-2xl">
        <div className="mb-1 font-display text-lg uppercase tracking-wider">Unlock board</div>
        <div className="mb-4 text-xs">{boardName}</div>

        <div className="my-3 inline-flex items-center justify-center gap-2 rounded-lg border-2 border-amber-700 bg-gradient-to-br from-amber-50 to-amber-200 px-4 py-2 font-display text-2xl shadow-inner">
          <img src="/lobby/carousel/gem.webp" alt="" className="h-7 w-7 select-none" draggable={false} />
          <span>{priceGems.toLocaleString()}</span>
        </div>

        <div className="mb-4 text-xs text-amber-900/80">
          Would you like to unlock for <strong>{priceGems.toLocaleString()}</strong> Gems?
        </div>

        {errorMessage ? (
          <div className="mb-3 rounded-md border border-rose-700/40 bg-rose-100 px-3 py-2 text-xs font-bold text-rose-900">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex justify-center gap-3">
          <button
            type="button"
            disabled={isPurchasing}
            onClick={onConfirm}
            className="rounded-md border border-amber-900 bg-amber-700 px-5 py-2 font-medium text-amber-50 shadow transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPurchasing ? 'Unlocking…' : 'Yes'}
          </button>
          <button
            type="button"
            disabled={isPurchasing}
            onClick={onCancel}
            className="rounded-md border border-stone-900 bg-stone-700 px-5 py-2 font-medium text-stone-100 shadow transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
