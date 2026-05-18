import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatCompactNumber } from '../lib/format';

// -----------------------------------------------------------------------------
// Sample data — Phase 1 layout uses inline content so we can iterate on
// visuals without round-tripping to the DB. Phase 2 will swap this for
// supabase.from('shop_items').select() with the same shape.
// -----------------------------------------------------------------------------

interface TopOffer {
  readonly id: string;
  readonly ribbon: 'best-value' | 'popular' | null;
  readonly icon: string;
  readonly headlineLabel: string; // e.g., "10,000" — bold value
  readonly headlineKind: 'gems' | 'coins' | 'xp-boost' | 'lucky-dice';
  readonly headlineSubLabel?: string; // e.g., "7 Days" or "Lucky Dice Pack"
  readonly bonuses: ReadonlyArray<{ kind: 'gems' | 'coins' | 'chest'; amount: number }>;
  readonly priceUsd: number;
}

const TOP_OFFERS: readonly TopOffer[] = [
  {
    id: 'vault-of-gems',
    ribbon: 'best-value',
    icon: '/lobby/carousel/gem.webp',
    headlineLabel: '10,000',
    headlineKind: 'gems',
    bonuses: [
      { kind: 'coins', amount: 50_000 },
      { kind: 'chest', amount: 10 },
    ],
    priceUsd: 99.99,
  },
  {
    id: 'sack-of-gems',
    ribbon: 'popular',
    icon: '/lobby/carousel/gem.webp',
    headlineLabel: '5,000',
    headlineKind: 'gems',
    bonuses: [
      { kind: 'coins', amount: 25_000 },
      { kind: 'chest', amount: 5 },
    ],
    priceUsd: 49.99,
  },
  {
    id: 'bowl-of-gems',
    ribbon: null,
    icon: '/lobby/carousel/gem.webp',
    headlineLabel: '2,500',
    headlineKind: 'gems',
    bonuses: [{ kind: 'coins', amount: 10_000 }],
    priceUsd: 24.99,
  },
  {
    id: 'coin-stack',
    ribbon: null,
    icon: '/lobby/icons/gold-coin.webp',
    headlineLabel: '100,000',
    headlineKind: 'coins',
    bonuses: [{ kind: 'gems', amount: 1_000 }],
    priceUsd: 19.99,
  },
  {
    id: 'xp-boost-7d',
    ribbon: null,
    icon: '',
    headlineLabel: 'XP BOOST (7D)',
    headlineKind: 'xp-boost',
    headlineSubLabel: '7 Days',
    bonuses: [{ kind: 'gems', amount: 500 }],
    priceUsd: 14.99,
  },
  {
    id: 'lucky-dice',
    ribbon: null,
    icon: '',
    headlineLabel: 'LUCKY DICE PACK',
    headlineKind: 'lucky-dice',
    bonuses: [{ kind: 'gems', amount: 300 }],
    priceUsd: 9.99,
  },
];

interface DailyDeal {
  readonly id: string;
  readonly title: string;
  readonly kind: 'gems' | 'coins' | 'xp-boost' | 'lucky-dice';
  readonly amount: string; // display string e.g., "200", "5,000", "3 Days", "x2"
  readonly priceGems: number;
}

const DAILY_DEALS: readonly DailyDeal[] = [
  { id: 'dd-gems', title: 'Pile of Gems', kind: 'gems', amount: '200', priceGems: 150 },
  { id: 'dd-coins', title: 'Stack of Coins', kind: 'coins', amount: '5,000', priceGems: 120 },
  { id: 'dd-xp', title: 'XP Boost (3d)', kind: 'xp-boost', amount: '3 Days', priceGems: 250 },
  { id: 'dd-dice', title: 'Lucky Dice', kind: 'lucky-dice', amount: 'x2', priceGems: 200 },
];

type TabId = 'featured' | 'gems' | 'coins' | 'items' | 'offers';

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: string }> = [
  { id: 'featured', label: 'Featured', icon: '★' },
  { id: 'gems', label: 'Gems', icon: '◆' },
  { id: 'coins', label: 'Coins', icon: '⊙' },
  { id: 'items', label: 'Items', icon: '⛁' },
  { id: 'offers', label: 'Offers', icon: '✦' },
];

