import { lobbyOffers } from './lobbyData';

interface LobbySideOffersProps {
  readonly onOfferClick?: (offerId: string) => void;
}

export function LobbySideOffers({ onOfferClick }: LobbySideOffersProps = {}) {
  return (
    <aside className="lobby-offers flex flex-row gap-3 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible xl:pb-0">
      {lobbyOffers.map((offer) => (
        <button
          key={offer.id}
          type="button"
          onClick={() => onOfferClick?.(offer.id)}
          style={offer.image ? { aspectRatio: offer.aspectRatio } : undefined}
          className={`lobby-offer-card relative flex min-h-[6.7rem] min-w-[13rem] flex-1 items-center gap-3 overflow-hidden text-left transition hover:brightness-110 active:translate-y-1 ${
            offer.image
              ? 'rounded-lg border border-white/22 bg-black/20 p-0 shadow-[0_9px_18px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.16)]'
              : `rounded-lg border border-white/25 bg-gradient-to-br ${offer.tone} shadow-[0_9px_18px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]`
          }`}
        >
          {offer.image ? (
            <>
              <img
                src={offer.image}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
              <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,transparent_72%,rgba(0,0,0,0.42)_100%)]" />
              <span className="lobby-offer-arrow" aria-hidden="true">›</span>
            </>
          ) : (
            <>
              <span className="absolute inset-x-0 bottom-0 h-10 bg-black/16" />
              <span className="relative ml-4 grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-[#f9d96c] bg-gradient-to-b from-[#fff5a9] to-[#d79a20] text-3xl font-black text-[#351c05] shadow-[0_5px_0_rgba(0,0,0,0.25)]">
                {offer.symbol}
              </span>
              <span className="relative min-w-0">
                <span className="block font-display text-xl font-black uppercase leading-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
                  {offer.title}
                </span>
                <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-white/70">
                  {offer.subtitle}
                </span>
              </span>
              <span className="lobby-offer-arrow" aria-hidden="true">›</span>
            </>
          )}
        </button>
      ))}
    </aside>
  );
}
