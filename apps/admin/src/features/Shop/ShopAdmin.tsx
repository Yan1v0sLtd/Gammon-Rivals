import type {Database} from "../../../../../packages/shared/src/database"
import {ConfigTable} from "../../components/ConfigTable"
import {DangerButton} from "../../components/DangerButton"
import {Field} from "../../components/Field"
import {ImageField} from "../../components/ImageField"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import {moneyFromCents} from "../../lib/moneyFromCents"
import {readBoardGrant} from "../../lib/readBoardGrant"
import {readGrant} from "../../lib/readGrant"
import {readHeader} from "../../lib/readHeader"
import {readHeadline} from "../../lib/readHeadline"
import {readPres} from "../../lib/readPres"
import {readRewards} from "../../lib/readRewards"
import {readXpBoost} from "../../lib/readXpBoost"
import {shopToDraft, type ShopDraft} from "../../lib/shopToDraft"
import {writeBoardGrant} from "../../lib/writeBoardGrant"
import {writeGrantNumber} from "../../lib/writeGrantNumber"
import {writeHeader} from "../../lib/writeHeader"
import {writeHeadline} from "../../lib/writeHeadline"
import {writePresField} from "../../lib/writePresField"
import {writeRewards} from "../../lib/writeRewards"
import {writeXpBoost} from "../../lib/writeXpBoost"

type ShopItem = Database["public"]["Tables"]["shop_items"]["Row"]
type ShopKind = ShopItem["kind"]

type StoreConfigDraft = {title: string, bg_image_url: string}
type SaleDraft = {
  id: string | null, label: string, bonus_percent: string, is_active: boolean, starts_at: string, ends_at: string,
}

const shopKinds: readonly ShopKind[] = ["coin_pack", "gem_pack", "board_theme", "cosmetic", "bundle", "special_offer"]

type Props = {
  readonly shopItems: readonly ShopItem[],
  readonly shopDraft: ShopDraft,
  readonly saleDraft: SaleDraft,
  readonly storeConfigDraft: StoreConfigDraft,
  readonly canManage: boolean,
  readonly savingKey: string | null,
  readonly onSetShopDraft: (updater: (draft: ShopDraft) => ShopDraft) => void,
  readonly onSetSaleDraft: (updater: (draft: SaleDraft) => SaleDraft) => void,
  readonly onSetStoreConfigDraft: (updater: (draft: StoreConfigDraft) => StoreConfigDraft) => void,
  readonly onSaveStoreConfig: () => void,
  readonly onSaveStoreSale: () => void,
  readonly onSaveShop: () => void,
  readonly onDeleteShop: () => void,
}

/**
 * Shop BO admin — the storefront appearance, the global Store Sale promo,
 * and the shop-items editor (packs, bundles, cosmetics, board themes).
 * Purely presentational: it renders from data the parent (Admin) already
 * owns and reports edits/actions back through explicit callbacks. No data
 * fetching here.
 */
