import {useEffect, useState} from "react"

import styles from "./MissionsAdminShared.module.css"

/** A reward row shared by the template, chest and streak editors. */
export type RewardRow = {
  id?: string,
  mission_id?: string,
  milestone_id?: string,
  reward_kind: "currency" | "item",
  currency_code: string | null,
  item_table: string | null,
  item_id: string | null,
  amount: number,
  display_order: number,
}

/** A row of mission_type_config — the registry that binds a mission type to its
 *  progress metric, records whether that event is actually wired, and holds the
 *  per-type adaptive-controller coefficients used by personalized missions. */
export type MissionTypeConfig = {
  mission_type: string,
  metric_code: string,
  label: string,
  description: string | null,
  is_wired: boolean,
  supports_personalized: boolean,
  base_stretch: number,
  up_step: number,
  ease_after: number,
  ease_factor: number,
  floor_mult: number,
  cap_mult: number,
  reward_pct: number,
  floor_reward: number,
  round_to: number,
  baseline_window_days: number,
  goal_round_to: number,
  rollout_pct: number,
}

export function RewardBundleEditor({
  rows,
  onChange,
  disabled,
}: {
  readonly rows: readonly RewardRow[],
  readonly onChange: (rows: RewardRow[]) => void,
  readonly disabled?: boolean,
}) {
  const update = (i: number, patch: Partial<RewardRow>) => {
    const next = rows.map((r, idx) => idx === i ? {...r, ...patch} : r)
    onChange(next)
  }
  const remove = (i: number) => {
    onChange(rows.filter((_, idx) => idx !== i))
  }
  const add = () => {
    onChange([...rows, {
      reward_kind: "currency",
      currency_code: "coins",
      item_table: null,
      item_id: null,
      amount: 100,
      display_order: rows.length,
    }])
  }

  return (<div className={styles.bundleList}>
    {rows.map((r, i) => (<div
      key={`${r.reward_kind}-${r.currency_code ?? r.item_id ?? ""}-${r.amount}`}
      className={styles.bundleRow}>
      <select
        className={styles.bundleSelect}
        disabled={disabled}
        value={r.reward_kind}
        onChange={(e) => {
          update(i, {reward_kind: e.target.value as RewardRow["reward_kind"]})
        }}>
        <option value="currency">Currency</option>
        <option value="item">Item</option>
      </select>
      {r.reward_kind === "currency" ? (<>
        <select
          className={styles.bundleSelect}
          disabled={disabled}
          value={r.currency_code ?? "coins"}
          onChange={(e) => {
            update(i, {currency_code: e.target.value})
          }}>
          <option value="coins">coins</option>
          <option value="gems">gems</option>
          <option value="xp">xp</option>
        </select>
        <span className={styles.bundleDash}>—</span>
      </>) : (<>
        <input
          className={styles.bundleInput}
          disabled={disabled}
          placeholder="item_table"
          type="text"
          value={r.item_table ?? ""}
          onChange={(e) => {
            update(i, {item_table: e.target.value})
          }}/>
        <input
          className={styles.bundleInput}
          disabled={disabled}
          placeholder="item_id"
          type="text"
          value={r.item_id ?? ""}
          onChange={(e) => {
            update(i, {item_id: e.target.value})
          }}/>
      </>)}
      <input
        className={styles.bundleInput}
        disabled={disabled}
        type="number"
        value={r.amount}
        onChange={(e) => {
          update(i, {amount: Number(e.target.value)})
        }}/>
      {!disabled && (<button
        className={styles.bundleRemove}
        type="button"
        onClick={() => {
          remove(i)
        }}>
        ✕
      </button>)}
    </div>))}
    {!disabled && (<button
      className={styles.addReward}
      type="button"
      onClick={add}>
      + Add reward
    </button>)}
  </div>)
}

export function Field({
  label,
  children,
  wide = false,
}: {
  readonly label: string,
  readonly children: React.ReactNode,
  readonly wide?: boolean,
}) {
  return (<label className={styles.field + (wide ? " " + styles.fieldWide : "")}>
    <span className={styles.fieldLabel}>{label}</span>
    {children}
  </label>)
}

export function JsonField({
  value,
  onChange,
  disabled,
}: {
  readonly value: Record<string, unknown>,
  readonly onChange: (v: Record<string, unknown>) => void,
  readonly disabled?: boolean,
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setText(JSON.stringify(value, null, 2))
  }, [value])

  return (<div>
    <textarea
      className={styles.jsonInput}
      disabled={disabled}
      rows={3}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        try {
          const parsed = JSON.parse(e.target.value || "{}")
          setErr(null)
          onChange(parsed)
        }
        catch (er) {
          setErr((er as Error).message)
        }
      }}/>
    {err && <div className={styles.jsonError}>{err}</div>}
  </div>)
}
