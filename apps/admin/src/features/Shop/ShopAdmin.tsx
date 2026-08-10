import {useEffect, useState} from "react"

import type {Database} from "../../../../../packages/shared/src/database"
import {ConfigTable} from "../../components/ConfigTable"
import {DangerButton} from "../../components/DangerButton"
import {Field} from "../../components/Field"
import {ImageField} from "../../components/ImageField"
import {PrimaryButton} from "../../components/PrimaryButton"
import {SecondaryButton} from "../../components/SecondaryButton"
import {TextArea} from "../../components/TextArea"
import {Toggle} from "../../components/Toggle"
import {useConfirm} from "../../components/useConfirm"
import {emptyToNull} from "../../lib/emptyToNull"
import {moneyFromCents} from "../../lib/moneyFromCents"
import {numberOrNull} from "../../lib/numberOrNull"
import {parseJson} from "../../lib/parseJson"
import {readBoardGrant} from "../../lib/readBoardGrant"
import {readGrant} from "../../lib/readGrant"
import {readHeader} from "../../lib/readHeader"
import {readHeadline} from "../../lib/readHeadline"
import {readPres} from "../../lib/readPres"
import {readRewards} from "../../lib/readRewards"
import {readXpBoost} from "../../lib/readXpBoost"
import {requiredNumber} from "../../lib/requiredNumber"
import {type ShopDraft, shopToDraft} from "../../lib/shopToDraft"
import {writeBoardGrant} from "../../lib/writeBoardGrant"
import {writeGrantNumber} from "../../lib/writeGrantNumber"
import {writeHeader} from "../../lib/writeHeader"
import {writeHeadline} from "../../lib/writeHeadline"
import {writePresField} from "../../lib/writePresField"
import {writeRewards} from "../../lib/writeRewards"
import {writeXpBoost} from "../../lib/writeXpBoost"

import styles from "./ShopAdmin.module.css"
import {
  useDeleteShopItemMutation,
  useGetShopItemsQuery,
  useGetStoreConfigQuery,
  useGetStoreSaleQuery,
  useUpdateShopItemMutation,
  useUpsertStoreConfigMutation,
  useUpsertStoreSaleMutation,
} from "./ShopApi"
import {type SaleDraft, saleRowToDraft, type ShopItem, type StoreConfigDraft, storeConfigRowToDraft} from "./ShopData"

type ShopKind = ShopItem["kind"]

const shopKinds: readonly ShopKind[] = ["coin_pack", "gem_pack", "board_theme", "cosmetic", "bundle", "special_offer"]

type Props = {
  readonly canManage: boolean,
  readonly currentUserId: string | null,
  readonly onError: (err: unknown) => void,
  readonly onBeforeSave: () => void,
}

/**
 * Shop BO admin — the storefront appearance, the global Store Sale promo,
 * and the shop-items editor (packs, bundles, cosmetics, board themes).
 * Owns the three reads (items/sale/config) and all four writes; the
 * drafts and the pending keys are local feature state. The sale/config
 * reads fail silently by design — the legacy loader only threw on
 * shop_items, so only that error reaches onError.
 */
