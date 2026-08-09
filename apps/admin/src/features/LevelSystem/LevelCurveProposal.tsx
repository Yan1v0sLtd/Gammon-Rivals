import {useMemo, useState} from "react"

import {formatUsdMicros} from "../../../../../packages/shared/src/currency"
import {useConfirm} from "../../components/useConfirm"

import type {LevelConfigInsert} from "./LevelSystemData"

// Default params for the proposed curve. These are the numbers we
// landed on after challenging the v2 spreadsheet curve: a 4-segment
// shape that plateaus at L81 and caps the level at 100. Active player
// (12 matches/day × 107.5 XP/match) reaches L100 in ~154 days vs the
// spreadsheet's ~2,965. Tweak any input below and the table re-renders;
// nothing is written to the DB until you press Apply.
/**
 * One gem-reward rule: "within levels [level_from, level_to], grant
 * `gems` gems at every Nth level" — where "every Nth" means levels
 * divisible by `every` (so every=10 hits L10, L20, L30, …). Ranges are
 * evaluated in order; the first rule whose range contains a level wins,
 * so they should be contiguous and non-overlapping for predictable
 * results. A level not covered by any rule grants 0 gems.
 */
type GemRule = {
  level_from: number,
  level_to: number,
  gems: number,
  every: number,
}

type CurveParams = {
  base_xp: number, // XP delta from L1 → L2
  growth_early: number, // multiplier per level inside onboarding
  end_early: number, // last level of onboarding segment
  growth_mid: number,
  end_mid: number,
  growth_late: number,
  end_late: number, // last level before plateau
  max_level: number, // last level emitted (>= end_late)
  matches_per_day: number, // for active-days display
  xp_per_match: number,
  avg_entry_fee_coins: number, // for $ sunk calc
  rebate_early_pct: number, // coin reward as % of sunk gold, L1..30
  rebate_mid_pct: number, // L31..60
  rebate_late_pct: number, // L61..max
  gem_rules: GemRule[], // range-based gem cadence (see GemRule)
  coin_value_micros: number, // USD micros per 1 coin (from currency_configs)
  gem_value_micros: number, // USD micros per 1 gem
}

const DEFAULT_PARAMS: CurveParams = {
  base_xp: 70,
  growth_early: 1.2,
  end_early: 10,
  growth_mid: 1.06,
  end_mid: 40,
  growth_late: 1.018,
  end_late: 80,
  max_level: 100,
  matches_per_day: 12,
  xp_per_match: 107.5,
  avg_entry_fee_coins: 4950,
  rebate_early_pct: 3.0,
  rebate_mid_pct: 2.5,
  rebate_late_pct: 2.0,
  gem_rules: [{
    level_from: 1,
    level_to: 50,
    gems: 5,
    every: 10,
  }, {
    level_from: 51,
    level_to: 150,
    gems: 10,
    every: 10,
  }],
  coin_value_micros: 100, // $0.0001 / coin
  gem_value_micros: 10000, // $0.01 / gem
}

/**
 * Resolve the gem grant for a single level from the rule list. Returns
 * the gems of the first rule whose [level_from, level_to] range
 * contains the level AND whose cadence the level hits (level % every
 * === 0). 0 if no rule covers it or the level isn't on cadence.
 */
function gemsForLevel(level: number, rules: readonly GemRule[]): number {
  for (const rule of rules) {
    if (level >= rule.level_from && level <= rule.level_to) {
      if (rule.every > 0 && level % rule.every === 0) return Math.max(0, rule.gems)
      return 0
    }
  }
  return 0
}

type ProposedRow = {
  level: number,
  per_lvl_xp: number, // XP delta from previous level (cosmetic — not stored)
  xp_required_cum: number, // CUMULATIVE — this is what goes into level_configs.xp_required
  active_days_to_reach: number,
  coins: number,
  gems: number,
  reward_usd_micros: number,
  sunk_usd_micros: number,
  rebate_pct: number,
}

function roundToStep(n: number, step: number): number {
  return n > 0 ? Math.round(n / step) * step : 0
}

/**
 * A curve cap is safe only as a finite positive integer. generateCurve
 * emits exactly one row per level 1..max_level, so a 0/negative cap
 * yields an empty proposal (whose apply would then delete every
 * level_configs row above cap 0) and a fractional cap yields a row set
 * that never reaches the advertised cap. Reject before confirm/apply.
 */
function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