// -----------------------------------------------------------------------------
// Reusable bits
// -----------------------------------------------------------------------------

function GemIcon({ className = '' }: { className?: string }) {
  return (
    <img
      src="/lobby/carousel/gem.webp"
      alt=""
      className={`select-none object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`}
      draggable={false}
    />
  );
}

function CoinIcon({ className = '' }: { className?: string }) {
  return (
    <img
      src="/lobby/icons/gold-coin.webp"
      alt=""
      className={`select-none object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`}
      draggable={false}
    />
  );
}

function ChestIcon({ className = '' }: { className?: string }) {
  // Inline SVG treasure chest so we don't need yet another asset.
  return (
    <svg
      viewBox="0 0 24 24"
      className={`drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="shop-chest-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a07237" />
          <stop offset="100%" stopColor="#5a3d18" />
        </linearGradient>
        <linearGradient id="shop-chest-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <rect x="3" y="8" width="18" height="11" rx="1.5" fill="url(#shop-chest-body)" />
      <path d="M3 8 Q3 4 7 4 H17 Q21 4 21 8 Z" fill="url(#shop-chest-body)" />
      <rect x="3" y="11.5" width="18" height="2" fill="url(#shop-chest-band)" />
      <rect x="11" y="11.5" width="2" height="6" fill="url(#shop-chest-band)" />
      <circle cx="12" cy="14" r="0.9" fill="#fef3c7" />
    </svg>
  );
}

function XpBadge({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const h = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-20' : 'h-14';
  return (
    <svg viewBox="0 0 100 110" className={`${h} w-auto drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)]`} aria-hidden="true">
      <defs>
        <linearGradient id="shop-xp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#581c87" />
        </linearGradient>
        <linearGradient id="shop-xp-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <polygon points="50,3 96,28 96,82 50,107 4,82 4,28" fill="url(#shop-xp-rim)" />
      <polygon points="50,11 88,33 88,77 50,99 12,77 12,33" fill="url(#shop-xp-fill)" />
      <text
        x="50"
        y="68"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="900"
        fontSize="34"
        fill="white"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
      >
        XP
      </text>
    </svg>
  );
}

function DiceIcon({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  // Two stacked dice via SVG. Simple but recognizable.
  const h = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-20' : 'h-14';
  return (
    <svg viewBox="0 0 100 80" className={`${h} w-auto drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)]`} aria-hidden="true">
      <defs>
        <linearGradient id="shop-dice-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#e7d09a" />
        </linearGradient>
      </defs>
      {/* Back die */}
      <rect x="42" y="6" width="42" height="42" rx="6" fill="url(#shop-dice-fill)" stroke="#3a1f08" strokeWidth="2" />
      <circle cx="63" cy="27" r="3" fill="#3a1f08" />
      {/* Front die */}
      <rect x="14" y="28" width="46" height="46" rx="6" fill="url(#shop-dice-fill)" stroke="#3a1f08" strokeWidth="2" />
      <circle cx="25" cy="40" r="3" fill="#3a1f08" />
      <circle cx="49" cy="40" r="3" fill="#3a1f08" />
      <circle cx="37" cy="51" r="3" fill="#3a1f08" />
      <circle cx="25" cy="62" r="3" fill="#3a1f08" />
      <circle cx="49" cy="62" r="3" fill="#3a1f08" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Top Offer card (real-money packages)
// -----------------------------------------------------------------------------

function TopOfferCard({ offer, onBuy }: { offer: TopOffer; onBuy: () => void }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-b from-[#fdf6e3] to-[#f0e1b8] p-3 shadow-[0_10px_14px_-4px_rgba(120,53,15,0.45)]">
      {offer.ribbon ? (
        <div className="pointer-events-none absolute -left-px -top-px h-24 w-24 overflow-hidden">
          <div
            className={`absolute -left-8 top-4 origin-center -rotate-45 px-9 py-1 font-display text-[clamp(0.55rem,1.1vw,0.75rem)] font-black uppercase tracking-[0.16em] text-white shadow-[0_2px_4px_rgba(0,0,0,0.35)] ${
              offer.ribbon === 'best-value'
                ? 'bg-gradient-to-b from-rose-500 to-rose-700'
                : 'bg-gradient-to-b from-violet-500 to-violet-700'
            }`}
          >
            {offer.ribbon === 'best-value' ? 'Best Value!' : 'Popular'}
          </div>
        </div>
      ) : null}

      {/* Hero icon */}
      <div className="flex h-24 items-center justify-center">
        {offer.headlineKind === 'gems' && <GemIcon className="h-20 w-20" />}
        {offer.headlineKind === 'coins' && <CoinIcon className="h-20 w-20" />}
        {offer.headlineKind === 'xp-boost' && <XpBadge size="lg" />}
        {offer.headlineKind === 'lucky-dice' && <DiceIcon size="lg" />}
      </div>

      {/* Headline */}
      <div className="mt-2 flex items-center justify-center gap-2">
        {(offer.headlineKind === 'gems' || offer.headlineKind === 'coins') ? (
          <>
            {offer.headlineKind === 'gems' ? <GemIcon className="h-5 w-5" /> : <CoinIcon className="h-5 w-5" />}
            <span className="font-display text-2xl font-black tabular-nums text-[#1e40af]">
              {offer.headlineLabel}
            </span>
          </>
        ) : (
          <span className="font-display text-lg font-black uppercase tracking-wide text-[#3a1f08]">
            {offer.headlineLabel}
          </span>
        )}
      </div>
      {offer.headlineSubLabel ? (
        <div className="mt-0.5 text-center text-sm font-bold text-amber-900/70">{offer.headlineSubLabel}</div>
      ) : null}

      {/* Bonuses row */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-bold text-amber-950">
        {offer.bonuses.map((b, i) => (
          <span key={i} className="flex items-center gap-1 whitespace-nowrap">
            {b.kind === 'gems' && <GemIcon className="h-4 w-4" />}
            {b.kind === 'coins' && <CoinIcon className="h-4 w-4" />}
            {b.kind === 'chest' && <ChestIcon className="h-4 w-4" />}
            <span className="tabular-nums">+{b.amount.toLocaleString()}</span>
          </span>
        ))}
      </div>

      {/* Buy button */}
      <button
        type="button"
        onClick={onBuy}
        className="mt-3 rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] py-2 font-display text-base font-black tabular-nums text-white shadow-md transition hover:brightness-110 active:translate-y-[1px]"
      >
        ${offer.priceUsd.toFixed(2)}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Daily Deal card (gem-priced)
// -----------------------------------------------------------------------------

function DailyDealCard({ deal, onBuy }: { deal: DailyDeal; onBuy: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-amber-300/40 bg-[#fdf6e3]/80 px-2 py-2 shadow-[0_6px_10px_-3px_rgba(120,53,15,0.4)]">
      <div className="whitespace-nowrap text-center font-display text-xs font-bold uppercase tracking-wide text-amber-900/80">
        {deal.title}
      </div>
      <div className="flex h-16 items-center justify-center">
        {deal.kind === 'gems' && <GemIcon className="h-12 w-12" />}
        {deal.kind === 'coins' && <CoinIcon className="h-12 w-12" />}
        {deal.kind === 'xp-boost' && <XpBadge size="md" />}
        {deal.kind === 'lucky-dice' && <DiceIcon size="md" />}
      </div>
      <div className="text-center font-display text-base font-black text-[#3a1f08]">{deal.amount}</div>
      <button
        type="button"
        onClick={onBuy}
        className="mt-1 flex items-center justify-center gap-1 rounded-md border border-[#b45309]/40 bg-gradient-to-b from-[#fcd34d] to-[#d97706] py-1 font-display text-sm font-black text-white shadow-md transition hover:brightness-110 active:translate-y-[1px]"
      >
        <GemIcon className="h-4 w-4" />
        <span className="tabular-nums">{deal.priceGems}</span>
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Monthly Gem Pass banner
// -----------------------------------------------------------------------------

function MonthlyPassBanner({ onBuy }: { onBuy: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-violet-700/60 bg-gradient-to-br from-[#3b1361] via-[#2a0e4a] to-[#1c0a36] p-4 shadow-[0_10px_14px_-4px_rgba(20,8,40,0.6)]">
      <div className="flex items-center gap-4">
        <ChestIcon className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-black uppercase tracking-wider text-amber-300 drop-shadow">
            Monthly Gem Pass
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-bold text-amber-100/80">
            <span aria-hidden="true">🗓️</span>
            <span>Claim 150 gems every day for 30 days!</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onBuy}
          className="shrink-0 rounded-md border border-emerald-900/60 bg-gradient-to-b from-emerald-400 to-emerald-700 px-5 py-2 font-display text-base font-black text-white shadow-md transition hover:brightness-110 active:translate-y-[1px]"
        >
          $9.99
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Top bar (back / title / wallet pills / close)
// -----------------------------------------------------------------------------

function ShopTopBar({
  gems,
  coins,
  onBack,
  onClose,
}: {
  gems: number;
  coins: number;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <header className="relative flex items-center gap-4 px-4 py-3">
      {/* Back arrow */}
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.45)] transition hover:brightness-110 active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 5 8 12 15 19" />
        </svg>
      </button>

      {/* Title block */}
      <div className="min-w-0">
        <h1 className="bg-gradient-to-b from-[#fcd34d] via-[#d97706] to-[#7c2d12] bg-clip-text font-display text-3xl font-black uppercase tracking-wider text-transparent md:text-4xl">
          Shop
        </h1>
        <p className="text-xs font-bold text-amber-900/70 md:text-sm">Get gems, coins and exclusive items!</p>
      </div>

      {/* Wallet pills — fill the centre */}
      <div className="ml-auto flex items-center gap-3">
        <div className="flex h-10 items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] to-[#0c0908] pl-2 pr-3">
          <GemIcon className="h-7 w-7" />
          <span className="ml-2 min-w-[3rem] text-right font-display text-base font-black tabular-nums text-white">
            {formatCompactNumber(gems)}
          </span>
          <button
            type="button"
            aria-label="Get more gems"
            className="ml-2 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-b from-emerald-400 to-emerald-700 text-white shadow-md transition hover:brightness-110 active:translate-y-[1px]"
          >
            <span className="text-lg font-black leading-none">+</span>
          </button>
        </div>
        <div className="flex h-10 items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] to-[#0c0908] pl-2 pr-3">
          <CoinIcon className="h-7 w-7" />
          <span className="ml-2 min-w-[3rem] text-right font-display text-base font-black tabular-nums text-white">
            {formatCompactNumber(coins)}
          </span>
          <button
            type="button"
            aria-label="Get more coins"
            className="ml-2 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-b from-emerald-400 to-emerald-700 text-white shadow-md transition hover:brightness-110 active:translate-y-[1px]"
          >
            <span className="text-lg font-black leading-none">+</span>
          </button>
        </div>
      </div>

      {/* Close X */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close shop"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.45)] transition hover:brightness-110 active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>
  );
}

// -----------------------------------------------------------------------------
// Sidebar
// -----------------------------------------------------------------------------

function ShopSidebar({ active, onSelect }: { active: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <aside className="flex w-44 shrink-0 flex-col gap-1 py-3 pl-3 pr-1">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`flex items-center gap-3 rounded-l-lg px-4 py-3 font-display text-sm font-black uppercase tracking-wider transition ${
              isActive
                ? 'bg-gradient-to-r from-[#fcd34d] to-[#d97706] text-white shadow-md'
                : 'bg-[#1d1612]/85 text-amber-200/85 hover:bg-[#2b2421]'
            }`}
          >
            <span className={`text-lg ${isActive ? 'text-white' : 'text-amber-400/90'}`}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </aside>
  );
}

// -----------------------------------------------------------------------------
// Featured view — assembles the 3 sections
// -----------------------------------------------------------------------------

function FeaturedView({ onStubbedBuy }: { onStubbedBuy: (label: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Top Offers section */}
      <section>
        <div className="mb-3 flex items-center justify-center gap-3">
          <span className="h-px flex-1 max-w-[6rem] bg-gradient-to-r from-transparent to-amber-500/60" />
          <span className="text-amber-500">✦</span>
          <h2 className="whitespace-nowrap font-display text-lg font-black uppercase tracking-[0.18em] text-[#3a1f08]">
            Top Offers
          </h2>
          <span className="text-amber-500">✦</span>
          <span className="h-px flex-1 max-w-[6rem] bg-gradient-to-l from-transparent to-amber-500/60" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TOP_OFFERS.map((offer) => (
            <TopOfferCard
              key={offer.id}
              offer={offer}
              onBuy={() => onStubbedBuy(`$${offer.priceUsd.toFixed(2)} purchase`)}
            />
          ))}
        </div>
      </section>

      {/* Daily Deals + Monthly Pass row */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Daily Deals */}
        <div className="rounded-xl border border-amber-300/60 bg-gradient-to-b from-[#fdf6e3] to-[#f0e1b8] p-3 shadow-[0_10px_14px_-4px_rgba(120,53,15,0.45)]">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-black uppercase tracking-[0.14em] text-[#3a1f08]">
              ✦ Daily Deals
            </h3>
            <div className="flex items-center gap-1 text-xs font-bold text-amber-900/70">
              <span aria-hidden="true">⏱</span>
              <span>Refreshes in: 12h 45m</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DAILY_DEALS.map((deal) => (
              <DailyDealCard key={deal.id} deal={deal} onBuy={() => onStubbedBuy(`${deal.priceGems} gem purchase`)} />
            ))}
          </div>
        </div>

        {/* Monthly Pass */}
        <MonthlyPassBanner onBuy={() => onStubbedBuy('Monthly Gem Pass')} />
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Top-level Shop screen
// -----------------------------------------------------------------------------

export default function Shop() {
  const navigate = useNavigate();
  const { wallet } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('featured');
  const [stubMessage, setStubMessage] = useState<string | null>(null);

  const onStubbedBuy = (label: string) => {
    setStubMessage(label);
    window.setTimeout(() => setStubMessage(null), 2200);
  };

  return (
    <main className="relative min-h-dvh bg-[radial-gradient(circle_at_center,#1a1027_0%,#070310_70%,#000000_100%)] text-white">
      <div className="mx-auto flex max-w-7xl flex-col">
        {/* Decorative parchment panel */}
        <div className="relative m-3 overflow-hidden rounded-3xl border-[5px] border-[#c89a47] bg-gradient-to-b from-[#fef3c7] via-[#f7e9c8] to-[#e7d09a] shadow-[0_25px_60px_rgba(0,0,0,0.65)]">
          <ShopTopBar
            gems={wallet?.gems ?? 0}
            coins={wallet?.coins ?? 0}
            onBack={() => navigate(-1)}
            onClose={() => navigate('/')}
          />

          <div className="flex">
            <ShopSidebar active={activeTab} onSelect={setActiveTab} />

            <div className="min-w-0 flex-1 rounded-tl-2xl bg-gradient-to-b from-[#f7e9c8] to-[#e7d09a] p-4">
              {activeTab === 'featured' ? (
                <FeaturedView onStubbedBuy={onStubbedBuy} />
              ) : (
                <div className="grid place-items-center py-12 text-amber-900/60 font-display text-sm font-bold uppercase tracking-widest">
                  {activeTab} — coming soon
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stubbed-buy toast */}
      {stubMessage ? (
        <div className="pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg border border-amber-700/60 bg-gradient-to-b from-amber-100 to-amber-300 px-4 py-2 font-bold text-amber-950 shadow-2xl">
          {stubMessage} — coming soon
        </div>
      ) : null}
    </main>
  );
}
