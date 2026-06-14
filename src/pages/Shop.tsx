import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ScaleInModal } from '../components/ScaleInModal';
import { CurrencyPill } from '../components/CurrencyPill';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from '../lobby/RewardFlight';
import type { Database, Json } from '../types/database';

// -----------------------------------------------------------------------------
// Redesigned Store. Two sections, no category tabs (per current direction):
//   • Featured Packs — bundles (shop_items.kind = 'bundle')
//   • Packs grid     — every other purchasable single pack
// Balances in the header reuse the lobby's CurrencyPill (same element + the
// player's real wallet). Buy flow: gem-priced → purchase_shop_item; USD →
// the admin test-purchase (so the whole flow is testable) until real billing.
// -----------------------------------------------------------------------------

type ShopKind = 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
type HeadlineKind = 'coins' | 'gems' | 'xp-boost' | 'lucky-dice';
type RewardKind = 'coins' | 'gems' | 'xp' | 'chest';
type Ribbon = 'best-value' | 'popular' | null;

interface Reward {
  readonly kind: RewardKind;
  readonly label: string;
}

/** A featured bundle card (kind='bundle'). */
interface Bundle {
  readonly id: string;
  readonly title: string;
  readonly ribbon: Ribbon;
  readonly headlineKind: 'coins' | 'gems';
  readonly rewards: readonly Reward[];
  readonly priceUsd: number | null;
  readonly priceGems: number | null;
}

/** A single pack in the right-hand grid. */
interface Pack {
  readonly id: string;
  readonly kind: ShopKind;
  readonly title: string;
  readonly headlineKind: HeadlineKind;
  readonly headlineLabel: string;
  readonly headlineSubLabel?: string;
  readonly priceUsd: number | null;
  readonly priceGems: number | null;
}

type ShopItemRow = Database['public']['Tables']['shop_items']['Row'];

interface Presentation {
  readonly placement?: string;
  readonly ribbon?: Ribbon;
  readonly headlineKind?: string;
  readonly headline?: { readonly kind?: HeadlineKind; readonly label?: string; readonly subLabel?: string };
  readonly rewards?: ReadonlyArray<{ readonly kind: RewardKind; readonly label: string }>;
}

function getPresentation(contents: Json): Presentation | null {
  if (contents === null || typeof contents !== 'object' || Array.isArray(contents)) return null;
  const p = (contents as Record<string, unknown>).presentation;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null;
  return p as Presentation;
}

// -----------------------------------------------------------------------------
// DB → view mapping
// -----------------------------------------------------------------------------

function defaultPackHeadline(row: ShopItemRow): HeadlineKind {
  if (row.kind === 'coin_pack') return 'coins';
  if (row.kind === 'special_offer') return 'xp-boost';
  return 'gems';
}

function rowToBundle(row: ShopItemRow): Bundle | null {
  const pres = getPresentation(row.contents);
  const priceUsd = row.price_cents !== null ? row.price_cents / 100 : null;
  const priceGems = row.price_gems;
  if (priceUsd === null && priceGems === null) return null;
  const headlineKind = pres?.headlineKind === 'gems' ? 'gems' : 'coins';
  return {
    id: row.id,
    title: row.display_name,
    ribbon: pres?.ribbon ?? null,
    headlineKind,
    rewards: (pres?.rewards ?? []).map((r) => ({ kind: r.kind, label: r.label })),
    priceUsd,
    priceGems,
  };
}

function rowToPack(row: ShopItemRow): Pack | null {
  const pres = getPresentation(row.contents);
  const priceUsd = row.price_cents !== null ? row.price_cents / 100 : null;
  const priceGems = row.price_gems;
  if (priceUsd === null && priceGems === null) return null;
  const headline = pres?.headline ?? {};
  return {
    id: row.id,
    kind: row.kind as ShopKind,
    title: row.display_name,
    headlineKind: headline.kind ?? defaultPackHeadline(row),
    headlineLabel: headline.label ?? row.display_name,
    headlineSubLabel: headline.subLabel,
    priceUsd,
    priceGems,
  };
}

interface MappedShop {
  readonly bundles: readonly Bundle[];
  readonly packs: readonly Pack[];
}

