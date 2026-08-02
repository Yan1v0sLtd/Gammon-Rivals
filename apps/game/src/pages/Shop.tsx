import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ScaleInModal } from '../components/ScaleInModal';
import { useImagePreloader } from '../lib/useImagePreloader';
import { CurrencyPill } from '../components/CurrencyPill';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getBilling } from '../lib/billing';
import { getShopCatalogCache, updateShopCatalogCache } from '../lib/shopCache';
import { RewardFlight, type FlightCurrency, type RewardFlightSpec } from '../lobby/RewardFlight';
import type { Database, Json } from '@shared/database';

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
  /** Numeric grant for coins/gems rewards (null for xp/chest); drives the
   *  struck-base → boosted display when a Store Sale is running. */
  readonly amount: number | null;
}

/** A featured bundle card (kind='bundle'). */
interface Bundle {
  readonly id: string;
  /** Canonical name — used for the purchase toast + admin, not necessarily shown
   *  on the card (the visible title bar is `headerText`). */
  readonly title: string;
  /** Title-bar text; null hides the bar entirely. */
  readonly headerText: string | null;
  /** Optional CSS colours for the title bar (null → default gold plate / cream). */
  readonly headerBg: string | null;
  readonly headerFg: string | null;
  readonly ribbon: Ribbon;
  readonly headlineKind: 'coins' | 'gems';
  /** Operator-uploaded pack art (shop_items.image_url); falls back to the
   *  headline-currency icon when null. */
  readonly imageUrl: string | null;
  readonly rewards: readonly Reward[];
  readonly priceUsd: number | null;
  readonly priceGems: number | null;
}

/** A single pack in the right-hand grid. */
interface Pack {
  readonly id: string;
  readonly kind: ShopKind;
  readonly title: string;
  /** Title-bar text; null hides the bar. Colours override the gold plate. */
  readonly headerText: string | null;
  readonly headerBg: string | null;
  readonly headerFg: string | null;
  readonly headlineKind: HeadlineKind;
  readonly headlineLabel: string;
  readonly headlineSubLabel?: string;
  /** Operator-uploaded pack art (shop_items.image_url); falls back to the
   *  headline icon when null. */
  readonly imageUrl: string | null;
  /** Numeric grant of the headline currency (coins/gems), or null for
   *  non-currency packs. Drives the struck-base → boosted sale display. */
  readonly baseAmount: number | null;
  readonly priceUsd: number | null;
  readonly priceGems: number | null;
}

type ShopItemRow = Database['public']['Tables']['shop_items']['Row'];

interface Presentation {
  readonly placement?: string;
  readonly ribbon?: Ribbon;
  readonly headlineKind?: string;
  /** Bundle title bar. Rendered only when `text` is non-empty; `bg`/`fg` are
   *  optional CSS colours overriding the default gold gradient / cream text. */
  readonly header?: { readonly text?: string; readonly bg?: string; readonly fg?: string };
  readonly headline?: { readonly kind?: HeadlineKind; readonly label?: string; readonly subLabel?: string };
  readonly rewards?: ReadonlyArray<{ readonly kind: RewardKind; readonly label: string }>;
}

function getPresentation(contents: Json): Presentation | null {
  if (contents === null || typeof contents !== 'object' || Array.isArray(contents)) return null;
  const p = (contents as Record<string, unknown>).presentation;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null;
  return p as Presentation;
}

/** Reads contents.grants[key] as a number (coins/gems amounts), else null.
 *  This is the *base* the server multiplies during a sale, so the UI boosts the
 *  same value the wallet will actually receive. */