// Pure generator — given params, returns the full set of proposed rows.
// Monotonic coin reward, range-based gem cadence, and a flat plateau
// past end_late.
function generateCurve(p: CurveParams): ProposedRow[] {
  const rows: ProposedRow[] = []
  let perLvl = 0
  let cum = 0
  let prevCoins = 0
  for (let L = 1; L <= p.max_level; L += 1) {
    if (L === 1) perLvl = 0; else if (L === 2) perLvl = p.base_xp; else if (L <= p.end_early) perLvl = Math.round(perLvl * p.growth_early); else if (L <= p.end_mid) perLvl = Math.round(perLvl * p.growth_mid); else if (L <= p.end_late) perLvl = Math.round(perLvl * p.growth_late)
    // else: plateau — perLvl stays
    cum += perLvl
    // Gold reward: rebate × sunk-gold-this-level, monotonic so leveling
    // never feels punishing even when the rebate rate steps down.
    const sunkThisLvl = (p.avg_entry_fee_coins * perLvl) / p.xp_per_match
    const rebatePct = L <= 30 ? p.rebate_early_pct : L <= 60 ? p.rebate_mid_pct : p.rebate_late_pct
    const coinsRaw = roundToStep(sunkThisLvl * (rebatePct / 100), 50)
    const coins = L === 1 ? 0 : Math.max(coinsRaw, prevCoins)
    prevCoins = coins
    const gems = gemsForLevel(L, p.gem_rules)
    const rewardUsdMicros = coins * p.coin_value_micros + gems * p.gem_value_micros
    const sunkUsdMicros = ((p.avg_entry_fee_coins * cum) / p.xp_per_match) * p.coin_value_micros
    const rebateActualPct = sunkUsdMicros > 0 ? (rewardUsdMicros / sunkUsdMicros) * 100 : 0
    rows.push({
      level: L,
      per_lvl_xp: perLvl,
      xp_required_cum: cum,
      active_days_to_reach: cum / (p.matches_per_day * p.xp_per_match),
      coins,
      gems,
      reward_usd_micros: rewardUsdMicros,
      sunk_usd_micros: sunkUsdMicros,
      rebate_pct: rebateActualPct,
    })
  }
  return rows
}

function NumField({
  label,
  value,
  step = "any",
  onChange,
}: {
  readonly label: string,
  readonly value: number,
  readonly step?: number | "any",
  readonly onChange: (n: number) => void,
}) {
  return (<label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
    {label}
    <input
      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition focus:border-amber-200/60"
      step={step}
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}/>
  </label>)
}

type ApplyCurveArgs = {
  rows: readonly LevelConfigInsert[],
  maxLevel: number,
}

type Props = {
  readonly canManage: boolean,
  readonly currentLevels: readonly {level: number, xp_required: number}[],
  readonly currentUserId: string | null,
  readonly coinValueMicros: number,
  readonly gemValueMicros: number,
  /** Feature-owned curve apply: batch upsert + delete-above-cap + recompute. Resolves to the promoted-player count. */
  readonly onApplyCurve: (args: ApplyCurveArgs) => Promise<number>,
  /** Feature-owned manual re-level pass. Resolves to the promoted-player count. */
  readonly onRecompute: () => Promise<number>,
}

