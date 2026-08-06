import type {Database, Json} from "../../../../../packages/shared/src/database"

export type ShopKind = "coin_pack" | "gem_pack" | "board_theme" | "cosmetic" | "bundle" | "special_offer"
export type HeadlineKind = "coins" | "gems" | "xp-boost" | "lucky-dice"
export type RewardKind = "coins" | "gems" | "xp" | "chest"
export type Ribbon = "best-value" | "popular" | null

export type Reward = {
  readonly kind: RewardKind,
  readonly label: string,
  /** Numeric grant for coins/gems rewards (null for xp/chest); drives the
   *  struck-base → boosted display when a Store Sale is running. */
  readonly amount: number | null,
}

/** A featured bundle card (kind='bundle'). */
export type Bundle = {
  readonly id: string,
  /** Canonical name — used for the purchase toast + admin, not necessarily shown
   *  on the card (the visible title bar is `headerText`). */
  readonly title: string,
  /** Title-bar text; null hides the bar entirely. */
  readonly headerText: string | null,
  /** Optional CSS colours for the title bar (null → default gold plate / cream). */
  readonly headerBg: string | null,
  readonly headerFg: string | null,
  readonly ribbon: Ribbon,
  readonly headlineKind: "coins" | "gems",
  /** Operator-uploaded pack art (shop_items.image_url); falls back to the
   *  headline-currency icon when null. */
  readonly imageUrl: string | null,
  readonly rewards: readonly Reward[],
  readonly priceUsd: number | null,
  readonly priceGems: number | null,
}

/** A single pack in the right-hand grid. */
export type Pack = {
  readonly id: string,
  readonly kind: ShopKind,
  readonly title: string,
  /** Title-bar text; null hides the bar. Colours override the gold plate. */
  readonly headerText: string | null,
  readonly headerBg: string | null,
  readonly headerFg: string | null,
  readonly headlineKind: HeadlineKind,
  readonly headlineLabel: string,
  readonly headlineSubLabel?: string,
  /** Operator-uploaded pack art (shop_items.image_url); falls back to the
   *  headline icon when null. */
  readonly imageUrl: string | null,
  /** Numeric grant of the headline currency (coins/gems), or null for
   *  non-currency packs. Drives the struck-base → boosted sale display. */
  readonly baseAmount: number | null,
  readonly priceUsd: number | null,
  readonly priceGems: number | null,
}

type ShopItemRow = Database["public"]["Tables"]["shop_items"]["Row"]

type Presentation = {
  readonly placement?: string,
  readonly ribbon?: Ribbon,
  readonly headlineKind?: string,
  /** Bundle title bar. Rendered only when `text` is non-empty; `bg`/`fg` are
   *  optional CSS colours overriding the default gold gradient / cream text. */
  readonly header?: {readonly text?: string, readonly bg?: string, readonly fg?: string},
  readonly headline?: {readonly kind?: HeadlineKind, readonly label?: string, readonly subLabel?: string},
  readonly rewards?: readonly {readonly kind: RewardKind, readonly label: string}[],
}

function getPresentation(contents: Json): Presentation | null {
  if (contents === null || typeof contents !== "object" || Array.isArray(contents)) return null
  const p = (contents as Record<string, unknown>).presentation
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null
  return p
}

/** Reads contents.grants[key] as a number (coins/gems amounts), else null.
 *  This is the *base* the server multiplies during a sale, so the UI boosts the
 *  same value the wallet will actually receive. */
function numericGrant(contents: Json, key: "coins" | "gems"): number | null {
  if (contents === null || typeof contents !== "object" || Array.isArray(contents)) return null
  const grants = (contents as Record<string, unknown>).grants
  if (grants === null || typeof grants !== "object" || Array.isArray(grants)) return null
  const v = (grants as Record<string, unknown>)[key]
  return typeof v === "number" ? v : null
}

/** A trimmed non-empty string, or null — used for optional presentation fields
 *  (header text / colours) where empty means "unset / hide / use default". */
function nonEmptyStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null
}

// Compact coin/gem amount for the cards, so big values don't overrun the price
// button: 1,725,000 → "1.73M", 504,000 → "504K", 78,750 → "78.75K", 750 → "750".
// Prices (USD / gem cost) are intentionally left exact — this is grant amounts only.
const AMOUNT_FMT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
})

export function formatAmount(n: number): string {
  return AMOUNT_FMT.format(n)
}

function defaultPackHeadline(row: ShopItemRow): HeadlineKind {
  if (row.kind === "coin_pack") return "coins"
  if (row.kind === "special_offer") return "xp-boost"
  return "gems"
}

function rowToBundle(row: ShopItemRow): Bundle | null {
  const pres = getPresentation(row.contents)
  const priceUsd = row.price_cents !== null ? row.price_cents / 100 : null
  const priceGems = row.price_gems
  if (priceUsd === null && priceGems === null) return null
  const headlineKind = pres?.headlineKind === "gems" ? "gems" : "coins"
  const header = pres?.header
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
      amount: r.kind === "coins" || r.kind === "gems" ? numericGrant(row.contents, r.kind) : null,
    })),
    priceUsd,
    priceGems,
  }
}

function rowToPack(row: ShopItemRow): Pack | null {
  const pres = getPresentation(row.contents)
  const priceUsd = row.price_cents !== null ? row.price_cents / 100 : null
  const priceGems = row.price_gems
  if (priceUsd === null && priceGems === null) return null
  const headline = pres?.headline ?? {}
  const headlineKind = headline.kind ?? defaultPackHeadline(row)
  const currency = headlineKind === "coins" ? "coins" : headlineKind === "gems" ? "gems" : null
  const header = pres?.header
  return {
    id: row.id,
    kind: row.kind,
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
  }
}

export type MappedShop = {
  readonly bundles: readonly Bundle[],
  readonly packs: readonly Pack[],
}

export function mapShop(rows: readonly ShopItemRow[]): MappedShop {
  const bundles: Bundle[] = []
  const packs: Pack[] = []
  for (const row of rows) {
    if (!row.is_enabled) continue
    const pres = getPresentation(row.contents)
    const isFeatured = row.kind === "bundle" || pres?.placement === "featured"
    if (isFeatured) {
      const b = rowToBundle(row)
      if (b) bundles.push(b)
    }
    else {
      const p = rowToPack(row)
      if (p) packs.push(p)
    }
  }
  return {
    bundles,
    packs,
  }
}
