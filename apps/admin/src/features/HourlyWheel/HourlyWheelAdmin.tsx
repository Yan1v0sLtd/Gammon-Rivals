import {useCallback, useEffect, useMemo, useState} from "react"

import {buildCurrencyRateMap, formatUsdMicros, usdMicrosFor} from "../../../../../packages/shared/src/currency.ts"
import {ImageField} from "../../components/ImageField.tsx"
import {useGetCurrenciesQuery} from "../Currencies/CurrenciesApi"

import styles from "./HourlyWheelAdmin.module.css"
import {
  useGetWheelConfigQuery, useGetWheelSlotsQuery, useUpsertWheelConfigMutation, useUpsertWheelSlotMutation,
} from "./HourlyWheelApi"
import {WHEEL_CONFIG_ID, type WheelConfigRow, type WheelSlotRow} from "./HourlyWheelData"

/** The reward types spin_wheel knows how to credit. Adding a new
 *  one is a one-line CASE branch in the RPC + a new option here.
 *  Keeping it small for now — coins / gems / XP cover every slot
 *  in the default seed. */
const REWARD_TYPES = ["coins", "gems", "xp"] as const
type RewardType = (typeof REWARD_TYPES)[number]

/** Accent slugs the WheelModal recognises (see ACCENT_PAIRS).
 *  Constraining the BO to this list avoids an operator typo
 *  shipping a wedge with no colour. */
const ACCENT_COLORS = ["gold", "purple", "red", "green", "blue", "orange"] as const

const SLOT_KEYS = ["slot-0", "slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6", "slot-7", "slot-8", "slot-9"] as const

type SlotDraft = {
  primary_reward_type: RewardType,
  primary_reward_amount: string,
  primary_reward_icon_url: string,
  /** Empty string means "no secondary". UI exposes a toggle that
   *  flips this between '' and a real type. */
  secondary_reward_type: RewardType | "",
  secondary_reward_amount: string,
  secondary_reward_icon_url: string,
  /** Chance as a percentage string with up to 2 decimal places.
   *  Converted to integer basis points (0..10000) on save. */
  chance_percent: string,
  label: string,
  accent_color: (typeof ACCENT_COLORS)[number],
  is_enabled: boolean,
}

type ConfigDraft = {
  cooldown_seconds: string,
  is_enabled: boolean,
}

type Props = {
  readonly canManage: boolean,
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */

/* -------------------------------------------------------------------------- */

/** Convert a stored slot row into the BO draft shape. */
function slotToDraft(row: WheelSlotRow | undefined): SlotDraft {
  return {
    primary_reward_type: (row?.primary_reward_type as RewardType) ?? "coins",
    primary_reward_amount: row?.primary_reward_amount?.toString() ?? "0",
    primary_reward_icon_url: row?.primary_reward_icon_url ?? "",
    secondary_reward_type: (row?.secondary_reward_type as RewardType | null) ?? "",
    secondary_reward_amount: row?.secondary_reward_amount?.toString() ?? "0",
    secondary_reward_icon_url: row?.secondary_reward_icon_url ?? "",
    chance_percent: row ? (row.chance_basis_points / 100).toFixed(2) : "0",
    label: row?.label ?? "",
    accent_color: (row?.accent_color as (typeof ACCENT_COLORS)[number]) ?? "gold",
    is_enabled: row?.is_enabled ?? true,
  }
}

function configToDraft(row: WheelConfigRow | null): ConfigDraft {
  return {
    cooldown_seconds: row?.cooldown_seconds?.toString() ?? "3600",
    is_enabled: row?.is_enabled ?? true,
  }
}

/** Default icon URL per reward type so operators don't have to
 *  re-upload the standard coin / gem / XP glyph for every slot. */
function defaultIconFor(type: RewardType): string {
  switch (type) {
    case "coins":
      return "/lobby/icons/gold-coin.webp"
    case "gems":
      return "/lobby/icons/gem.webp"
    case "xp":
      // No webp asset exists; the wheel renders the inline hex
      // for type === 'xp' regardless of icon_url. Storing an empty
      // string keeps the DB honest.
      return ""
  }
}

/** Parse a percent string like "25.5" into basis points (2550).
 *  Throws on values outside 0..100 or with too many decimals so
 *  the operator gets a clear error before the upsert fires. */
function percentToBasisPoints(percent: string, fieldLabel: string): number {
  const trimmed = percent.trim()
  if (!trimmed) throw new Error(`${fieldLabel} is required.`)
  const n = Number(trimmed)
  if (!Number.isFinite(n)) throw new Error(`${fieldLabel} must be a number.`)
  if (n < 0 || n > 100) {
    throw new Error(`${fieldLabel} must be between 0 and 100.`)
  }
  // Round to nearest basis point so 25.555 doesn't silently drift.
  return Math.round(n * 100)
}

function requireNonNegInt(value: string, fieldLabel: string): number {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${fieldLabel} is required.`)
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldLabel} must be a non-negative integer.`)
  }
  return n
}