// Renders the proposed-curve designer + preview table + apply button.
// The current level_configs rows are passed in so we can show a
// side-by-side cum-XP delta column without re-fetching. All DB writes
// are delegated to the feature-owned onApplyCurve / onRecompute
// callbacks — this component never touches Supabase directly.
export function LevelCurveProposal({
  canManage,
  currentLevels,
  currentUserId,
  coinValueMicros,
  gemValueMicros,
  onApplyCurve,
  onRecompute,
}: Props) {
  const [params, setParams] = useState<CurveParams>({
    ...DEFAULT_PARAMS,
    coin_value_micros: coinValueMicros,
    gem_value_micros: gemValueMicros,
  })
  const [applying, setApplying] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    confirm,
    confirmUI,
  } = useConfirm()
  const [message, setMessage] = useState<string | null>(null)

  const proposed = useMemo(() => generateCurve(params), [params])

  const updateGemRule = (index: number, patch: Partial<GemRule>) => {
    setParams((p) => ({
      ...p,
      gem_rules: p.gem_rules.map((r, i) => (i === index ? {...r, ...patch} : r)),
    }))
  }
  const addGemRule = () => {
    setParams((p) => {
      const last = p.gem_rules[p.gem_rules.length - 1]
      const nextFrom = last ? last.level_to + 1 : 1
      return {
        ...p,
        gem_rules: [...p.gem_rules, {
          level_from: nextFrom,
          level_to: nextFrom + 99,
          gems: 10,
          every: 10,
        }],
      }
    })
  }
  const removeGemRule = (index: number) => {
    setParams((p) => ({
      ...p,
      gem_rules: p.gem_rules.filter((_, i) => i !== index),
    }))
  }

  // Lookup map for current-curve cumulative XP at each level — shown in
  // the table as a delta so the operator can see at a glance how much
  // faster (or slower) the proposed curve is per level.
  const currentByLevel = useMemo(() => {
    const map = new Map<number, number>()
    for (const row of currentLevels) map.set(row.level, row.xp_required)
    return map
  }, [currentLevels])

  const totals = useMemo(() => {
    let coins = 0
    let gems = 0
    let rewardMicros = 0
    for (const r of proposed) {
      coins += r.coins
      gems += r.gems
      rewardMicros += r.reward_usd_micros
    }
    const sunkMicros = proposed[proposed.length - 1]?.sunk_usd_micros ?? 0
    const rebatePct = sunkMicros > 0 ? (rewardMicros / sunkMicros) * 100 : 0
    return {
      coins,
      gems,
      rewardMicros,
      sunkMicros,
      rebatePct,
    }
  }, [proposed])

  const apply = async () => {
    if (!canManage || applying) return
    if (!isPositiveInteger(params.max_level)) {
      setMessage(null)
      setError(`Max level must be a positive whole number. Got ${params.max_level} — nothing was applied.`)
      return
    }
    if (proposed.length === 0) {
      setMessage(null)
      setError("The proposed curve has no rows. Raise the max level — nothing was applied.")
      return
    }
    const confirmed = await confirm({
      title: "Apply this curve?",
      message: `This will REPLACE level_configs rows L1..L${params.max_level}.\n\n` + `Existing rows L${params.max_level + 1}+ will be deleted (cap).\n\n` + `Total: ${proposed.length} rows · ${totals.coins.toLocaleString()} coins + ${totals.gems} gems in rewards.\n\n` + "Players already at higher levels will keep their level (this only changes the XP gates).",
      confirmLabel: "Apply curve",
      tone: "danger",
    })
    if (!confirmed) return

    setApplying(true)
    setError(null)
    setMessage(null)
    try {
      const payload: LevelConfigInsert[] = proposed.map((r) => ({
        level: r.level,
        xp_required: r.xp_required_cum,
        reward_coins: r.coins,
        reward_gems: r.gems,
        reward_items: [],
        unlock_rules: {},
        is_enabled: true,
        updated_by: currentUserId,
      }))
      const promotedCount = await onApplyCurve({rows: payload, maxLevel: params.max_level})
      setMessage(`Applied. ${proposed.length} levels written · ${totals.coins.toLocaleString()} coins + ${totals.gems} gems · ${promotedCount ?? 0} players re-leveled.`)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setApplying(false)
    }
  }

  // Manual re-level pass for when the curve wasn't changed via Apply
  // (e.g. you edited individual level_configs rows by hand) but you
  // still want existing players snapped to the right level now rather
  // than on their next xp gain. Same promote-only, no-reward RPC the
  // Apply flow calls.
  const recompute = async () => {
    if (!canManage || recomputing) return
    setRecomputing(true)
    setError(null)
    setMessage(null)
    try {
      const promotedCount = await onRecompute()
      setMessage(`Re-leveled ${promotedCount ?? 0} players against the current curve.`)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setRecomputing(false)
    }
  }

  return (<div className="mt-6 rounded-xl border border-white/10 bg-white/[0.045] p-4">
    {confirmUI}
    <div className="flex items-baseline justify-between">
      <h2 className="text-lg font-black">Curve Proposal — Cap & Plateau</h2>
      <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">
        preview only — nothing written until Apply
      </span>
    </div>
    <p className="mt-1 text-xs text-white/55">
      4-segment curve with a flat plateau past level{" "}
      {params.end_late} and a hard cap at level {params.max_level}. Gem
      rewards follow the range rules below. Coin rewards scale with
      sunk gold (target rebate {params.rebate_early_pct}% →{" "}
      {params.rebate_late_pct}%) and are monotonic — leveling never
      decreases the payout.
    </p>

    {/* Params grid */}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <NumField
        label="Base XP (L1→L2)"
        value={params.base_xp}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            base_xp: n,
          }))
        }}/>
      <NumField
        label="Onboarding growth"
        step={0.01}
        value={params.growth_early}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            growth_early: n,
          }))
        }}/>
      <NumField
        label="Onboarding ends @ L"
        value={params.end_early}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            end_early: n,
          }))
        }}/>
      <div/>
      <NumField
        label="Growth rate"
        step={0.01}
        value={params.growth_mid}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            growth_mid: n,
          }))
        }}/>
      <NumField
        label="Growth ends @ L"
        value={params.end_mid}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            end_mid: n,
          }))
        }}/>
      <NumField
        label="Mid growth rate"
        step={0.001}
        value={params.growth_late}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            growth_late: n,
          }))
        }}/>
      <NumField
        label="Plateau starts @ L"
        value={params.end_late}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            end_late: n,
          }))
        }}/>
      <NumField
        label="Max level (hard cap)"
        value={params.max_level}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            max_level: n,
          }))
        }}/>
      <NumField
        label="Matches / day (target)"
        value={params.matches_per_day}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            matches_per_day: n,
          }))
        }}/>
      <NumField
        label="XP / match (avg)"
        step={0.1}
        value={params.xp_per_match}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            xp_per_match: n,
          }))
        }}/>
      <NumField
        label="Avg entry fee (coins)"
        value={params.avg_entry_fee_coins}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            avg_entry_fee_coins: n,
          }))
        }}/>
      <NumField
        label="Rebate % L1-30"
        step={0.1}
        value={params.rebate_early_pct}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            rebate_early_pct: n,
          }))
        }}/>
      <NumField
        label="Rebate % L31-60"
        step={0.1}
        value={params.rebate_mid_pct}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            rebate_mid_pct: n,
          }))
        }}/>
      <NumField
        label="Rebate % L61+"
        step={0.1}
        value={params.rebate_late_pct}
        onChange={(n) => {
          setParams((p) => ({
            ...p,
            rebate_late_pct: n,
          }))
        }}/>
    </div>

    {/* Gem reward rules — range-based cadence builder. Replaces the
          old free-text JSON milestone map. */}
    <div className="mt-4 rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">
          Gem reward rules
        </span>
        <span className="text-[10px] text-white/35">
          within each range, grant the gems at every Nth level (levels divisible by N)
        </span>
      </div>
      <p className="mt-1 text-[10px] text-white/40">
        e.g. From 1 To 50, 5 gems, every 10 → L10/20/30/40/50 each grant 5 gems.
        Ranges are read top-down; keep them contiguous and non-overlapping.
        A level not covered by any rule grants 0 gems.
      </p>
      <div className="mt-3 space-y-2">
        <div
          className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
          <span></span>
          <span>From level</span>
          <span>To level</span>
          <span>Gems</span>
          <span>Every N lvls</span>
          <span></span>
        </div>
        {params.gem_rules.length === 0 ? (<div
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-4 text-center text-[11px] text-white/40">
          No gem rules — every level grants 0 gems. Add a rule to start.
        </div>) : (params.gem_rules.map((rule, i) => (<div
          key={`gem-rule-${rule.level_from}-${rule.level_to}-${rule.gems}-${rule.every}`}
          className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2">
          <span className="text-center text-[10px] font-bold text-white/30">{i + 1}</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
            min="1"
            type="number"
            value={rule.level_from}
            onChange={(e) => {
              updateGemRule(i, {level_from: Number(e.target.value)})
            }}/>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
            min="1"
            type="number"
            value={rule.level_to}
            onChange={(e) => {
              updateGemRule(i, {level_to: Number(e.target.value)})
            }}/>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
            min="0"
            type="number"
            value={rule.gems}
            onChange={(e) => {
              updateGemRule(i, {gems: Number(e.target.value)})
            }}/>
          <input
            className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
            min="1"
            type="number"
            value={rule.every}
            onChange={(e) => {
              updateGemRule(i, {every: Number(e.target.value)})
            }}/>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-300/30 bg-rose-300/10 text-base font-black text-rose-200/80 transition hover:bg-rose-300/20"
            title="Remove rule"
            type="button"
            onClick={() => {
              removeGemRule(i)
            }}>
            ×
          </button>
        </div>)))}
        <button
          className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-white/30"
          type="button"
          onClick={addGemRule}>
          + Add gem rule
        </button>
      </div>
    </div>

    {/* Summary strip */}
    <div className="mt-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em]">
      <span className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-1 text-emerald-200">
        L{params.max_level} in {(proposed[proposed.length - 1]?.active_days_to_reach ?? 0).toFixed(0)} active days
      </span>
      <span className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1 text-white/70">
        Total coins: {totals.coins.toLocaleString()} ({formatUsdMicros(totals.coins * params.coin_value_micros)})
      </span>
      <span className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1 text-white/70">
        Total gems: {totals.gems} ({formatUsdMicros(totals.gems * params.gem_value_micros)})
      </span>
      <span className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1 text-white/70">
        Total reward $: {formatUsdMicros(totals.rewardMicros)}
      </span>
      <span className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1 text-white/70">
        $ sunk to L{params.max_level}: {formatUsdMicros(totals.sunkMicros)}
      </span>
      <span className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-amber-100">
        Overall rebate: {totals.rebatePct.toFixed(2)}%
      </span>
    </div>

    {/* Action row */}
    <div className="mt-4 flex items-center gap-3">
      <button
        className="rounded-lg border border-amber-200/40 bg-amber-200/15 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-amber-100 transition hover:bg-amber-200/25 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canManage || applying}
        type="button"
        onClick={() => void apply()}>
        {applying ? "Applying…" : `Apply curve to level_configs (${proposed.length} rows)`}
      </button>
      <button
        className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/70 transition hover:border-white/30"
        type="button"
        onClick={() => {
          setParams({
            ...DEFAULT_PARAMS,
            coin_value_micros: coinValueMicros,
            gem_value_micros: gemValueMicros,
          })
        }}>
        Reset to defaults
      </button>
      <button
        className="rounded-lg border border-sky-300/40 bg-sky-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canManage || recomputing}
        title="Snap every existing player's level to the CURRENT curve (promote-only, no rewards). Apply already does this automatically — use this after hand-editing level rows."
        type="button"
        onClick={() => void recompute()}>
        {recomputing ? "Re-leveling…" : "Re-level players now"}
      </button>
      {error ? (<span
        className="rounded-lg border border-rose-300/40 bg-rose-300/10 px-3 py-1 text-xs font-bold text-rose-100">
        {error}
      </span>) : null}
      {message ? (<span
        className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-100">
        {message}
      </span>) : null}
    </div>

    {/* Preview table */}
    <div className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-[#0c1626] text-[10px] uppercase tracking-[0.14em] text-white/45">
          <tr>
            <th className="px-3 py-2">L</th>
            <th className="px-3 py-2 text-right">XP req (cum)</th>
            <th className="px-3 py-2 text-right">Δ per lvl</th>
            <th className="px-3 py-2 text-right">vs current</th>
            <th className="px-3 py-2 text-right">Active days</th>
            <th className="px-3 py-2 text-right">Coins</th>
            <th className="px-3 py-2 text-right">Gems</th>
            <th className="px-3 py-2 text-right">$ reward</th>
            <th className="px-3 py-2 text-right">$ sunk</th>
            <th className="px-3 py-2 text-right">Rebate %</th>
          </tr>
        </thead>
        <tbody>
          {proposed.map((r) => {
            const cur = currentByLevel.get(r.level)
            const delta = cur != null ? r.xp_required_cum - cur : null
            return (<tr
              key={r.level}
              className="border-t border-white/5 text-white/70">
              <td className="px-3 py-1.5 font-mono">{r.level}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.xp_required_cum.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right font-mono text-white/45">{r.per_lvl_xp.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right font-mono">
                {delta == null ? (<span className="text-white/25">—</span>) : delta === 0 ? (
                  <span className="text-white/35">0</span>) : delta < 0 ? (
                  <span className="text-emerald-300/85">{delta.toLocaleString()}</span>) : (
                  <span className="text-rose-300/85">+{delta.toLocaleString()}</span>)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{r.active_days_to_reach.toFixed(1)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.coins.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.gems > 0 ? r.gems
                : <span className="text-white/25">—</span>}</td>
              <td
                className="px-3 py-1.5 text-right font-mono text-emerald-200/80">{formatUsdMicros(r.reward_usd_micros)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-white/55">{formatUsdMicros(r.sunk_usd_micros)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-amber-100/75">{r.rebate_pct.toFixed(2)}%</td>
            </tr>)
          })}
        </tbody>
      </table>
    </div>
    <p className="mt-2 text-[10px] normal-case tracking-normal text-white/40">
      <strong>vs current</strong> = proposed cumulative XP − current
      cumulative XP for the same level (green = proposed is easier, red
      = proposed is harder). Levels with no current row show "—".
    </p>
  </div>)
}