function numericGrant(contents: Json, key: 'coins' | 'gems'): number | null {
  if (contents === null || typeof contents !== 'object' || Array.isArray(contents)) return null;
  const grants = (contents as Record<string, unknown>).grants;
  if (grants === null || typeof grants !== 'object' || Array.isArray(grants)) return null;
  const v = (grants as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : null;
}

// -----------------------------------------------------------------------------
// DB → view mapping
// -----------------------------------------------------------------------------

/** A trimmed non-empty string, or null — used for optional presentation fields
 *  (header text / colours) where empty means "unset / hide / use default". */
function nonEmptyStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

// Compact coin/gem amount for the cards, so big values don't overrun the price
// button: 1,725,000 → "1.73M", 504,000 → "504K", 78,750 → "78.75K", 750 → "750".
// Prices (USD / gem cost) are intentionally left exact — this is grant amounts only.
const AMOUNT_FMT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
function formatAmount(n: number): string {
  return AMOUNT_FMT.format(n);
}

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
  const header = pres?.header;
  return {
    id: row.id,
    title: row.display_name,
    headerText: nonEmptyStr(header?.text),
    headerBg: nonEmptyStr(header?.bg),
    headerFg: nonEmptyStr(header?.fg),
    ribbon: pres?.ribbon ?? null,
    headlineKind,
    imageUrl: row.image_url,
    rewards: (pres?.rewards ?? []).map((r) => ({
      kind: r.kind,
      label: r.label,
      amount: r.kind === 'coins' || r.kind === 'gems' ? numericGrant(row.contents, r.kind) : null,
    })),
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
  const headlineKind = headline.kind ?? defaultPackHeadline(row);
  const currency = headlineKind === 'coins' ? 'coins' : headlineKind === 'gems' ? 'gems' : null;
  const header = pres?.header;
  return {
    id: row.id,
    kind: row.kind as ShopKind,
    title: row.display_name,
    headerText: nonEmptyStr(header?.text),
    headerBg: nonEmptyStr(header?.bg),
    headerFg: nonEmptyStr(header?.fg),
    headlineKind,
    headlineLabel: headline.label ?? row.display_name,
    headlineSubLabel: headline.subLabel,
    imageUrl: row.image_url,
    baseAmount: currency ? numericGrant(row.contents, currency) : null,
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

/** Pack/bundle hero: the operator-uploaded art (shop_items.image_url) when set,
 *  otherwise the headline-currency icon. A broken image URL hides itself rather
 *  than showing a broken-image glyph. */
function HeroArt({ imageUrl, kind, className }: { imageUrl: string | null; kind: HeadlineKind; className: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`select-none object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] ${className}`}
        draggable={false}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
      />
    );
  }
  return <HeadlineIcon kind={kind} className={className} />;
}

function RewardSlotIcon({ kind, className }: { kind: RewardKind; className: string }) {
  if (kind === 'coins') return <CoinIcon className={className} />;
  if (kind === 'gems') return <GemIcon className={className} />;
  return <XpBadge className={className} />; // 'xp' / 'chest' fallback
}

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

// Diagonal corner banner. Used for Popular/Best-Value and (in gold) the sale's
// "X% BONUS" — when both show, the bonus sits left and the tag moves right.
function CornerRibbon({ text, side = 'left', tone }: { text: string; side?: 'left' | 'right'; tone: 'gold' | 'violet' | 'rose' }) {
  const toneCls =
    tone === 'gold'
      ? 'from-[#ffe08a] to-[#b8801f] text-[#3a2406]'
      : tone === 'rose'
        ? 'from-rose-500 to-rose-700 text-white'
        : 'from-violet-500 to-violet-700 text-white';
  return (
    <div className={`pointer-events-none absolute z-20 ${side === 'left' ? '-left-px' : '-right-px'} -top-px h-28 w-28 overflow-hidden`}>
      {/* Wide, centred diagonal band whose ends run past the clip box, so it
          reads as a corner ribbon touching BOTH edges. whitespace-nowrap +
          text-center keep "Best Value!" on one line instead of clipping. */}
      <div
        className={`absolute left-[-34%] top-[17%] w-[168%] py-1 bg-gradient-to-b ${toneCls} font-display text-center text-[0.62rem] font-black uppercase leading-tight tracking-[0.06em] whitespace-nowrap shadow-[0_2px_4px_rgba(0,0,0,0.35)] ${
          side === 'left' ? '-rotate-45' : 'rotate-45'
        }`}
      >
        {text}
      </div>
    </div>
  );
}

// Small gold pill under a pack's icon advertising the running sale.
function SaleBadge({ bonusPercent }: { bonusPercent: number }) {
  return (
    <div className="mx-auto mb-2 w-fit rounded-full border border-[#ffe08a]/70 bg-gradient-to-b from-[#ffe08a] to-[#b8801f] px-3.5 py-1 font-display text-[1.1rem] font-black uppercase tracking-wide text-[#3a2406] shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
      +{bonusPercent}% Extra
    </div>
  );
}

// Total remaining time as HH:MM:SS, where HH is the *total* hours (can exceed
// 24 — a 2-day sale shows "48:00:00"), matching the requested format.
function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// Ticks once a second toward the sale's end. Renders nothing once elapsed (or if
// endsAt is unparseable), so a finished sale simply drops the footer.
function SaleCountdown({ endsAt }: { endsAt: string }) {
  const target = new Date(endsAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = target - now;
  if (!Number.isFinite(target) || remaining <= 0) return null;
  return (
    <div className="relative z-[3] flex items-center justify-center gap-2.5 border-t border-[#ffc93d]/25 bg-gradient-to-b from-[#0c1c37]/10 to-[#050d1c]/45 px-10 py-3">
      <span className="font-display text-[0.95rem] font-bold uppercase tracking-[0.14em] text-[#f6e6b8]/75">Sale ends in</span>
      <span className="font-display text-xl font-black tabular-nums tracking-[0.1em] text-[#ffc93d] drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]">
        {formatCountdown(remaining)}
      </span>
    </div>
  );
}

function PriceLabel({ priceUsd, priceGems }: { priceUsd: number | null; priceGems: number | null }) {
  if (priceGems !== null) {
    return (
      <span className="flex items-center justify-center gap-1.5">
        <GemIcon className="h-7 w-7" />
        <span className="tabular-nums">{priceGems.toLocaleString()}</span>
      </span>
    );
  }
  return <span className="tabular-nums">${(priceUsd ?? 0).toFixed(2)}</span>;
}

// Shared gold "name-plate" gradient for the title bars (bundle + each pack).
// Light text rides on top with a dark shadow so it stays legible on the gold.
const GOLD_PLATE = 'bg-gradient-to-b from-[#f6cf5e] via-[#d9a531] to-[#a06f16]';
const PLATE_TEXT = 'font-display font-black uppercase text-[#fff7dc] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]';
// Dark shadow under the white price so it reads on the bright green button.
const PRICE_SHADOW = '[text-shadow:0_2px_3px_rgba(0,0,0,0.55)]';

function BundleCard({ bundle, isBusy, bonusPercent, onBuy }: { bundle: Bundle; isBusy: boolean; bonusPercent: number; onBuy: () => void }) {
  const onSale = bonusPercent > 0;
  return (
    <article className="relative flex h-full min-h-[30rem] flex-1 flex-col overflow-hidden rounded-2xl border border-[#ffc93d]/85 bg-gradient-to-b from-[#0c1e39] to-[#071326] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(0,0,0,0.35)]">
      {/* Title bar — optional. Hidden entirely when no header text is configured
          in the BO. Background/text colours are BO-overridable; unset falls back
          to the default gold plate + cream text. */}
      {bundle.headerText ? (
        <div
          className={`${bundle.headerBg ? '' : GOLD_PLATE} ${PLATE_TEXT} px-4 py-4 text-center text-2xl tracking-[0.12em]`}
          style={{
            ...(bundle.headerBg ? { background: bundle.headerBg } : {}),
            ...(bundle.headerFg ? { color: bundle.headerFg } : {}),
          }}
        >
          {bundle.headerText}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        {/* Hero — the headline currency, scaled up. Ribbons sit here (over the
            hero, below the title bar). On sale: gold "X% BONUS" left, the
            Popular/Best-Value tag moves right; otherwise the tag stays left.
            data-fly-source anchors the reward-flight on a successful gem buy. */}
        {/* -mx-5 -mt-5 bleeds the hero back out to the card frame, cancelling the
            body's p-5 for THIS block only, so the corner ribbon reaches the edges
            (the rest of the body keeps its padding). */}
        <div className="relative -mx-5 -mt-5 flex min-h-0 flex-1 items-center justify-center overflow-hidden border-b border-white/10" data-fly-source={bundle.id}>
          {onSale ? <CornerRibbon text={`${bonusPercent}% Bonus`} side="left" tone="gold" /> : null}
          {bundle.ribbon ? (
            <CornerRibbon
              text={bundle.ribbon === 'best-value' ? 'Best Value!' : 'Popular'}
              side={onSale ? 'right' : 'left'}
              tone={bundle.ribbon === 'best-value' ? 'rose' : 'violet'}
            />
          ) : null}
          <HeroArt imageUrl={bundle.imageUrl} kind={bundle.headlineKind} className="h-64 w-64" />
        </div>
        {/* Reward currencies — centered. On sale each currency reward shows the
            struck base above the boosted amount. */}
        <div className="flex flex-wrap items-stretch justify-center gap-4 border-b border-white/10 py-6">
          {bundle.rewards.slice(0, 4).map((r, i) => (
            <div key={i} className="flex min-w-[7rem] flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-[#183763]/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <RewardSlotIcon kind={r.kind} className="h-[3.7rem] w-[3.7rem]" />
              {onSale && r.amount !== null ? (
                <div className="flex flex-col items-center leading-none">
                  <span className="text-[1.05rem] font-bold text-[#9aabc5] line-through tabular-nums">{formatAmount(r.amount)}</span>
                  <span className="text-[1.6rem] font-black text-white tabular-nums">{formatAmount(Math.round(r.amount * (1 + bonusPercent / 100)))}</span>
                </div>
              ) : (
                <span className="text-center text-[1.6rem] font-black leading-tight text-white tabular-nums">{r.amount !== null ? formatAmount(r.amount) : r.label}</span>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onBuy}
          disabled={isBusy}
          className={`mt-auto h-16 w-full rounded-xl bg-gradient-to-b from-[#27db74] to-[#079044] font-display text-[1.9rem] font-black text-white ${PRICE_SHADOW} shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_8px_18px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-60`}
        >
          <PriceLabel priceUsd={bundle.priceUsd} priceGems={bundle.priceGems} />
        </button>
      </div>
    </article>
  );
}

function PackCard({ pack, isBusy, bonusPercent, onBuy }: { pack: Pack; isBusy: boolean; bonusPercent: number; onBuy: () => void }) {
  // baseAmount is the numeric headline-currency grant (null for non-currency
  // packs). A running sale boosts it the same way the server boosts the grant.
  const base = pack.baseAmount;
  const onSale = bonusPercent > 0 && base !== null;
  const boosted = base !== null ? Math.round(base * (1 + bonusPercent / 100)) : null;
  return (
    <article className="relative flex h-[18rem] flex-col overflow-hidden rounded-2xl border border-[#4a7ecc]/55 bg-gradient-to-b from-[#0c1e39] to-[#071326] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(0,0,0,0.25)]">
      {/* Title bar — optional. Hidden when no header text is configured; the
          card is a fixed-height flex column, so the body just fills the freed
          space and the grid stays aligned. Colours are BO-overridable (unset →
          the default gold plate + cream text). */}
      {pack.headerText ? (
        <div
          className={`${pack.headerBg ? '' : GOLD_PLATE} ${PLATE_TEXT} flex h-12 items-center justify-center px-2 text-center text-[1.05rem] leading-[1.05] tracking-[0.05em]`}
          style={{
            ...(pack.headerBg ? { background: pack.headerBg } : {}),
            ...(pack.headerFg ? { color: pack.headerFg } : {}),
          }}
        >
          {pack.headerText}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-4">
        {/* Icon −20% to free room for the (bigger) amount + price below. */}
        <div className="flex flex-1 items-center justify-center" data-fly-source={pack.id}>
          <HeroArt imageUrl={pack.imageUrl} kind={pack.headlineKind} className="h-[4.8rem] w-[4.8rem]" />
        </div>
        {onSale ? <SaleBadge bonusPercent={bonusPercent} /> : null}
        {base !== null || pack.headlineSubLabel ? (
          <div className="mb-2 text-center leading-none">
            {base !== null ? (
              onSale ? (
                <>
                  <div className="text-[1.1rem] font-bold text-[#9aabc5] line-through tabular-nums">{formatAmount(base)}</div>
                  <div className="mt-1 font-display text-[2.05rem] font-black tabular-nums text-white">{formatAmount(boosted!)}</div>
                </>
              ) : (
                <div className="font-display text-[2.05rem] font-black tabular-nums text-white">{formatAmount(base)}</div>
              )
            ) : null}
            {pack.headlineSubLabel ? <div className="mt-1 text-[0.95rem] font-bold text-[#9aabc5]">{pack.headlineSubLabel}</div> : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onBuy}
          disabled={isBusy}
          className={`mt-auto h-14 w-full rounded-lg bg-gradient-to-b from-[#27db74] to-[#079044] font-display text-[1.72rem] font-black text-white ${PRICE_SHADOW} shadow-[inset_0_2px_0_rgba(255,255,255,0.22),0_6px_14px_rgba(0,0,0,0.3)] transition hover:brightness-110 active:translate-y-[1px] disabled:cursor-wait disabled:opacity-60`}
        >
          <PriceLabel priceUsd={pack.priceUsd} priceGems={pack.priceGems} />
        </button>
      </div>
    </article>
  );
}

function SectionTitle({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  // `compact` shrinks the title (smaller font + tighter tracking + no-wrap) so a
  // long label like "Featured Pack" stays on one line in the narrow column. The
  // fixed height keeps both section titles the same height even at different font
  // sizes, so the bundle and the packs grid below them start (and end) level.
  return (
    <h2
      className={`mb-8 flex h-10 items-center justify-center gap-3 font-display font-black uppercase leading-none text-[#ffc93d] ${
        compact ? 'whitespace-nowrap text-[1.5rem] tracking-[0.12em]' : 'text-[2.4rem] tracking-[0.26em]'
      }`}
    >
      <span className={compact ? 'text-sm' : 'text-xl'}>✦</span>
      {children}
      <span className={compact ? 'text-sm' : 'text-xl'}>✦</span>
    </h2>
  );
}

// Placeholder catalog shown while shop_items loads — mirrors the real layout
// (one featured column + an 8-card grid) so nothing jumps when data arrives.
function ShopSkeleton() {
  return (
    <div className="relative z-[3] grid grid-cols-[340px_1fr] gap-8 p-10" aria-hidden="true">
      <section className="flex flex-col">
        <SectionTitle compact>Featured Pack</SectionTitle>
        <div className="min-h-[30rem] flex-1 animate-pulse rounded-2xl border border-[#ffc93d]/20 bg-[#0c1e39]/60" />
      </section>
      <section className="min-w-0">
        <SectionTitle>Packs</SectionTitle>
        <div className="grid grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[18rem] animate-pulse rounded-2xl border border-[#4a7ecc]/25 bg-[#0c1e39]/60" />
          ))}
        </div>
      </section>
    </div>
  );
}

// Shown when the catalog fetch fails, so a network error surfaces as a retry
// instead of masquerading as an empty store on the screen where players pay.
function ShopError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="relative z-[3] flex flex-col items-center justify-center gap-5 px-10 py-24 text-center">
      <p className="max-w-md font-display text-lg font-bold text-[#f6e6b8]">
        The store couldn’t load. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-xl border border-[#ffc93d]/60 bg-gradient-to-b from-[#f6cf5e] to-[#a06f16] px-6 py-3 font-display text-lg font-black uppercase tracking-[0.06em] text-[#3a2406] shadow-[0_4px_10px_rgba(0,0,0,0.35)] transition hover:brightness-110 active:translate-y-[1px]"
      >
        Try again
      </button>
    </div>
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
  // Seed from the warm cache (prefetched by ShopProvider while the app was
  // idle) so a warmed open renders the full catalog on its FIRST frame — no
  // skeleton, no pack art popping in seconds later on the phone. loadShop()
  // still refetches in the background to stay fresh.
  const warmCache = getShopCatalogCache();
  const [data, setData] = useState<MappedShop>(() =>
    warmCache ? mapShop(warmCache.rows) : { bundles: [], packs: [] },
  );
  // The running Store Sale (null when none). bonusPercent drives the badges +
  // boosted amounts; the actual grant boost is enforced server-side. endsAt (when
  // the sale has a scheduled end) drives the live countdown at the modal footer.
  const [sale, setSale] = useState<{ label: string; bonusPercent: number; endsAt: string | null } | null>(
    warmCache?.sale ?? null,
  );
  // Storefront presentation config (BO-editable): header title + an optional
  // blurred themed background. Defaults keep the current look until an operator
  // sets them. See store_config (singleton, public read).
  const [storeConfig, setStoreConfig] = useState<{ title: string; bgImageUrl: string | null }>(
    warmCache?.config ?? { title: 'Store', bgImageUrl: null },
  );
  const [rewardFlights, setRewardFlights] = useState<readonly RewardFlightSpec[]>([]);
  const nextFlightIdRef = useRef(1);
  // Catalog load state. The shop_items query is the gating fetch (the sale +
  // store_config are best-effort enhancements). 'error' shows a retry rather than
  // an empty store, so a network failure never masquerades as "no packs".
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(warmCache ? 'ready' : 'loading');
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Gate the reveal on the operator-uploaded pack art + themed background so the
  // store appears fully-formed instead of images popping in after the frame.
  // (Static currency icons are already cached from the lobby; only these remote
  // BO images pop in.) Errors don't block the gate — a missing image can't hang it.
  const shopImageUrls = useMemo(
    () => [...data.bundles.map((b) => b.imageUrl), ...data.packs.map((p) => p.imageUrl), storeConfig.bgImageUrl],
    [data, storeConfig],
  );
  const { ready: shopImagesReady } = useImagePreloader(shopImageUrls);
  const contentReady = status === 'ready' && shopImagesReady;

  const loadShop = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setStatus('ready');
      return;
    }
    // Keep showing the warm-cached catalog (no skeleton) while refreshing;
    // only a cold open goes through the loading state.
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    // Catalog is the gating fetch — its failure is what becomes the retry state.
    // An empty result set is a legitimately empty store, not an error.
    const { data: rows, error } = await supabase
      .from('shop_items')
      .select('*')
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true });
    if (!mountedRef.current) return;
    if (error || !rows) {
      // A refresh failure with a warm catalog on screen shouldn't nuke the
      // store into the retry state — only a cold load does.
      setStatus((s) => (s === 'ready' ? s : 'error'));
      return;
    }
    setData(mapShop(rows));
    setStatus('ready');
    updateShopCatalogCache({ rows });
    // Sale + storefront config are best-effort enhancements: a failure here must
    // never block the store, so they don't touch `status`.
    void supabase.rpc('current_store_sale').then(({ data: saleRows, error: saleErr }) => {
      if (!mountedRef.current || saleErr || !saleRows || saleRows.length === 0) return;
      const nextSale = { label: saleRows[0].label, bonusPercent: saleRows[0].bonus_percent, endsAt: saleRows[0].ends_at };
      setSale(nextSale);
      updateShopCatalogCache({ sale: nextSale });
    });
    void supabase
      .from('store_config')
      .select('title, bg_image_url')
      .eq('id', true)
      .maybeSingle()
      .then(({ data: row, error: cfgErr }) => {
        if (!mountedRef.current || cfgErr || !row) return;
        const nextConfig = { title: row.title || 'Store', bgImageUrl: row.bg_image_url };
        setStoreConfig(nextConfig);
        updateShopCatalogCache({ config: nextConfig });
      });
  }, []);

  useEffect(() => {
    void loadShop();
  }, [loadShop]);

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

  // Native uses Play Billing. The web mock remains server-gated for test accounts.
  const handleUsdPurchase = async (item: BuyDescriptor) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    const billing = await getBilling();
    const outcome = await billing.purchase({ itemId: item.id, label: item.label });
    setBusyId(null);
    if (outcome.status !== 'granted') {
      if (outcome.status === 'error') {
        const { code } = outcome;
        if (code === 'already_owned') showToast('info', 'You already own that board.');
        else if (code === 'unsupported_grant') showToast('error', `${item.label}: unsupported grant.`);
        else if (code === 'not_authorized') showToast('info', 'Purchases are available in the app.');
        else showToast('error', 'Purchase failed.');
      }
      // cancelled / pending: stay silent.
      return;
    }
    const sourceEl = document.querySelector(`[data-fly-source="${item.id}"]`);
    if (sourceEl && item.flightKind) spawnFlights(item.flightKind, sourceEl, 6);
    window.setTimeout(() => void refreshWallet(), 600);
    void refreshXpBoost();
    showToast('success', `${item.label} purchased ✓`);
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
            className="relative isolate flex flex-col overflow-hidden rounded-[22px] border border-[#ffc93d]/40 text-[#f6f0df] shadow-[0_26px_70px_rgba(0,0,0,0.55)]"
            style={{ width: PANEL_DESIGN_W }}
          >
            {/* ---- Liquid-glass surface (replaces the flat blue panel) ----
                A colourful base (stands in for the lobby behind the modal) gives
                the refraction edges to bend; the effect layer blurs + distorts it;
                the dark tint keeps it on-theme and the content readable; the
                shine adds the glossy rim.
                NOTE: backdrop-filter + the SVG displacement filter are GPU-heavy
                and Chromium-centric — fine on web / Android WebView, but worth a
                perf check on low-end devices. Tune via the inline values below. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0"
              style={{
                background:
                  'radial-gradient(38% 48% at 18% 22%, rgba(56,189,248,0.55), transparent 70%),' +
                  'radial-gradient(42% 52% at 84% 16%, rgba(250,204,21,0.45), transparent 70%),' +
                  'radial-gradient(48% 58% at 78% 86%, rgba(139,92,246,0.50), transparent 70%),' +
                  'radial-gradient(44% 54% at 22% 88%, rgba(16,185,129,0.48), transparent 70%),' +
                  '#03070d',
              }}
            />
            {/* The frosted-glass layer (backdrop-filter blur(14px)+saturate +
                an SVG displacement filter) was REMOVED for mobile perf — it was
                the single heaviest surface in the app, and all it blurred was
                the static gradient layer above (already smooth, so the visual
                delta is tiny). If the glass texture is ever missed, bake it
                into a static overlay image instead of a live filter. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]" style={{ background: 'rgba(10,26,51,0.55)' }} />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[2]"
              style={{ boxShadow: 'inset 2px 2px 1px 0 rgba(255,255,255,0.5), inset -1px -1px 1px 1px rgba(255,255,255,0.22)' }}
            />

            {/* Header — the only place the BO themed background shows: behind the
                title + balances, clipped to the header band down to the separator.
                Full-opacity, gentle 2px blur; negative z keeps it under the header
                content (which stays static and paints on top). */}
            <header className="relative z-[3] grid grid-cols-[1fr_auto_1fr] items-center gap-4 overflow-hidden border-b border-[#ffc93d]/25 bg-gradient-to-b from-[#0c1c37]/40 to-[#050d1c]/10 px-10 py-5">
              {storeConfig.bgImageUrl ? (
                <img
                  aria-hidden="true"
                  src={storeConfig.bgImageUrl}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
                  style={{ filter: 'blur(2px)', transform: 'scale(1.06)' }}
                />
              ) : null}
              <span aria-hidden="true" />
              <h1 className="text-center font-display text-[2.9rem] font-black uppercase tracking-[0.18em] text-[#ffc93d] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]">
                {storeConfig.title || 'Store'}
              </h1>
              <div className="flex items-center justify-end gap-4">
                {/* Same balance element as the lobby, with the real wallet. The
                    lobby pill sizes itself off `--lobby-u` (defined on
                    .lobby-shell); outside the lobby we scope a fixed unit + a
                    definite height so it renders at the right size — the same
                    trick the profile page (.profile-top-currency) uses. No "+"
                    here — you're already in the shop. */}
                <div
                  className="flex items-center gap-3"
                  style={{ '--lobby-u': '1.02px', height: '3.7rem' } as CSSProperties}
                >
                  <CurrencyPill flyTarget="coins" label="Coins" value={wallet?.coins} icon="/lobby/icons/gold-coin.webp" onAdd={() => {}} showAdd={false} />
                  <CurrencyPill flyTarget="gems" label="Gems" value={wallet?.gems} icon="/lobby/icons/gem.webp" onAdd={() => {}} showAdd={false} />
                </div>
                {/* App-standard close: golden frame, black fill (matches the
                    board / other modals). */}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close store"
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-[#c89a47] bg-gradient-to-b from-[#2b2421] via-[#161210] to-[#0c0908] text-[#ffd16f] shadow-[0_4px_8px_rgba(0,0,0,0.45)] transition hover:brightness-110 active:scale-95"
                >
                  {/* SVG cross — the × glyph sits visually high; this is centered. */}
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M7 7l10 10M17 7L7 17" />
                  </svg>
                </button>
              </div>
            </header>

            {/* Content: Featured Pack | Packs grid — skeleton while the catalog
                loads, a retry on failure, otherwise the two sections. */}
            {status === 'error' ? (
              <ShopError onRetry={() => void loadShop()} />
            ) : !contentReady ? (
              <ShopSkeleton />
            ) : (
            <div className="relative z-[3] grid grid-cols-[340px_1fr] gap-8 p-10">
              {/* No divider; the column is a flex stack so the bundle below the
                  title stretches to the exact height of the two pack rows. */}
              <section className="flex flex-col">
                <SectionTitle compact>Featured Pack</SectionTitle>
                {data.bundles.length > 0 ? (
                  <div className="flex flex-1 flex-col">
                    {data.bundles.slice(0, 1).map((b) => (
                      <BundleCard
                        key={b.id}
                        bundle={b}
                        isBusy={busyId === b.id}
                        bonusPercent={sale?.bonusPercent ?? 0}
                        onBuy={() => buy({ id: b.id, label: b.title, priceUsd: b.priceUsd, priceGems: b.priceGems, flightKind: flightKindOf(b.headlineKind) })}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-[#9aabc5]/25 text-center text-sm text-[#9aabc5]">
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
                        bonusPercent={sale?.bonusPercent ?? 0}
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
            )}

            {/* Live sale countdown — only when a running sale has a scheduled end. */}
            {contentReady && sale?.endsAt ? <SaleCountdown endsAt={sale.endsAt} /> : null}
          </main>
        </div>
      </ScaleInModal>

      {/* SVG displacement filter powering the liquid-glass refraction above.
          Hidden; referenced by the effect layer via url(#shop-glass-distortion).
          Trimmed to the 3 primitives that actually feed the output (the source
          effect carried 3 dead ones); scale 150 matches the reference warp. */}
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <filter id="shop-glass-distortion" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.01 0.01" numOctaves="1" seed="5" result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
          <feDisplacementMap in="SourceGraphic" in2="softMap" scale="150" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

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