function mapShop(rows: readonly ShopItemRow[]): MappedShop {
  const bundles: Bundle[] = [];
  const packs: Pack[] = [];
  for (const row of rows) {
    if (!row.is_enabled) continue;
    const pres = getPresentation(row.contents);
    const isFeatured = row.kind === 'bundle' || pres?.placement === 'featured';
    if (isFeatured) {
      const b = rowToBundle(row);
      if (b) bundles.push(b);
    } else {
      const p = rowToPack(row);
      if (p) packs.push(p);
    }
  }
  return { bundles, packs };
}

// -----------------------------------------------------------------------------
// Icons (kept from the previous shop — art-light SVG/webp)
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

function XpBadge({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 110" className={`w-auto drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`} aria-hidden="true">
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
      <text x="50" y="68" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="34" fill="white" stroke="rgba(0,0,0,0.35)" strokeWidth="1">XP</text>
    </svg>
  );
}

function DiceIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 80" className={`w-auto drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id="shop-dice-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#e7d09a" />
        </linearGradient>
      </defs>
      <rect x="42" y="6" width="42" height="42" rx="6" fill="url(#shop-dice-fill)" stroke="#3a1f08" strokeWidth="2" />
      <circle cx="63" cy="27" r="3" fill="#3a1f08" />
      <rect x="14" y="28" width="46" height="46" rx="6" fill="url(#shop-dice-fill)" stroke="#3a1f08" strokeWidth="2" />
      <circle cx="25" cy="40" r="3" fill="#3a1f08" />
      <circle cx="49" cy="40" r="3" fill="#3a1f08" />
      <circle cx="37" cy="51" r="3" fill="#3a1f08" />
      <circle cx="25" cy="62" r="3" fill="#3a1f08" />
      <circle cx="49" cy="62" r="3" fill="#3a1f08" />
    </svg>
  );
}

function HeadlineIcon({ kind, className }: { kind: HeadlineKind; className: string }) {
  if (kind === 'coins') return <CoinIcon className={className} />;
  if (kind === 'gems') return <GemIcon className={className} />;
  if (kind === 'xp-boost') return <XpBadge className={className} />;
  return <DiceIcon className={className} />;
}

function RewardSlotIcon({ kind, className }: { kind: RewardKind; className: string }) {
  if (kind === 'coins') return <CoinIcon className={className} />;
  if (kind === 'gems') return <GemIcon className={className} />;
  return <XpBadge className={className} />; // 'xp' / 'chest' fallback
}

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

function RibbonBadge({ ribbon }: { ribbon: Ribbon }) {
  if (!ribbon) return null;
  return (
    <div className="pointer-events-none absolute -left-px -top-px h-24 w-24 overflow-hidden">
      <div
        className={`absolute -left-8 top-4 origin-center -rotate-45 px-9 py-1 font-display text-[0.7rem] font-black uppercase tracking-[0.16em] text-white shadow-[0_2px_4px_rgba(0,0,0,0.35)] ${
          ribbon === 'best-value' ? 'bg-gradient-to-b from-rose-500 to-rose-700' : 'bg-gradient-to-b from-violet-500 to-violet-700'
        }`}
      >
        {ribbon === 'best-value' ? 'Best Value!' : 'Popular'}
      </div>
    </div>
  );
}

function PriceLabel({ priceUsd, priceGems }: { priceUsd: number | null; priceGems: number | null }) {
  if (priceGems !== null) {
    return (
      <span className="flex items-center justify-center gap-1.5">
        <GemIcon className="h-5 w-5" />
        <span className="tabular-nums">{priceGems.toLocaleString()}</span>
      </span>
    );
  }
  return <span className="tabular-nums">${(priceUsd ?? 0).toFixed(2)}</span>;
}