/** Format basis points as a percent string with 2 decimals. */
function formatPercent(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`
}

/* -------------------------------------------------------------------------- */
/* Tiny presentational helpers (mirrors Admin.tsx's Field / Toggle styling)   */

/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  readonly label: string,
  readonly value: string,
  readonly onChange: (value: string) => void,
  readonly disabled?: boolean,
  readonly placeholder?: string,
}) {
  return (<label className={styles.fieldLabel}>
    {label}
    <input
      className={styles.fieldInput}
      disabled={disabled}
      placeholder={placeholder}
      type="text"
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}/>
  </label>)
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  readonly label: string,
  readonly value: T,
  readonly options: readonly T[],
  readonly onChange: (value: T) => void,
  readonly disabled?: boolean,
}) {
  return (<label className={styles.fieldLabel}>
    {label}
    <select
      className={styles.fieldInput}
      disabled={disabled}
      value={value}
      onChange={(event) => {
        onChange(event.target.value as T)
      }}>
      {options.map((opt) => (<option
        key={opt}
        value={opt}>
        {opt}
      </option>))}
    </select>
  </label>)
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string,
  readonly checked: boolean,
  readonly onChange: (checked: boolean) => void,
  readonly disabled?: boolean,
}) {
  return (<label className={styles.toggleRow}>
    <input
      checked={checked}
      className={styles.toggleCheckbox}
      disabled={disabled}
      type="checkbox"
      onChange={(event) => {
        onChange(event.target.checked)
      }}/>
    <span>{label}</span>
  </label>)
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  readonly children: React.ReactNode,
  readonly onClick: () => void,
  readonly disabled?: boolean,
}) {
  return (<button
    className={styles.primaryButton}
    disabled={disabled}
    type="button"
    onClick={onClick}>
    {children}
  </button>)
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  readonly children: React.ReactNode,
  readonly onClick: () => void,
  readonly disabled?: boolean,
}) {
  return (<button
    className={styles.secondaryButton}
    disabled={disabled}
    type="button"
    onClick={onClick}>
    {children}
  </button>)
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */

/* -------------------------------------------------------------------------- */

export function HourlyWheelAdmin({canManage}: Props) {
  const {
    data: config = null,
    isLoading: configLoading,
    error: configError,
  } = useGetWheelConfigQuery()
  const {
    data: slots = [],
    isLoading: slotsLoading,
    error: slotsError,
  } = useGetWheelSlotsQuery()
  const {
    data: currencies = [],
    isLoading: currenciesLoading,
    error: currenciesError,
  } = useGetCurrenciesQuery()
  const [upsertWheelConfig, {isLoading: savingConfig}] = useUpsertWheelConfigMutation()
  const [upsertWheelSlot, {isLoading: savingSlot}] = useUpsertWheelSlotMutation()

  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(() => configToDraft(null))
  const [slotDraft, setSlotDraft] = useState<SlotDraft>(() => slotToDraft(undefined))
  const [error, setError] = useState<string | null>(null)

  const setErrFromUnknown = useCallback((err: unknown) => {
    if (err instanceof Error) setError(err.message); else if (err && typeof err === "object" && "message" in err) {
      setError(String((err).message))
    }
    else setError(String(err))
  }, [])

  // Surface any fetch failure through the component's error presentation.
  useEffect(() => {
    if (configError) setErrFromUnknown(configError)
  }, [configError, setErrFromUnknown])
  useEffect(() => {
    if (slotsError) setErrFromUnknown(slotsError)
  }, [slotsError, setErrFromUnknown])
  useEffect(() => {
    if (currenciesError) setErrFromUnknown(currenciesError)
  }, [currenciesError, setErrFromUnknown])

  // Re-sync the config draft whenever the server config changes (initial
  // load or after a save refetch). Drafts stay local; only server data
  // lives in RTK Query.
  useEffect(() => {
    setConfigDraft(configToDraft(config))
  }, [config])

  // Re-sync the slot draft whenever the user picks a different slot,
  // or when the underlying row changes (e.g. after a save).
  useEffect(() => {
    const row = slots.find((s) => s.slot_index === selectedIndex)
    setSlotDraft(slotToDraft(row))
  }, [selectedIndex, slots])

  /** Sum of chance_basis_points across ENABLED slots, in real
   *  basis points (max 10000). Disabled slots contribute zero —
   *  matches the server's sum check in spin_wheel. */
  const totalBasisPoints = useMemo(() => {
    return slots.reduce((acc, s) => (s.is_enabled ? acc + s.chance_basis_points : acc), 0)
  }, [slots])

  const totalIsValid = totalBasisPoints === 10000

  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies])

  /** Raw USD value of a slot's combined reward (primary + secondary) in
   *  micros. Doesn't account for chance — that's the EV-per-spin
   *  footer's job. XP and any currency not in currency_configs return 0
   *  by design (we don't price progression metrics). */
  const slotValueMicros = useCallback((row: WheelSlotRow | undefined): number => {
    if (!row) return 0
    return (usdMicrosFor(rateMap, row.primary_reward_type, row.primary_reward_amount) + usdMicrosFor(rateMap, row.secondary_reward_type, row.secondary_reward_amount))
  }, [rateMap])

  /** Probability-weighted EV per spin in micros. Sum over ENABLED slots
   *  of (slot_value × chance_basis_points / 10000). This is the number
   *  the operator should tune the wheel against — it's the expected $
   *  the house pays out every time a player spins. */
  const evPerSpinMicros = useMemo(() => {
    return slots.reduce((acc, row) => {
      if (!row.is_enabled) return acc
      return acc + (slotValueMicros(row) * row.chance_basis_points) / 10000
    }, 0)
  }, [slots, slotValueMicros])

  const saveConfig = async () => {
    if (!canManage) return
    setError(null)
    try {
      const cooldown = requireNonNegInt(configDraft.cooldown_seconds, "Cooldown seconds")
      if (cooldown < 300 || cooldown > 604800) {
        throw new Error("Cooldown must be between 300 (5 min) and 604800 (7 d) seconds.")
      }
      await upsertWheelConfig({
        id: WHEEL_CONFIG_ID,
        display_name: config?.display_name ?? "Hourly Bonus",
        cooldown_seconds: cooldown,
        is_enabled: configDraft.is_enabled,
      }).unwrap()
    }
    catch (err) {
      setErrFromUnknown(err)
    }
  }

  const saveSlot = async () => {
    if (!canManage) return
    setError(null)
    try {
      const primaryAmount = requireNonNegInt(slotDraft.primary_reward_amount, "Primary reward amount")
      const chanceBp = percentToBasisPoints(slotDraft.chance_percent, "Chance %")
      const hasSecondary = slotDraft.secondary_reward_type !== ""
      const secondaryAmount = hasSecondary ? requireNonNegInt(slotDraft.secondary_reward_amount, "Secondary reward amount") : null

      await upsertWheelSlot({
        config_id: WHEEL_CONFIG_ID,
        slot_index: selectedIndex,
        primary_reward_type: slotDraft.primary_reward_type,
        primary_reward_amount: primaryAmount,
        primary_reward_icon_url: slotDraft.primary_reward_icon_url || null,
        secondary_reward_type: hasSecondary ? slotDraft.secondary_reward_type : null,
        secondary_reward_amount: secondaryAmount,
        secondary_reward_icon_url: hasSecondary && slotDraft.secondary_reward_icon_url ? slotDraft.secondary_reward_icon_url : null,
        chance_basis_points: chanceBp,
        label: slotDraft.label || null,
        accent_color: slotDraft.accent_color,
        is_enabled: slotDraft.is_enabled,
      }).unwrap()
    }
    catch (err) {
      setErrFromUnknown(err)
    }
  }

  // When the operator changes the reward TYPE on either reward, swap
  // the icon_url over to that type's default ONLY when the existing
  // url is empty or matches another type's default. Custom uploads
  // (a public URL the operator pasted) are preserved.
  const isStockIcon = (url: string): boolean => {
    return (url === "" || url === "/lobby/icons/gold-coin.webp" || url === "/lobby/icons/gem.webp")
  }

  const setPrimaryType = (next: RewardType) => {
    setSlotDraft((d) => ({
      ...d,
      primary_reward_type: next,
      primary_reward_icon_url: isStockIcon(d.primary_reward_icon_url) ? defaultIconFor(next) : d.primary_reward_icon_url,
    }))
  }

  const setSecondaryType = (next: RewardType | "") => {
    setSlotDraft((d) => {
      if (next === "") {
        return {
          ...d,
          secondary_reward_type: "",
          secondary_reward_amount: "0",
          secondary_reward_icon_url: "",
        }
      }
      return {
        ...d,
        secondary_reward_type: next,
        secondary_reward_icon_url: isStockIcon(d.secondary_reward_icon_url) ? defaultIconFor(next) : d.secondary_reward_icon_url,
      }
    })
  }

  const hasSecondary = slotDraft.secondary_reward_type !== ""

  const loading = configLoading || slotsLoading || currenciesLoading

  if (loading) {
    return (<div className={styles.loadingCard}>
      Loading wheel configuration…
    </div>)
  }

  return (<div className={styles.layout}>
    {/* ============================================================
            Header: config + live total
         ============================================================ */}
    <div className={styles.panel}>
      <div className={styles.configRow}>
        <div className={styles.cooldownBlock}>
          <Field
            disabled={!canManage}
            label="Cooldown (sec)"
            value={configDraft.cooldown_seconds}
            onChange={(cooldown_seconds) => {
              setConfigDraft((d) => ({
                ...d,
                cooldown_seconds,
              }))
            }}/>
          <div className={styles.cooldownHint}>
            Range: 300 (5 min) – 604800 (7 d).
          </div>
        </div>
        <div>
          <Toggle
            checked={configDraft.is_enabled}
            disabled={!canManage}
            label="Wheel enabled"
            onChange={(is_enabled) => {
              setConfigDraft((d) => ({
                ...d,
                is_enabled,
              }))
            }}/>
        </div>
        <div className={styles.spacer}/>
        <div className={styles.totalBlock}>
          <div className={`${styles.total} ${totalIsValid ? styles.totalValid : styles.totalInvalid}`}>
            Total: {formatPercent(totalBasisPoints)}
          </div>
          <div className={styles.totalHint}>
            {totalIsValid ? "Wheel will spin normally." : "Must equal 100.00% — wheel will fail with wheel_misconfigured."}
          </div>
        </div>
        <PrimaryButton
          disabled={!canManage || savingConfig}
          onClick={() => void saveConfig()}>
          Save config
        </PrimaryButton>
      </div>
    </div>

    {error ? (<div className={styles.errorBox}>
      {error}
    </div>) : null}

    {/* ============================================================
            Slots: list (left) + editor (right)
         ============================================================ */}
    <div className={styles.mainGrid}>
      {/* Slot list */}
      <div className={styles.panel}>
        <h2 className={styles.sectionTitle}>Slots</h2>
        <p className={styles.sectionDesc}>
          10 slots, fixed order. Click a row to edit. Disabled slots
          are skipped by spin_wheel and don't count toward the
          100.00% total.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>#</th>
                <th className={styles.th}>Reward</th>
                <th className={styles.th}>Label</th>
                <th className={styles.th}>Accent</th>
                <th className={styles.thRight}>Chance</th>
                <th className={styles.thRight}>$ Value</th>
              </tr>
            </thead>
            <tbody>
              {SLOT_KEYS.map((slotKey, i) => {
                const row = slots.find((s) => s.slot_index === i)
                const isSelected = i === selectedIndex
                const rowMicros = slotValueMicros(row)
                return (<tr
                  key={slotKey}
                  className={`${styles.row} ${isSelected ? styles.rowSelected : ""} ${row?.is_enabled === false ? styles.rowDisabled : ""}`}
                  onClick={() => {
                    setSelectedIndex(i)
                  }}>
                  <td className={styles.tdMono}>{i}</td>
                  <td className={styles.td}>
                    {row ? (<>
                      {row.primary_reward_amount}{" "}
                      {row.primary_reward_type}
                      {row.secondary_reward_type ? (<span className={styles.secondaryText}>
                        {" "}
                        + {row.secondary_reward_amount}{" "}
                        {row.secondary_reward_type}
                      </span>) : null}
                    </>) : (<span className={styles.emptyText}>empty</span>)}
                  </td>
                  <td className={styles.tdLabel}>
                    {row?.label ?? <span className={styles.emptyText}>—</span>}
                  </td>
                  <td className={styles.tdAccent}>
                    {row?.accent_color ?? "—"}
                  </td>
                  <td className={styles.tdChance}>
                    {row ? formatPercent(row.chance_basis_points) : "0.00%"}
                  </td>
                  <td className={styles.tdValue}>
                    {row ? formatUsdMicros(rowMicros) : "—"}
                  </td>
                </tr>)
              })}
            </tbody>
            <tfoot className={styles.tfoot}>
              <tr className={styles.tfootRow}>
                <td
                  className={styles.tfootLabel}
                  colSpan={4}>
                  EV per spin
                </td>
                <td className={styles.tfootChance}>
                  {formatPercent(totalBasisPoints)}
                </td>
                <td className={styles.tfootValue}>
                  {formatUsdMicros(evPerSpinMicros, {precision: 4})}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className={styles.footnote}>
          $ Value is the raw worth of each slot's reward (primary +
          secondary) at the rates configured in the Currencies section.
          XP and any unpriced currency contribute $0. EV per spin is the
          probability-weighted average: Σ (slot value × chance) over
          enabled slots — the expected $ paid out per spin.
        </p>
      </div>

      {/* Slot editor */}
      <div className={styles.panel}>
        <h2 className={styles.sectionTitle}>Edit slot #{selectedIndex}</h2>
        <p className={styles.sectionDesc}>
          Per-slot save. Label is shown in the spin RPC's response
          (used in the wallet_transactions ledger note) but does NOT
          appear on the wedge itself — the wedge always shows icon +
          amount stacked radially.
        </p>

        {/* Top row: label / accent / chance / enabled */}
        <div className={styles.topGrid}>
          <Field
            disabled={!canManage}
            label="Label (optional)"
            placeholder="e.g. JACKPOT"
            value={slotDraft.label}
            onChange={(label) => {
              setSlotDraft((d) => ({
                ...d,
                label,
              }))
            }}/>
          <Select
            disabled={!canManage}
            label="Accent colour"
            options={ACCENT_COLORS}
            value={slotDraft.accent_color}
            onChange={(accent_color) => {
              setSlotDraft((d) => ({
                ...d,
                accent_color,
              }))
            }}/>
          <Field
            disabled={!canManage}
            label="Chance %"
            placeholder="0.00"
            value={slotDraft.chance_percent}
            onChange={(chance_percent) => {
              setSlotDraft((d) => ({
                ...d,
                chance_percent,
              }))
            }}/>
          <div className={styles.toggleWrap}>
            <Toggle
              checked={slotDraft.is_enabled}
              disabled={!canManage}
              label="Slot enabled"
              onChange={(is_enabled) => {
                setSlotDraft((d) => ({
                  ...d,
                  is_enabled,
                }))
              }}/>
          </div>
        </div>

        {/* Primary reward */}
        <div className={styles.rewardBox}>
          <div className={styles.boxTitle}>
            Primary reward
          </div>
          <div className={styles.boxGrid}>
            <Select
              disabled={!canManage}
              label="Type"
              options={REWARD_TYPES}
              value={slotDraft.primary_reward_type}
              onChange={setPrimaryType}/>
            <Field
              disabled={!canManage}
              label="Amount"
              value={slotDraft.primary_reward_amount}
              onChange={(primary_reward_amount) => {
                setSlotDraft((d) => ({
                  ...d,
                  primary_reward_amount,
                }))
              }}/>
          </div>
          <div className={styles.mt3}>
            <ImageField
              disabled={!canManage}
              folder="wheel"
              kind={`slot-${selectedIndex}-primary`}
              label="Icon"
              value={slotDraft.primary_reward_icon_url}
              onChange={(primary_reward_icon_url) => {
                setSlotDraft((d) => ({
                  ...d,
                  primary_reward_icon_url,
                }))
              }}/>
            {slotDraft.primary_reward_type === "xp" ? (<div className={styles.xpNote}>
              Note: XP slots always render the inline hex glyph on
              the wheel regardless of icon_url — no XP asset needs
              to be uploaded.
            </div>) : null}
          </div>
        </div>

        {/* Secondary reward (combo slot) */}
        <div className={styles.rewardBox}>
          <div className={styles.secondaryHeader}>
            <div className={styles.boxTitle}>
              Secondary reward {hasSecondary ? "" : "(optional)"}
            </div>
            {hasSecondary ? (<button
              className={styles.removeButton}
              disabled={!canManage}
              type="button"
              onClick={() => {
                setSecondaryType("")
              }}>
              Remove
            </button>) : (<button
              className={styles.addButton}
              disabled={!canManage}
              type="button"
              onClick={() => {
                setSecondaryType("coins")
              }}>
              Add second reward
            </button>)}
          </div>
          {hasSecondary ? (<>
            <div className={styles.boxGrid}>
              <Select
                disabled={!canManage}
                label="Type"
                options={REWARD_TYPES}
                value={slotDraft.secondary_reward_type as RewardType}
                onChange={(t) => {
                  setSecondaryType(t)
                }}/>
              <Field
                disabled={!canManage}
                label="Amount"
                value={slotDraft.secondary_reward_amount}
                onChange={(secondary_reward_amount) => {
                  setSlotDraft((d) => ({
                    ...d,
                    secondary_reward_amount,
                  }))
                }}/>
            </div>
            <div className={styles.mt3}>
              <ImageField
                disabled={!canManage}
                folder="wheel"
                kind={`slot-${selectedIndex}-secondary`}
                label="Icon"
                value={slotDraft.secondary_reward_icon_url}
                onChange={(secondary_reward_icon_url) => {
                  setSlotDraft((d) => ({
                    ...d,
                    secondary_reward_icon_url,
                  }))
                }}/>
            </div>
          </>) : null}
        </div>

        {/* Save / reset */}
        <div className={styles.saveRow}>
          <PrimaryButton
            disabled={!canManage || savingSlot}
            onClick={() => void saveSlot()}>
            Save slot #{selectedIndex}
          </PrimaryButton>
          <SecondaryButton
            onClick={() => {
              const row = slots.find((s) => s.slot_index === selectedIndex)
              setSlotDraft(slotToDraft(row))
            }}>
            Discard edits
          </SecondaryButton>
        </div>
      </div>
    </div>
  </div>)
}