export function ShopAdmin({
  shopItems,
  shopDraft,
  saleDraft,
  storeConfigDraft,
  canManage,
  savingKey,
  onSetShopDraft,
  onSetSaleDraft,
  onSetStoreConfigDraft,
  onSaveStoreConfig,
  onSaveStoreSale,
  onSaveShop,
  onDeleteShop,
}: Props) {
  return (<div className="space-y-4">
    {/* Storefront appearance — the shop popup's header title + an
            optional blurred themed background. Independent of the sale, so
            an operator can re-theme the shop (e.g. "Shop Sale!" + a themed
            background for a promo) with or without a running sale. */}
    <div className="rounded-xl border border-[#ffc93d]/30 bg-[#ffc93d]/[0.06] p-4">
      <h2 className="text-lg font-black text-[#ffd16f]">Storefront appearance</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
        Sets the shop popup’s title and an optional blurred background image. Use them to theme a promo — e.g.
        title “Shop Sale!” with an “American” background for a 4th-of-July sale. Leave the background empty
        for the default look.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field
          label="Shop title"
          value={storeConfigDraft.title}
          onChange={(title) => {
            onSetStoreConfigDraft((d) => ({
              ...d,
              title,
            }))
          }}/>
        <ImageField
          disabled={!canManage}
          folder="store"
          kind="background"
          label="Background image (optional)"
          value={storeConfigDraft.bg_image_url}
          onChange={(bg_image_url) => {
            onSetStoreConfigDraft((d) => ({
              ...d,
              bg_image_url,
            }))
          }}/>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <PrimaryButton
          disabled={!canManage || savingKey === "store-config"}
          onClick={onSaveStoreConfig}>Save appearance</PrimaryButton>
      </div>
    </div>
    {/* Store Sale — one global bonus added to every pack's coin/gem
            grants. Players see a "+X% EXTRA" badge + the boosted amount;
            the boost is applied server-side at purchase. */}
    <div className="rounded-xl border border-[#ffc93d]/30 bg-[#ffc93d]/[0.06] p-4">
      <h2 className="text-lg font-black text-[#ffd16f]">Store Sale</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
        Adds extra coins &amp; gems to every pack. Players see a “+{saleDraft.bonus_percent || "0"}% EXTRA”
        badge and the boosted amount; the boost is enforced server-side at purchase. Leave the dates blank for
        a manual on/off sale.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Label"
          value={saleDraft.label}
          onChange={(label) => {
            onSetSaleDraft((d) => ({
              ...d,
              label,
            }))
          }}/>
        <Field
          label="Bonus %"
          value={saleDraft.bonus_percent}
          onChange={(bonus_percent) => {
            onSetSaleDraft((d) => ({
              ...d,
              bonus_percent,
            }))
          }}/>
        <Field
          label="Starts at (optional)"
          type="datetime-local"
          value={saleDraft.starts_at}
          onChange={(starts_at) => {
            onSetSaleDraft((d) => ({
              ...d,
              starts_at,
            }))
          }}/>
        <Field
          label="Ends at (optional)"
          type="datetime-local"
          value={saleDraft.ends_at}
          onChange={(ends_at) => {
            onSetSaleDraft((d) => ({
              ...d,
              ends_at,
            }))
          }}/>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Toggle
          checked={saleDraft.is_active}
          label="Sale active"
          onChange={(is_active) => {
            onSetSaleDraft((d) => ({
              ...d,
              is_active,
            }))
          }}/>
        <PrimaryButton
          disabled={!canManage || savingKey === "store-sale"}
          onClick={onSaveStoreSale}>Save sale</PrimaryButton>
      </div>
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]">
      <ConfigTable
        rows={shopItems.map((row) => [row.display_name, row.kind, moneyFromCents(row.price_cents), row.is_enabled ? "Enabled" : "Disabled"])}
        title="Shop items"
        onRowClick={(index) => {
          onSetShopDraft(() => shopToDraft(shopItems[index]))
        }}/>
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <h2 className="text-lg font-black">Edit shop item</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field
            label="Product id"
            value={shopDraft.id}
            onChange={(id) => {
              onSetShopDraft((d) => ({
                ...d,
                id,
              }))
            }}/>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
            Kind
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
              value={shopDraft.kind}
              onChange={(event) => {
                onSetShopDraft((d) => ({
                  ...d,
                  kind: event.target.value as ShopKind,
                }))
              }}>
              {shopKinds.map((kind) => (<option
                key={kind}
                value={kind}>{kind}</option>))}
            </select>
          </label>
          <Field
            label="Name"
            value={shopDraft.display_name}
            onChange={(display_name) => {
              onSetShopDraft((d) => ({
                ...d,
                display_name,
              }))
            }}/>
          <Field
            label="Sort order"
            value={shopDraft.sort_order}
            onChange={(sort_order) => {
              onSetShopDraft((d) => ({
                ...d,
                sort_order,
              }))
            }}/>
          <Field
            label="Price cents"
            value={shopDraft.price_cents}
            onChange={(price_cents) => {
              onSetShopDraft((d) => ({
                ...d,
                price_cents,
              }))
            }}/>
          <Field
            label="Price coins"
            value={shopDraft.price_coins}
            onChange={(price_coins) => {
              onSetShopDraft((d) => ({
                ...d,
                price_coins,
              }))
            }}/>
          <Field
            label="Price gems"
            value={shopDraft.price_gems}
            onChange={(price_gems) => {
              onSetShopDraft((d) => ({
                ...d,
                price_gems,
              }))
            }}/>
          <Field
            label="Max purchases"
            value={shopDraft.max_purchases_per_user}
            onChange={(max_purchases_per_user) => {
              onSetShopDraft((d) => ({
                ...d,
                max_purchases_per_user,
              }))
            }}/>
        </div>
        <div className="mt-3 space-y-3">
          <Field
            label="Description"
            value={shopDraft.description}
            onChange={(description) => {
              onSetShopDraft((d) => ({
                ...d,
                description,
              }))
            }}/>
          <ImageField
            disabled={!canManage}
            folder="shop"
            kind={shopDraft.kind}
            label="Pack image"
            value={shopDraft.image_url}
            onChange={(image_url) => {
              onSetShopDraft((d) => ({
                ...d,
                image_url,
              }))
            }}/>
          <Field
            label="Apple product id"
            value={shopDraft.apple_product_id}
            onChange={(apple_product_id) => {
              onSetShopDraft((d) => ({
                ...d,
                apple_product_id,
              }))
            }}/>
          <Field
            label="Google product id"
            value={shopDraft.google_product_id}
            onChange={(google_product_id) => {
              onSetShopDraft((d) => ({
                ...d,
                google_product_id,
              }))
            }}/>
          {/* Structured grants & presentation (Phase B). These edit
                specific paths in the contents JSON below — which stays the
                source of truth — so any other keys are preserved. */}
          <div className="space-y-3 rounded-lg border border-[#ffc93d]/25 bg-[#ffc93d]/[0.05] p-3">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-[#ffd16f]">Grants — what the
              buyer receives
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Coins"
                value={readGrant(shopDraft.contents, "coins")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeGrantNumber(d.contents, "coins", v),
                  }))
                }}/>
              <Field
                label="Gems"
                value={readGrant(shopDraft.contents, "gems")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeGrantNumber(d.contents, "gems", v),
                  }))
                }}/>
              <Field
                label="XP boost — days"
                value={readXpBoost(shopDraft.contents, "days")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeXpBoost(d.contents, "days", v),
                  }))
                }}/>
              <Field
                label="XP boost — multiplier (2-10)"
                value={readXpBoost(shopDraft.contents, "multiplier")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeXpBoost(d.contents, "multiplier", v),
                  }))
                }}/>
              <Field
                label="Board theme id (unlock)"
                value={readBoardGrant(shopDraft.contents)}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeBoardGrant(d.contents, v),
                  }))
                }}/>
            </div>

            <div className="text-xs font-black uppercase tracking-[0.14em] text-[#ffd16f]">Presentation</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                Placement
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                  value={readPres(shopDraft.contents).placement === "featured" ? "featured" : "grid"}
                  onChange={(e) => {
                    onSetShopDraft((d) => ({
                      ...d,
                      contents: writePresField(d.contents, "placement", e.target.value === "featured" ? "featured" : ""),
                    }))
                  }}>
                  <option value="grid">Packs grid</option>
                  <option value="featured">Featured</option>
                </select>
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                Ribbon
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                  value={(readPres(shopDraft.contents).ribbon as string) || "none"}
                  onChange={(e) => {
                    onSetShopDraft((d) => ({
                      ...d,
                      contents: writePresField(d.contents, "ribbon", e.target.value),
                    }))
                  }}>
                  <option value="none">None</option>
                  <option value="popular">Popular</option>
                  <option value="best-value">Best Value</option>
                </select>
              </label>
            </div>

            {/* Card header (title bar) — applies to every card (bundle +
                  packs). Empty text hides the bar entirely; the colours
                  override the default gold plate + cream text. */}
            <div className="text-xs font-black uppercase tracking-[0.14em] text-[#ffd16f]">Card header (title
              bar)
            </div>
            <div className="space-y-2 rounded-md border border-white/10 bg-black/10 p-2">
              <Field
                label="Header text (leave empty for no header bar)"
                value={readHeader(shopDraft.contents, "text")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeHeader(d.contents, "text", v),
                  }))
                }}/>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/40">
                  Background
                  <input
                    className="mt-1 block h-9 w-14 cursor-pointer rounded border border-white/10 bg-black/20"
                    type="color"
                    value={readHeader(shopDraft.contents, "bg") || "#d9a531"}
                    onChange={(e) => {
                      onSetShopDraft((d) => ({
                        ...d,
                        contents: writeHeader(d.contents, "bg", e.target.value),
                      }))
                    }}/>
                </label>
                <SecondaryButton
                  onClick={() => {
                    onSetShopDraft((d) => ({
                      ...d,
                      contents: writeHeader(d.contents, "bg", ""),
                    }))
                  }}>Default
                  gold</SecondaryButton>
                <label className="block text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/40">
                  Text color
                  <input
                    className="mt-1 block h-9 w-14 cursor-pointer rounded border border-white/10 bg-black/20"
                    type="color"
                    value={readHeader(shopDraft.contents, "fg") || "#fff7dc"}
                    onChange={(e) => {
                      onSetShopDraft((d) => ({
                        ...d,
                        contents: writeHeader(d.contents, "fg", e.target.value),
                      }))
                    }}/>
                </label>
                <SecondaryButton onClick={() => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeHeader(d.contents, "fg", ""),
                  }))
                }}>Default</SecondaryButton>
              </div>
            </div>

            {shopDraft.kind === "bundle" ? (<div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                Headline currency (hero icon)
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                  value={readPres(shopDraft.contents).headlineKind === "gems" ? "gems" : "coins"}
                  onChange={(e) => {
                    onSetShopDraft((d) => ({
                      ...d,
                      contents: writePresField(d.contents, "headlineKind", e.target.value),
                    }))
                  }}>
                  <option value="coins">Coins</option>
                  <option value="gems">Gems</option>
                </select>
              </label>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/40">Reward chips
              </div>
              {readRewards(shopDraft.contents).map((rw, i) => (<div
                key={`reward-${rw.kind}-${rw.label}`}
                className="flex items-end gap-2">
                <label
                  className="block text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/30">
                  Icon
                  <select
                    className="mt-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm normal-case tracking-normal text-white outline-none"
                    value={rw.kind}
                    onChange={(e) => {
                      onSetShopDraft((d) => {
                        const rows = readRewards(d.contents)
                        rows[i] = {
                          ...rows[i],
                          kind: e.target.value,
                        }
                        return {
                          ...d,
                          contents: writeRewards(d.contents, rows),
                        }
                      })
                    }}>
                    <option value="coins">coins</option>
                    <option value="gems">gems</option>
                    <option value="xp">xp</option>
                    <option value="chest">chest</option>
                  </select>
                </label>
                <div className="flex-1"><Field
                  label="Label"
                  value={rw.label}
                  onChange={(v) => {
                    onSetShopDraft((d) => {
                      const rows = readRewards(d.contents)
                      rows[i] = {
                        ...rows[i],
                        label: v,
                      }
                      return {
                        ...d,
                        contents: writeRewards(d.contents, rows),
                      }
                    })
                  }}/></div>
                <SecondaryButton onClick={() => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeRewards(d.contents, readRewards(d.contents).filter((_, j) => j !== i)),
                  }))
                }}>Remove</SecondaryButton>
              </div>))}
              <SecondaryButton onClick={() => {
                onSetShopDraft((d) => ({
                  ...d,
                  contents: writeRewards(d.contents, [...readRewards(d.contents), {
                    kind: "coins",
                    label: "",
                  }]),
                }))
              }}>+ Add reward</SecondaryButton>
            </div>) : (<div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                Headline icon
                <select
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                  value={readHeadline(shopDraft.contents, "kind") || "coins"}
                  onChange={(e) => {
                    onSetShopDraft((d) => ({
                      ...d,
                      contents: writeHeadline(d.contents, "kind", e.target.value),
                    }))
                  }}>
                  <option value="coins">coins</option>
                  <option value="gems">gems</option>
                  <option value="xp-boost">xp-boost</option>
                  <option value="lucky-dice">lucky-dice</option>
                </select>
              </label>
              <Field
                label="Headline label (e.g. 10,000)"
                value={readHeadline(shopDraft.contents, "label")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeHeadline(d.contents, "label", v),
                  }))
                }}/>
              <Field
                label="Headline sub-label (e.g. x3 · 7 Days)"
                value={readHeadline(shopDraft.contents, "subLabel")}
                onChange={(v) => {
                  onSetShopDraft((d) => ({
                    ...d,
                    contents: writeHeadline(d.contents, "subLabel", v),
                  }))
                }}/>
            </div>)}
          </div>
          <TextArea
            label="Advanced — raw contents JSON"
            value={shopDraft.contents}
            onChange={(contents) => {
              onSetShopDraft((d) => ({
                ...d,
                contents,
              }))
            }}/>
          <TextArea
            label="Visibility rules JSON object"
            value={shopDraft.visibility_rules}
            onChange={(visibility_rules) => {
              onSetShopDraft((d) => ({
                ...d,
                visibility_rules,
              }))
            }}/>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Starts at"
              type="datetime-local"
              value={shopDraft.starts_at}
              onChange={(starts_at) => {
                onSetShopDraft((d) => ({
                  ...d,
                  starts_at,
                }))
              }}/>
            <Field
              label="Ends at"
              type="datetime-local"
              value={shopDraft.ends_at}
              onChange={(ends_at) => {
                onSetShopDraft((d) => ({
                  ...d,
                  ends_at,
                }))
              }}/>
          </div>
          <Toggle
            checked={shopDraft.is_enabled}
            label="Enabled"
            onChange={(is_enabled) => {
              onSetShopDraft((d) => ({
                ...d,
                is_enabled,
              }))
            }}/>
          <Toggle
            checked={shopDraft.exclude_from_sale}
            label="Exclude from Store Sale (no bonus on this item)"
            onChange={(exclude_from_sale) => {
              onSetShopDraft((d) => ({
                ...d,
                exclude_from_sale,
              }))
            }}/>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton
              disabled={!canManage || savingKey === "shop"}
              onClick={onSaveShop}>Save
              shop item</PrimaryButton>
            <SecondaryButton onClick={() => {
              onSetShopDraft(() => shopToDraft())
            }}>New</SecondaryButton>
            {/* Duplicate clones the loaded item into a NEW draft (suffixed id + "Copy of"
                  name, every other field carried over) so you only edit what differs. Saving
                  upserts the new id as a fresh row. Same load-an-existing-item guard as Delete. */}
            <SecondaryButton
              disabled={!canManage || !shopItems.some((item) => item.id === shopDraft.id)}
              onClick={() => {
                onSetShopDraft((d) => ({
                  ...d,
                  id: d.id ? `${d.id}-copy` : "",
                  display_name: d.display_name ? `Copy of ${d.display_name}` : d.display_name,
                }))
              }}>Duplicate</SecondaryButton>
            {/* Delete is enabled only when an existing item is loaded into the draft.
                  RLS (shop_items_delete_admin) gates it server-side; FKs are delete-safe. */}
            <DangerButton
              disabled={!canManage || !shopItems.some((item) => item.id === shopDraft.id) || savingKey === "shop-delete"}
              onClick={onDeleteShop}>Delete</DangerButton>
          </div>
        </div>
      </div>
    </div>
  </div>)
}