function BundleCard({ bundle, isBusy, onBuy }: { bundle: Bundle; isBusy: boolean; onBuy: () => void }) {
  return (
    <article className="relative flex min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-[#ffc93d]/85 bg-gradient-to-b from-[#0c1e39] to-[#071326] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(0,0,0,0.35)]">
      <div className="bg-gradient-to-b from-[#bc8108] to-[#8d5d00] px-4 py-4 text-center font-display text-base font-black uppercase tracking-[0.14em] text-[#fff7dc]">
        {bundle.title}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {/* Hero — the headline currency, scaled up. The ribbon sits here (over
            the hero, below the title bar) so it never covers the title.
            data-fly-source anchors the reward-flight on a successful gem buy. */}
        <div className="relative flex h-44 items-center justify-center border-b border-white/10" data-fly-source={bundle.id}>
          <RibbonBadge ribbon={bundle.ribbon} />
          <HeadlineIcon kind={bundle.headlineKind} className="h-32 w-32" />
        </div>
        {/* Reward slots */}
        <div className="grid grid-cols-4 gap-3 border-b border-white/10 py-6">
          {bundle.rewards.slice(0, 4).map((r, i) => (
            <div key={i} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl bg-[#183763]/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <RewardSlotIcon kind={r.kind} className="h-9 w-9" />
              <span className="text-center text-[0.7rem] font-black leading-tight text-white tabular-nums">{r.label}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onBuy}
          disabled={isBusy}
          className="mt-auto h-14 w-full rounded-xl bg-gradient-to-b from-[#27db74] to-[#079044] font-display text-xl font-black text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_8px_18px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
        >
          <PriceLabel priceUsd={bundle.priceUsd} priceGems={bundle.priceGems} />
        </button>
      </div>
    </article>
  );
}

function PackCard({ pack, isBusy, onBuy }: { pack: Pack; isBusy: boolean; onBuy: () => void }) {
  return (
    <article className="flex h-[18rem] flex-col rounded-2xl border border-[#4a7ecc]/55 bg-gradient-to-b from-[#0c1e39] to-[#071326] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(0,0,0,0.25)]">
      <div className="flex flex-1 items-center justify-center" data-fly-source={pack.id}>
        <HeadlineIcon kind={pack.headlineKind} className="h-24 w-24" />
      </div>
      <div className="mb-3 text-center">
        <div className="font-display text-xl font-black tabular-nums text-white">{pack.headlineLabel}</div>
        {pack.headlineSubLabel ? <div className="text-xs font-bold text-[#9aabc5]">{pack.headlineSubLabel}</div> : null}
      </div>
      <button
        type="button"
        onClick={onBuy}
        disabled={isBusy}
        className="h-12 w-full rounded-lg bg-gradient-to-b from-[#27db74] to-[#079044] font-display text-lg font-black text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_6px_14px_rgba(0,0,0,0.3)] transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
      >
        <PriceLabel priceUsd={pack.priceUsd} priceGems={pack.priceGems} />
      </button>
    </article>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-6 flex items-center justify-center gap-3 font-display text-lg font-black uppercase tracking-[0.32em] text-[#ffc93d]">
      <span className="text-sm">✦</span>
      {children}
      <span className="text-sm">✦</span>
    </h2>
  );
}

// -----------------------------------------------------------------------------
// Modal
// -----------------------------------------------------------------------------

const PANEL_DESIGN_W = 1320;
const PANEL_DESIGN_H = 860;

type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  readonly kind: ToastKind;
  readonly text: string;
}

interface BuyDescriptor {
  readonly id: string;
  readonly label: string;
  readonly priceUsd: number | null;
  readonly priceGems: number | null;
  readonly flightKind: FlightCurrency | null;
}

export function ShopModal({ onClose }: { readonly onClose: () => void }) {
  const { user, wallet, refreshWallet, refreshXpBoost } = useAuth();
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [data, setData] = useState<MappedShop>({ bundles: [], packs: [] });
  const [rewardFlights, setRewardFlights] = useState<readonly RewardFlightSpec[]>([]);
  const nextFlightIdRef = useRef(1);

  // Admin → USD buttons become a no-money test purchase (see handleUsdPurchase).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void supabase.rpc('get_my_admin_role').then(({ data: role, error }) => {
      if (!cancelled && !error && role) setIsAdmin(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void supabase
      .from('shop_items')
      .select('*')
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true })
      .then(({ data: rows, error }) => {
        if (cancelled || error || !rows) return;
        setData(mapShop(rows));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const s = Math.min(1, (window.innerWidth * 0.92) / PANEL_DESIGN_W, (window.innerHeight * 0.9) / PANEL_DESIGN_H);
      setScale(s);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const showToast = (kind: ToastKind, text: string, ms = 2400) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), ms);
  };

  const spawnFlights = (currency: FlightCurrency, sourceEl: Element, count: number) => {
    const target = document.querySelector<HTMLElement>(`[data-fly-target="${currency}"]`);
    if (!target) return;
    const src = sourceEl.getBoundingClientRect();
    const dst = target.getBoundingClientRect();
    const startX = src.left + src.width / 2;
    const startY = src.top + src.height / 2;
    const endX = dst.left + dst.width / 2;
    const endY = dst.top + dst.height / 2;
    const additions: RewardFlightSpec[] = [];
    for (let i = 0; i < count; i++) {
      // Deterministic per-token jitter (no Math.random — keeps the function
      // pure-by-static-analysis; the spread reads the same to the eye).
      additions.push({
        id: nextFlightIdRef.current++,
        currency,
        startX: startX + (((i * 37) % 15) - 7),
        startY: startY + (((i * 53) % 15) - 7),
        endX,
        endY,
        delayMs: i * 70,
        durationMs: 800,
      });
    }
    setRewardFlights((prev) => [...prev, ...additions]);
  };

  const removeFlight = (id: number) => setRewardFlights((prev) => prev.filter((f) => f.id !== id));

  // USD path. Real billing (Play Billing / Stripe) isn't wired yet; admins get
  // the no-money test purchase so the full flow is exercisable.
  const handleUsdPurchase = async (item: BuyDescriptor) => {
    if (!isAdmin) {
      showToast('info', `${item.label} — coming soon`);
      return;
    }
    if (busyId !== null) return;
    setBusyId(item.id);
    const { error } = await supabase.rpc('test_purchase_shop_item', { p_item_id: item.id });
    setBusyId(null);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('already_owned_board')) showToast('info', 'You already own that board.');
      else if (msg.includes('unsupported_grant')) showToast('error', `${item.label}: unsupported grant.`);
      else if (msg.includes('not_authorized')) showToast('error', 'Admin only.');
      else showToast('error', 'Test purchase failed.');
      return;
    }
    const sourceEl = document.querySelector(`[data-fly-source="${item.id}"]`);
    if (sourceEl && item.flightKind) spawnFlights(item.flightKind, sourceEl, 6);
    window.setTimeout(() => void refreshWallet(), 600);
    void refreshXpBoost();
    showToast('success', `Test purchase: ${item.label} ✓`);
  };

  // Gem path — live for everyone via purchase_shop_item.
  const buyWithGems = async (item: BuyDescriptor) => {
    if (busyId !== null) return;
    if (!user) {
      showToast('error', 'Sign in to make purchases');
      return;
    }
    if (wallet && item.priceGems !== null && wallet.gems < item.priceGems) {
      showToast('info', 'Not enough gems — grab a gem pack first.');
      return;
    }
    const sourceEl = document.querySelector(`[data-fly-source="${item.id}"]`);
    setBusyId(item.id);
    const { error } = await supabase.rpc('purchase_shop_item', { target_item_id: item.id });
    setBusyId(null);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('unsupported_grant')) showToast('info', `${item.label} — coming soon`);
      else if (msg.includes('insufficient_gems')) {
        showToast('info', 'Not enough gems.');
        void refreshWallet();
      } else if (msg.includes('already_owned_board')) showToast('info', 'You already own that board.');
      else if (msg.includes('purchase_limit_reached')) showToast('info', 'Purchase limit reached for this item.');
      else showToast('error', 'Purchase failed. Try again.');
      return;
    }
    if (sourceEl && item.flightKind) spawnFlights(item.flightKind, sourceEl, 6);
    window.setTimeout(() => void refreshWallet(), 600);
    void refreshXpBoost();
    showToast('success', `Got ${item.label}!`);
  };

  const buy = (item: BuyDescriptor) => {
    if (item.priceGems !== null) return void buyWithGems(item);
    if (item.priceUsd !== null) return void handleUsdPurchase(item);
  };

  const flightKindOf = (k: HeadlineKind): FlightCurrency | null => (k === 'coins' || k === 'gems' ? k : null);

  return (
    <>
      <ScaleInModal onClose={onClose}>
        <div className="origin-center" style={{ transform: `scale(${scale})` }}>
          <main
            className="flex flex-col overflow-hidden rounded-[22px] border border-[#ffc93d]/40 bg-gradient-to-b from-[#081429] to-[#071326] text-[#f6f0df] shadow-[0_26px_70px_rgba(0,0,0,0.45)]"
            style={{ width: PANEL_DESIGN_W }}
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-6 border-b border-[#ffc93d]/25 bg-gradient-to-b from-[#0c1c37] to-[#050d1c] px-10 py-5">
              <h1 className="font-display text-4xl font-black uppercase tracking-[0.18em] text-[#ffc93d] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
                Store
              </h1>
              <div className="flex items-center gap-4">
                {/* Same balance element as the lobby, with the real wallet. The
                    lobby pill sizes itself off `--lobby-u` (defined on
                    .lobby-shell); outside the lobby we scope a fixed unit + a
                    definite height so it renders at the right size — the same
                    trick the profile page (.profile-top-currency) uses. The
                    "+" is a no-op here — you're already in the shop. */}
                <div
                  className="flex items-center gap-3"
                  style={{ '--lobby-u': '0.82px', height: '3.1rem' } as CSSProperties}
                >
                  <CurrencyPill flyTarget="coins" label="Coins" value={wallet?.coins} icon="/lobby/icons/gold-coin.webp" onAdd={() => {}} />
                  <CurrencyPill flyTarget="gems" label="Gems" value={wallet?.gems} icon="/lobby/icons/gem.webp" onAdd={() => {}} />
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close store"
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#ff5751] to-[#c92222] text-3xl leading-none text-[#fff7dc] shadow-[inset_0_2px_0_rgba(255,255,255,0.25),0_5px_14px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:scale-95"
                >
                  ×
                </button>
              </div>
            </header>

            {/* Content: Featured Packs | Packs grid */}
            <div className="grid grid-cols-[600px_1fr] gap-8 p-10">
              <section className="border-r border-[#9aabc5]/18 pr-8">
                <SectionTitle>Featured Packs</SectionTitle>
                {data.bundles.length > 0 ? (
                  <div className="grid grid-cols-2 gap-5">
                    {data.bundles.map((b) => (
                      <BundleCard
                        key={b.id}
                        bundle={b}
                        isBusy={busyId === b.id}
                        onBuy={() => buy({ id: b.id, label: b.title, priceUsd: b.priceUsd, priceGems: b.priceGems, flightKind: flightKindOf(b.headlineKind) })}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-[#9aabc5]/25 text-center text-sm text-[#9aabc5]">
                    No featured packs yet.
                  </div>
                )}
              </section>

              <section className="min-w-0">
                <SectionTitle>Packs</SectionTitle>
                {data.packs.length > 0 ? (
                  <div className="grid grid-cols-4 gap-6">
                    {data.packs.map((p) => (
                      <PackCard
                        key={p.id}
                        pack={p}
                        isBusy={busyId === p.id}
                        onBuy={() => buy({ id: p.id, label: p.headlineLabel, priceUsd: p.priceUsd, priceGems: p.priceGems, flightKind: flightKindOf(p.headlineKind) })}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-[#9aabc5]/25 text-center text-sm text-[#9aabc5]">
                    No packs available.
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      </ScaleInModal>

      {rewardFlights.map((spec) => (
        <RewardFlight key={spec.id} spec={spec} onLanded={removeFlight} />
      ))}

      {toast ? (
        <div
          className={
            'pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg px-4 py-2 font-bold shadow-2xl ' +
            (toast.kind === 'success'
              ? 'border border-emerald-700/60 bg-gradient-to-b from-emerald-100 to-emerald-300 text-emerald-950'
              : toast.kind === 'error'
                ? 'border border-rose-700/60 bg-gradient-to-b from-rose-100 to-rose-300 text-rose-950'
                : 'border border-amber-700/60 bg-gradient-to-b from-amber-100 to-amber-300 text-amber-950')
          }
        >
          {toast.text}
        </div>
      ) : null}
    </>
  );
}