export function ShopAdmin({
  canManage,
  currentUserId,
  onError,
  onBeforeSave,
}: Props) {
  const {
    data: shopItems = [],
    error: shopItemsError,
  } = useGetShopItemsQuery()
  const {
    data: sale,
  } = useGetStoreSaleQuery()
  const {
    data: storeConfig,
  } = useGetStoreConfigQuery()
  const [updateShopItem] = useUpdateShopItemMutation()
  const [deleteShopItem] = useDeleteShopItemMutation()
  const [upsertStoreSale] = useUpsertStoreSaleMutation()
  const [upsertStoreConfig] = useUpsertStoreConfigMutation()

  // Drafts are local; they seed from the rows once the queries resolve
  // (the old loadAdminData re-seeded them on every load, and the queries
  // refetch through their own tags after a save). Mid-edit drafts do not
  // survive navigating away and back — accepted trade-off, same as the
  // other migrated features.
  const [shopDraft, setShopDraft] = useState<ShopDraft>(() => shopToDraft())
  const [saleDraft, setSaleDraft] = useState<SaleDraft>({
    id: null,
    label: "Store Sale",
    bonus_percent: "0",
    is_active: false,
    starts_at: "",
    ends_at: "",
  })
  const [storeConfigDraft, setStoreConfigDraft] = useState<StoreConfigDraft>({
    title: "Store",
    bg_image_url: "",
  })
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  // Non-blocking confirm dialog for the item delete. Separate hook
  // instance from any other section's.
  const {
    confirm,
    confirmUI,
  } = useConfirm()

  // The shop-items read is the section's live data; its failure surfaces
  // through the page-level banner (old: loadAdminData threw). A failed
  // query would otherwise fall back to its `= []` default and render as
  // genuinely-empty data.
  useEffect(() => {
    if (shopItemsError) onError(shopItemsError)
  }, [shopItemsError, onError])

  // Seed the sale/config drafts from their rows whenever the queries
  // resolve (including after a save refetch, like the old re-seed).
  useEffect(() => {
    if (sale) setSaleDraft(saleRowToDraft(sale))
  }, [sale])
  useEffect(() => {
    if (storeConfig) setStoreConfigDraft(storeConfigRowToDraft(storeConfig))
  }, [storeConfig])

  async function saveShop() {
    if (!canManage) return
    setPendingKey("shop")
    onBeforeSave()
    try {
      const payload: Database["public"]["Tables"]["shop_items"]["Insert"] = {
        id: shopDraft.id.trim(),
        kind: shopDraft.kind,
        display_name: shopDraft.display_name.trim(),
        description: shopDraft.description.trim(),
        image_url: emptyToNull(shopDraft.image_url),
        price_cents: numberOrNull(shopDraft.price_cents),
        price_coins: numberOrNull(shopDraft.price_coins),
        price_gems: numberOrNull(shopDraft.price_gems),
        apple_product_id: emptyToNull(shopDraft.apple_product_id),
        google_product_id: emptyToNull(shopDraft.google_product_id),
        contents: parseJson(shopDraft.contents, "Contents", "object"),
        visibility_rules: parseJson(shopDraft.visibility_rules, "Visibility rules", "object"),
        starts_at: shopDraft.starts_at ? new Date(shopDraft.starts_at).toISOString() : null,
        ends_at: shopDraft.ends_at ? new Date(shopDraft.ends_at).toISOString() : null,
        max_purchases_per_user: numberOrNull(shopDraft.max_purchases_per_user),
        is_enabled: shopDraft.is_enabled,
        exclude_from_sale: shopDraft.exclude_from_sale,
        sort_order: requiredNumber(shopDraft.sort_order, "Sort order"),
        updated_by: currentUserId,
      }
      await updateShopItem(payload).unwrap()
      setShopDraft(shopToDraft())
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function saveStoreSale() {
    if (!canManage) return
    setPendingKey("store-sale")
    onBeforeSave()
    try {
      const payload = {
        label: saleDraft.label.trim() || "Store Sale",
        bonus_percent: requiredNumber(saleDraft.bonus_percent, "Bonus %"),
        is_active: saleDraft.is_active,
        starts_at: saleDraft.starts_at ? new Date(saleDraft.starts_at).toISOString() : null,
        ends_at: saleDraft.ends_at ? new Date(saleDraft.ends_at).toISOString() : null,
      }
      await upsertStoreSale({
        payload,
        saleId: saleDraft.id,
      }).unwrap()
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function saveStoreConfig() {
    if (!canManage) return
    setPendingKey("store-config")
    onBeforeSave()
    try {
      const payload = {
        id: true,
        title: storeConfigDraft.title.trim() || "Store",
        bg_image_url: storeConfigDraft.bg_image_url.trim() || null,
      }
      await upsertStoreConfig(payload).unwrap()
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  async function deleteShop() {
    if (!canManage) return
    const id = shopDraft.id.trim()
    if (!id) return
    if (!(await confirm({
      title: `Delete shop item "${shopDraft.display_name.trim() || id}"?`,
      message: "It's removed from the store immediately. Past purchases are kept.",
      confirmLabel: "Delete",
      tone: "danger",
    }))) return
    setPendingKey("shop-delete")
    onBeforeSave()
    try {
      await deleteShopItem(id).unwrap()
      setShopDraft(shopToDraft())
    }
    catch (err) {
      onError(err)
    }
    finally {
      setPendingKey(null)
    }
  }

  return (<div className={styles.container}>
    {confirmUI}
    {/* Storefront appearance — the shop popup's header title + an
        optional blurred-themed background. Independent of the sale, so
        an operator can re-theme the shop (e.g. "Shop Sale!" + a themed
        background for a promo) with or without a running sale. */}
    <div className={styles.promoCard}>
      <h2 className={styles.promoTitle}>Storefront appearance</h2>
      <p className={styles.promoDesc}>
        Sets the shop popup’s title and an optional blurred background image. Use them to theme a promo — e.g.
        title “Shop Sale!” with an “American” background for a 4th-of-July sale. Leave the background empty
        for the default look.
      </p>
      <div className={styles.grid2}>
        <Field
          label="Shop title"
          value={storeConfigDraft.title}
          onChange={(title) => {
            setStoreConfigDraft((d) => ({
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
            setStoreConfigDraft((d) => ({
              ...d,
              bg_image_url,
            }))
          }}/>
      </div>
      <div className={styles.actionRow}>
        <PrimaryButton
          disabled={!canManage || pendingKey === "store-config"}
          onClick={saveStoreConfig}>Save appearance</PrimaryButton>
      </div>
    </div>
    {/* Store Sale — one global bonus added to every pack's coin/gem
            grants. Players see a "+X% EXTRA" badge + the boosted amount;
            the boost is applied server-side at purchase. */}
    <div className={styles.promoCard}>
      <h2 className={styles.promoTitle}>Store Sale</h2>
      <p className={styles.promoDesc}>
        Adds extra coins &amp; gems to every pack. Players see a “+{saleDraft.bonus_percent || "0"}% EXTRA”
        badge and the boosted amount; the boost is enforced server-side at purchase. Leave the dates blank for
        a manual on/off sale.
      </p>
      <div className={styles.grid2Fixed}>
        <Field
          label="Label"
          value={saleDraft.label}
          onChange={(label) => {
            setSaleDraft((d) => ({
              ...d,
              label,
            }))
          }}/>
        <Field
          label="Bonus %"
          value={saleDraft.bonus_percent}
          onChange={(bonus_percent) => {
            setSaleDraft((d) => ({
              ...d,
              bonus_percent,
            }))
          }}/>
        <Field
          label="Starts at (optional)"
          type="datetime-local"
          value={saleDraft.starts_at}
          onChange={(starts_at) => {
            setSaleDraft((d) => ({
              ...d,
              starts_at,
            }))
          }}/>
        <Field
          label="Ends at (optional)"
          type="datetime-local"
          value={saleDraft.ends_at}
          onChange={(ends_at) => {
            setSaleDraft((d) => ({
              ...d,
              ends_at,
            }))
          }}/>
      </div>
      <div className={styles.actionRowWrap}>
        <Toggle
          checked={saleDraft.is_active}
          label="Sale active"
          onChange={(is_active) => {
            setSaleDraft((d) => ({
              ...d,
              is_active,
            }))
          }}/>
        <PrimaryButton
          disabled={!canManage || pendingKey === "store-sale"}
          onClick={saveStoreSale}>Save sale</PrimaryButton>
      </div>
    </div>
    <div className={styles.mainGrid}>
      <ConfigTable
        rows={shopItems.map((row) => [row.display_name, row.kind, moneyFromCents(row.price_cents), row.is_enabled ? "Enabled" : "Disabled"])}
        title="Shop items"
        onRowClick={(index) => {
          setShopDraft(() => shopToDraft(shopItems[index]))
        }}/>
      <div className={styles.editCard}>
        <h2 className={styles.editTitle}>Edit shop item</h2>
        <div className={styles.grid2Fixed}>
          <Field
            label="Product id"
            value={shopDraft.id}
            onChange={(id) => {
              setShopDraft((d) => ({
                ...d,
                id,
              }))
            }}/>
          <label className={styles.fieldLabel}>
            Kind
            <select
              className={styles.select}
              value={shopDraft.kind}
              onChange={(event) => {
                setShopDraft((d) => ({
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
              setShopDraft((d) => ({
                ...d,
                display_name,
              }))
            }}/>
          <Field
            label="Sort order"
            value={shopDraft.sort_order}
            onChange={(sort_order) => {
              setShopDraft((d) => ({
                ...d,
                sort_order,
              }))
            }}/>
          <Field
            label="Price cents"
            value={shopDraft.price_cents}
            onChange={(price_cents) => {
              setShopDraft((d) => ({
                ...d,
                price_cents,
              }))
            }}/>
          <Field
            label="Price coins"
            value={shopDraft.price_coins}
            onChange={(price_coins) => {
              setShopDraft((d) => ({
                ...d,
                price_coins,
              }))
            }}/>
          <Field
            label="Price gems"
            value={shopDraft.price_gems}
            onChange={(price_gems) => {
              setShopDraft((d) => ({
                ...d,
                price_gems,
              }))
            }}/>
          <Field
            label="Max purchases"
            value={shopDraft.max_purchases_per_user}
            onChange={(max_purchases_per_user) => {
              setShopDraft((d) => ({
                ...d,
                max_purchases_per_user,
              }))
            }}/>
        </div>
        <div className={styles.stack3}>
          <Field
            label="Description"
            value={shopDraft.description}
            onChange={(description) => {
              setShopDraft((d) => ({
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
              setShopDraft((d) => ({
                ...d,
                image_url,
              }))
            }}/>
          <Field
            label="Apple product id"
            value={shopDraft.apple_product_id}
            onChange={(apple_product_id) => {
              setShopDraft((d) => ({
                ...d,
                apple_product_id,
              }))
            }}/>
          <Field
            label="Google product id"
            value={shopDraft.google_product_id}
            onChange={(google_product_id) => {
              setShopDraft((d) => ({
                ...d,
                google_product_id,
              }))
            }}/>
          {/* Structured grants & presentation (Phase B). These edit
                specific paths in the contents JSON below — which stays the
                source of truth — so any other keys are preserved. */}
          <div className={styles.grantsBox}>
            <div className={styles.grantsHeading}>Grants — what the
              buyer receives
            </div>
            <div className={styles.grid2Fixed}>
              <Field
                label="Coins"
                value={readGrant(shopDraft.contents, "coins")}
                onChange={(v) => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeGrantNumber(d.contents, "coins", v),
                  }))
                }}/>
              <Field
                label="Gems"
                value={readGrant(shopDraft.contents, "gems")}
                onChange={(v) => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeGrantNumber(d.contents, "gems", v),
                  }))
                }}/>
              <Field
                label="XP boost — days"
                value={readXpBoost(shopDraft.contents, "days")}
                onChange={(v) => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeXpBoost(d.contents, "days", v),
                  }))
                }}/>
              <Field
                label="XP boost — multiplier (2-10)"
                value={readXpBoost(shopDraft.contents, "multiplier")}
                onChange={(v) => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeXpBoost(d.contents, "multiplier", v),
                  }))
                }}/>
              <Field
                label="Board theme id (unlock)"
                value={readBoardGrant(shopDraft.contents)}
                onChange={(v) => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeBoardGrant(d.contents, v),
                  }))
                }}/>
            </div>

            <div className={styles.grantsHeading}>Presentation</div>
            <div className={styles.grid2Fixed}>
              <label className={styles.fieldLabel}>
                Placement
                <select
                  className={styles.select}
                  value={readPres(shopDraft.contents).placement === "featured" ? "featured" : "grid"}
                  onChange={(e) => {
                    setShopDraft((d) => ({
                      ...d,
                      contents: writePresField(d.contents, "placement", e.target.value === "featured" ? "featured" : ""),
                    }))
                  }}>
                  <option value="grid">Packs grid</option>
                  <option value="featured">Featured</option>
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Ribbon
                <select
                  className={styles.select}
                  value={(readPres(shopDraft.contents).ribbon as string) || "none"}
                  onChange={(e) => {
                    setShopDraft((d) => ({
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
            <div className={styles.grantsHeading}>Card header (title
              bar)
            </div>
            <div className={styles.headerBox}>
              <Field
                label="Header text (leave empty for no header bar)"
                value={readHeader(shopDraft.contents, "text")}
                onChange={(v) => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeHeader(d.contents, "text", v),
                  }))
                }}/>
              <div className={styles.colorRow}>
                <label className={styles.colorLabel}>
                  Background
                  <input
                    className={styles.colorInput}
                    type="color"
                    value={readHeader(shopDraft.contents, "bg") || "#d9a531"}
                    onChange={(e) => {
                      setShopDraft((d) => ({
                        ...d,
                        contents: writeHeader(d.contents, "bg", e.target.value),
                      }))
                    }}/>
                </label>
                <SecondaryButton
                  onClick={() => {
                    setShopDraft((d) => ({
                      ...d,
                      contents: writeHeader(d.contents, "bg", ""),
                    }))
                  }}>Default
                  gold</SecondaryButton>
                <label className={styles.colorLabel}>
                  Text color
                  <input
                    className={styles.colorInput}
                    type="color"
                    value={readHeader(shopDraft.contents, "fg") || "#fff7dc"}
                    onChange={(e) => {
                      setShopDraft((d) => ({
                        ...d,
                        contents: writeHeader(d.contents, "fg", e.target.value),
                      }))
                    }}/>
                </label>
                <SecondaryButton onClick={() => {
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeHeader(d.contents, "fg", ""),
                  }))
                }}>Default</SecondaryButton>
              </div>
            </div>

            {shopDraft.kind === "bundle" ? (<div className={styles.stack2}>
              <label className={styles.fieldLabel}>
                Headline currency (hero icon)
                <select
                  className={styles.select}
                  value={readPres(shopDraft.contents).headlineKind === "gems" ? "gems" : "coins"}
                  onChange={(e) => {
                    setShopDraft((d) => ({
                      ...d,
                      contents: writePresField(d.contents, "headlineKind", e.target.value),
                    }))
                  }}>
                  <option value="coins">Coins</option>
                  <option value="gems">Gems</option>
                </select>
              </label>
              <div className={styles.rewardChipsLabel}>Reward chips
              </div>
              {readRewards(shopDraft.contents).map((rw, i) => (<div
                key={`reward-${rw.kind}-${rw.label}`}
                className={styles.rewardRow}>
                <label
                  className={styles.rewardLabel}>
                  Icon
                  <select
                    className={styles.selectSmall}
                    value={rw.kind}
                    onChange={(e) => {
                      setShopDraft((d) => {
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
                <div className={styles.flex1}><Field
                  label="Label"
                  value={rw.label}
                  onChange={(v) => {
                    setShopDraft((d) => {
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
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeRewards(d.contents, readRewards(d.contents).filter((_, j) => j !== i)),
                  }))
                }}>Remove</SecondaryButton>
              </div>))}
              <SecondaryButton onClick={() => {
                setShopDraft((d) => ({
                  ...d,
                  contents: writeRewards(d.contents, [...readRewards(d.contents), {
                    kind: "coins",
                    label: "",
                  }]),
                }))
              }}>+ Add reward</SecondaryButton>
            </div>) : (<div className={styles.grid2Fixed}>
              <label className={styles.fieldLabel}>
                Headline icon
                <select
                  className={styles.select}
                  value={readHeadline(shopDraft.contents, "kind") || "coins"}
                  onChange={(e) => {
                    setShopDraft((d) => ({
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
                  setShopDraft((d) => ({
                    ...d,
                    contents: writeHeadline(d.contents, "label", v),
                  }))
                }}/>
              <Field
                label="Headline sub-label (e.g. x3 · 7 Days)"
                value={readHeadline(shopDraft.contents, "subLabel")}
                onChange={(v) => {
                  setShopDraft((d) => ({
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
              setShopDraft((d) => ({
                ...d,
                contents,
              }))
            }}/>
          <TextArea
            label="Visibility rules JSON object"
            value={shopDraft.visibility_rules}
            onChange={(visibility_rules) => {
              setShopDraft((d) => ({
                ...d,
                visibility_rules,
              }))
            }}/>
          <div className={styles.grid2Fixed}>
            <Field
              label="Starts at"
              type="datetime-local"
              value={shopDraft.starts_at}
              onChange={(starts_at) => {
                setShopDraft((d) => ({
                  ...d,
                  starts_at,
                }))
              }}/>
            <Field
              label="Ends at"
              type="datetime-local"
              value={shopDraft.ends_at}
              onChange={(ends_at) => {
                setShopDraft((d) => ({
                  ...d,
                  ends_at,
                }))
              }}/>
          </div>
          <Toggle
            checked={shopDraft.is_enabled}
            label="Enabled"
            onChange={(is_enabled) => {
              setShopDraft((d) => ({
                ...d,
                is_enabled,
              }))
            }}/>
          <Toggle
            checked={shopDraft.exclude_from_sale}
            label="Exclude from Store Sale (no bonus on this item)"
            onChange={(exclude_from_sale) => {
              setShopDraft((d) => ({
                ...d,
                exclude_from_sale,
              }))
            }}/>
          <div className={styles.buttonRow}>
            <PrimaryButton
              disabled={!canManage || pendingKey === "shop"}
              onClick={saveShop}>Save
              shop item</PrimaryButton>
            <SecondaryButton onClick={() => {
              setShopDraft(() => shopToDraft())
            }}>New</SecondaryButton>
            {/* Duplicate clones the loaded item into a NEW draft (suffixed id + "Copy of"
                  name, every other field carried over) so you only edit what differs. Saving
                  upserts the new id as a fresh row. Same load-an-existing-item guard as Delete. */}
            <SecondaryButton
              disabled={!canManage || !shopItems.some((item) => item.id === shopDraft.id)}
              onClick={() => {
                setShopDraft((d) => ({
                  ...d,
                  id: d.id ? `${d.id}-copy` : "",
                  display_name: d.display_name ? `Copy of ${d.display_name}` : d.display_name,
                }))
              }}>Duplicate</SecondaryButton>
            {/* Delete is enabled only when an existing item is loaded into the draft.
                  RLS (shop_items_delete_admin) gates it server-side; FKs are delete-safe. */}
            <DangerButton
              disabled={!canManage || !shopItems.some((item) => item.id === shopDraft.id) || pendingKey === "shop-delete"}
              onClick={deleteShop}>Delete</DangerButton>
          </div>
        </div>
      </div>
    </div>
  </div>)
}
