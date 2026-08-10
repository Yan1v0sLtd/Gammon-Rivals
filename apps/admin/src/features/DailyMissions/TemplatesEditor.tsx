import {useEffect, useMemo, useRef, useState} from "react"

import {extractErrorMessage} from "../../../../../packages/shared/src/errors.ts"
import {ImageField} from "../../components/ImageField.tsx"

import {
  useDeleteMissionTemplateMutation,
  useGetMissionRewardsQuery,
  useGetMissionTemplatesQuery,
  useGetMissionTypeConfigsQuery,
  useSaveMissionTemplateMutation,
} from "./DailyMissionsApi"
import type {
  MissionRewardDraft,
  MissionRewardRow,
  MissionTemplateInsert,
  MissionTemplateRow,
  MissionTypeConfigRow,
} from "./DailyMissionsData"
import {Field, JsonField, RewardBundleEditor} from "./MissionsAdminShared"
import type {MissionTypeConfig, RewardRow} from "./MissionsAdminShared"

type MissionTemplate = {
  id: string,
  mission_type: string,
  metric_code: string,
  rarity: "common" | "rare" | "epic",
  resolution_mode: "fixed" | "stretch" | "personalized",
  goal_value: number | null,
  stretch_factor: number | null,
  goal_min: number,
  goal_max: number,
  eligibility: Record<string, unknown>,
  params: Record<string, unknown>,
  mission_points: number,
  period: "daily" | "weekly",
  title: string,
  subtitle: string | null,
  icon_url: string | null,
  enabled: boolean,
  reward_mode: "manual" | "cashback",
  cashback_pct: number | null,
}

// Per-tier entry fee + target RTP, mirrored from table_configs for the BO
// cashback PREVIEW only (the server recomputes authoritatively at assignment via
// mp_cashback_reward). Keep loosely in sync with table_configs.
const TIER_INFO: Record<string, {fee: number, rtp: number, name: string}> = {
  beginner: {
    fee: 1000,
    rtp: 90,
    name: "Beginner",
  },
  advanced: {
    fee: 3000,
    rtp: 87,
    name: "Advanced",
  },
  pro: {
    fee: 10000,
    rtp: 85,
    name: "Pro",
  },
  expert: {
    fee: 30000,
    rtp: 82,
    name: "Expert",
  },
  "grand-master": {
    fee: 100000,
    rtp: 80,
    name: "Grand Master",
  },
}

/** Estimate the cashback coin reward for the editor preview; mirrors the
 *  server's mp_cashback_reward(). Returns null when there's nothing to show. */
function previewCashback(d: MissionTemplate) {
  const pct = d.cashback_pct ?? 0
  if (pct <= 0) return null
  const goal = d.resolution_mode === "fixed" ? (d.goal_value ?? 0) : d.goal_min
  if (goal <= 0) return null
  const tierId = (d.params?.difficulty_id as string | undefined) ?? ""
  const tier = TIER_INFO[tierId]
  const isWager = d.metric_code === "coins_wagered_per_day"
  if (!isWager && !tier) return {
    reward: 0,
    goal,
    investment: 0,
    tier: null as string | null,
    needsTier: true,
  }
  const edge = 1 - (tier?.rtp ?? 90) / 100
  const investment = isWager ? goal : goal * (tier?.fee ?? 0)
  // Round UP to the next 100 (matches mp_cashback_reward server-side).
  const reward = Math.ceil((pct * investment * edge) / 100) * 100
  return {
    reward,
    goal,
    investment,
    tier: (tier?.name ?? null) as string | null,
    needsTier: false,
  }
}

export function TemplatesEditor({canManage}: {readonly canManage: boolean}) {
  const {
    data: templatesQuery = [],
    error: templatesError,
    isLoading: templatesLoading,
  } = useGetMissionTemplatesQuery()
  const {
    data: typesQuery = [],
    error: typesError,
    isLoading: typesLoading,
  } = useGetMissionTypeConfigsQuery()
  const {
    data: rewardsQuery = [],
    error: rewardsError,
    isLoading: rewardsLoading,
  } = useGetMissionRewardsQuery()

  const [saveTemplate] = useSaveMissionTemplateMutation()
  const [deleteTemplate] = useDeleteMissionTemplateMutation()

  // Local mirrors of the server snapshots. The RTK Query cache is the
  // source of truth; these lists exist only because the render path was
  // built against local arrays. Each mirror is rebuilt when the query data
  // reference changes (initial load, or after a DailyMissions tag
  // invalidation refetches). The active draft lives in separate state, so
  // in-progress edits are never overwritten by these syncs.
  const [templates, setTemplates] = useState<MissionTemplate[]>([])
  const [types, setTypes] = useState<MissionTypeConfig[]>([])
  const [rewardsByTemplate, setRewardsByTemplate] = useState<Record<string, RewardRow[]>>({})
  const [draft, setDraft] = useState<MissionTemplate | null>(null)
  const [draftRewards, setDraftRewards] = useState<RewardRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Inline delete confirmation. We deliberately do NOT use window.confirm():
  // it's synchronous and blocks the main thread for the whole time the dialog
  // is open, which the browser attributes to the click handler and reports as
  // a multi-second INP / "blocked UI updates" spike.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [filterRarity, setFilterRarity] = useState<string>("all")
  const [filterPeriod, setFilterPeriod] = useState<string>("all")

  const lastSyncedTemplatesRef = useRef<readonly MissionTemplateRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedTemplatesRef.current === templatesQuery) return
    lastSyncedTemplatesRef.current = templatesQuery
    setTemplates([...templatesQuery])
  }, [templatesQuery])
  const lastSyncedTypesRef = useRef<readonly MissionTypeConfigRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedTypesRef.current === typesQuery) return
    lastSyncedTypesRef.current = typesQuery
    setTypes([...typesQuery])
  }, [typesQuery])
  const lastSyncedRewardsRef = useRef<readonly MissionRewardRow[] | null>(null)
  useEffect(() => {
    if (lastSyncedRewardsRef.current === rewardsQuery) return
    lastSyncedRewardsRef.current = rewardsQuery
    const grouped: Record<string, RewardRow[]> = {}
    for (const r of rewardsQuery) {
      const key = r.mission_id ?? "";
      (grouped[key] ??= []).push(r)
    }
    setRewardsByTemplate(grouped)
  }, [rewardsQuery])

  // Query failures surface through the same inline error the saves use.
  useEffect(() => {
    if (templatesError) setError(templatesError.message ?? "Failed to load mission templates.")
  }, [templatesError])
  useEffect(() => {
    if (typesError) setError(typesError.message ?? "Failed to load mission type configs.")
  }, [typesError])
  useEffect(() => {
    if (rewardsError) setError(rewardsError.message ?? "Failed to load mission rewards.")
  }, [rewardsError])

  // When no draft is open the draft-pane error has no home, so load failures
  // render directly from the query state here. While a draft is open these
  // messages stay in the pane's inline error (set by the effects above), so
  // the same failure is never shown twice.
  const loadErrors = !draft ? [
    templatesError ? (templatesError.message ?? "Failed to load mission templates.") : null,
    typesError ? (typesError.message ?? "Failed to load mission type configs.") : null,
    rewardsError ? (rewardsError.message ?? "Failed to load mission rewards.") : null,
  ].filter((m): m is string => m !== null) : []

  const filtered = useMemo(() => {
    return templates.filter((t) => (filterRarity === "all" || t.rarity === filterRarity) && (filterPeriod === "all" || t.period === filterPeriod))
  }, [templates, filterRarity, filterPeriod])

  const typeByCode = useMemo(() => {
    const m = new Map<string, MissionTypeConfig>()
    for (const t of types) m.set(t.mission_type, t)
    return m
  }, [types])

  // The registry row backing the draft's selected mission type (may be undefined
  // for a legacy type not yet in mission_type_config).
  const draftType = draft ? typeByCode.get(draft.mission_type) : undefined

  /** Switch mission type: derive the metric from the registry, and if the new
   *  type can't be personalized, fall back to a fixed goal. */
  const onChangeMissionType = (code: string) => {
    if (!draft) return
    const cfg = typeByCode.get(code)
    const nextMode = draft.resolution_mode === "personalized" && !cfg?.supports_personalized ? "fixed" : draft.resolution_mode
    setDraft({
      ...draft,
      mission_type: code,
      metric_code: cfg?.metric_code ?? draft.metric_code,
      resolution_mode: nextMode,
      goal_value: nextMode === "fixed" ? (draft.goal_value ?? 1) : draft.goal_value,
    })
  }

  const startEdit = (t: MissionTemplate | null) => {
    setError(null)
    setConfirmingDelete(false)
    if (t) {
      setDraft({...t})
      setDraftRewards(rewardsByTemplate[t.id] ?? [])
    }
    else {
      // New template
      setDraft({
        id: "",
        mission_type: "play_matches",
        metric_code: "matches_per_day",
        rarity: "common",
        resolution_mode: "fixed",
        goal_value: 1,
        stretch_factor: null,
        goal_min: 1,
        goal_max: 999999,
        eligibility: {},
        params: {},
        mission_points: 10,
        period: "daily",
        title: "New mission",
        subtitle: "",
        icon_url: null,
        enabled: false,
        reward_mode: "manual",
        cashback_pct: null,
      })
      setDraftRewards([])
    }
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const payload: MissionTemplateInsert = {...draft}
      // Clean up resolution-mode-specific fields so the check constraint passes.
      // fixed → goal_value only; stretch → stretch_factor only; personalized →
      // neither (goal + reward are generated per player at assignment).
      if (payload.resolution_mode === "fixed") {
        payload.stretch_factor = null
      }
      else if (payload.resolution_mode === "stretch") {
        payload.goal_value = null
      }
      else {
        payload.goal_value = null
        payload.stretch_factor = null
      }
      // Cashback % only applies in cashback mode; null it otherwise.
      if (payload.reward_mode !== "cashback") payload.cashback_pct = null
      delete (payload as {id?: string}).id

      // Rewards travel without a mission_id — the data layer injects the
      // resolved template id after the update-or-insert (unknown until then),
      // then deletes the old bundle and inserts the replacement rows.
      const rewards: readonly MissionRewardDraft[] = draftRewards.map((r, i) => ({
        reward_kind: r.reward_kind,
        currency_code: r.reward_kind === "currency" ? r.currency_code : null,
        item_table: r.reward_kind === "item" ? r.item_table : null,
        item_id: r.reward_kind === "item" ? r.item_id : null,
        amount: r.amount,
        display_order: r.display_order ?? i,
      }))

      // The DailyMissions tag invalidation refetches the lists; no manual
      // reload needed.
      await saveTemplate({id: draft.id || null, payload, rewards}).unwrap()
      setDraft(null)
      setDraftRewards([])
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft?.id) return
    setConfirmingDelete(false)
    setSaving(true)
    try {
      await deleteTemplate(draft.id).unwrap()
      setDraft(null)
    }
    catch (e) {
      setError(extractErrorMessage(e))
    }
    finally {
      setSaving(false)
    }
  }

  // Initial load gate: while the three queries fetch their first payload,
  // don't render the empty table (it would read as "no templates").
  // Errors surface through the inline error below, so loading and error
  // are mutually exclusive here.
  if (templatesLoading || typesLoading || rewardsLoading) {
    return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/55">
        Loading mission templates…
      </div>
    </div>)
  }

  return (<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
    {loadErrors.length > 0 && (<div className="space-y-1 xl:col-span-2">
      {loadErrors.map((m) => (<div
        key={m}
        className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">
        {m}
      </div>))}
    </div>)}

    {/* List */}
    <div className="rounded-xl border border-white/10 bg-white/[0.045]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
        <select
          className="rounded-md bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          value={filterRarity}
          onChange={(e) => {
            setFilterRarity(e.target.value)
          }}>
          <option value="all">All rarities</option>
          <option value="common">Common</option>
          <option value="rare">Rare</option>
          <option value="epic">Epic</option>
        </select>
        <select
          className="rounded-md bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          value={filterPeriod}
          onChange={(e) => {
            setFilterPeriod(e.target.value)
          }}>
          <option value="all">All periods</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <div className="ml-auto text-xs text-white/50">
          {filtered.length} of {templates.length}
        </div>
        {canManage && (<button
          className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-bold text-white hover:bg-emerald-500"
          type="button"
          onClick={() => {
            startEdit(null)
          }}>
          + New
        </button>)}
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0d0a18] text-xs uppercase text-white/50">
            <tr>
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-3 py-2 text-left">Rarity</th>
              <th className="px-3 py-2 text-left">Period</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Goal</th>
              <th className="px-3 py-2 text-right">MP</th>
              <th className="px-3 py-2 text-center">On</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (<tr
              key={t.id}
              className={`cursor-pointer border-t border-white/5 transition hover:bg-white/[0.04] ${draft?.id === t.id ? "bg-amber-500/10" : ""}`}
              onClick={() => {
                startEdit(t)
              }}>
              <td className="px-3 py-2 text-white">{t.title}</td>
              <td className="px-3 py-2 capitalize text-white/80">{t.rarity}</td>
              <td className="px-3 py-2 capitalize text-white/80">{t.period}</td>
              <td className="px-3 py-2 font-mono text-xs text-white/60">
                {typeByCode.get(t.mission_type)?.label ?? t.mission_type}
                {typeByCode.get(t.mission_type)?.is_wired === false && (<span
                  className="ml-1 rounded bg-rose-600/30 px-1 py-0.5 text-[9px] font-bold uppercase text-rose-200">dead</span>)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-white/80">
                {t.resolution_mode === "fixed" ? t.goal_value : t.resolution_mode === "stretch" ? `×${String(t.stretch_factor)} [${t.goal_min}..${t.goal_max}]` : "auto"}
              </td>
              <td className="px-3 py-2 text-right font-mono text-amber-200">{t.mission_points}</td>
              <td className="px-3 py-2 text-center">{t.enabled ? "✓" : "–"}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Draft editor */}
    {draft && (<div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-amber-100">
          {draft.id ? `Edit: ${draft.title}` : "New template"}
        </h3>
        <button
          className="text-sm text-white/60 hover:text-white"
          type="button"
          onClick={() => {
            setDraft(null)
            setDraftRewards([])
          }}>
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Title">
          <input
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            type="text"
            value={draft.title}
            onChange={(e) => {
              setDraft({
                ...draft,
                title: e.target.value,
              })
            }}/>
        </Field>
        <Field label="Subtitle">
          <input
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            type="text"
            value={draft.subtitle ?? ""}
            onChange={(e) => {
              setDraft({
                ...draft,
                subtitle: e.target.value,
              })
            }}/>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-white/35">
            Title &amp; subtitle support tokens:{" "}
            <span className="font-mono text-white/55">{"{goal}"}</span> = per-player goal,{" "}
            <span className="font-mono text-white/55">{"{tier}"}</span> = difficulty tier,{" "}
            <span className="font-mono text-white/55">{"{goal|singular|plural}"}</span> = picks the word
            by the goal (singular when the goal is 1, else plural). You write both forms once.{" "}
            e.g. <span className="font-mono text-white/55">{"Spin the wheel {goal} {goal|time|times}"}</span>{" "}
            renders &ldquo;Spin the wheel 1 time&rdquo; or &ldquo;Spin the wheel 5 times&rdquo;.
          </span>
        </Field>
        <Field label="Mission type">
          <select
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            value={draft.mission_type}
            onChange={(e) => {
              onChangeMissionType(e.target.value)
            }}>
            {/* keep a legacy type (not in the registry) selectable so it isn't silently lost */}
            {!typeByCode.has(draft.mission_type) && (
              <option value={draft.mission_type}>{draft.mission_type} (legacy)</option>)}
            {types.map((t) => (<option
              key={t.mission_type}
              value={t.mission_type}>
              {t.label}{t.is_wired ? "" : " — NOT WIRED"}
            </option>))}
          </select>
          {draftType && (<div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            {draftType.is_wired ? <span
              className="rounded bg-emerald-600/30 px-1.5 py-0.5 font-bold uppercase tracking-wider text-emerald-200">● wired</span>
              : <span
                className="rounded bg-rose-600/30 px-1.5 py-0.5 font-bold uppercase tracking-wider text-rose-200">✗ not wired</span>}
            {draftType.supports_personalized && (<span
              className="rounded bg-sky-600/30 px-1.5 py-0.5 font-bold uppercase tracking-wider text-sky-200">personalized-capable</span>)}
          </div>)}
        </Field>
        <Field label="Metric code (from type)">
          <div className="w-full rounded bg-black/20 px-2 py-1 text-sm font-mono text-white/50 ring-1 ring-white/5">
            {draft.metric_code || "—"}
          </div>
        </Field>
        <Field label="Rarity">
          <select
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            value={draft.rarity}
            onChange={(e) => {
              setDraft({
                ...draft,
                rarity: e.target.value as MissionTemplate["rarity"],
              })
            }}>
            <option value="common">Common</option>
            <option value="rare">Rare</option>
            <option value="epic">Epic</option>
          </select>
        </Field>
        <Field label="Period">
          <select
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            value={draft.period}
            onChange={(e) => {
              setDraft({
                ...draft,
                period: e.target.value as MissionTemplate["period"],
              })
            }}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
        <Field label="Resolution mode">
          <select
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            value={draft.resolution_mode}
            onChange={(e) => {
              setDraft({
                ...draft,
                resolution_mode: e.target.value as MissionTemplate["resolution_mode"],
              })
            }}>
            <option value="fixed">Fixed</option>
            <option value="stretch">Stretch (× baseline)</option>
            <option
              disabled={!draftType?.supports_personalized}
              value="personalized">
              Personalized{draftType?.supports_personalized ? "" : " — type N/A"}
            </option>
          </select>
        </Field>
        <Field label="Mission points">
          <input
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            type="number"
            value={draft.mission_points}
            onChange={(e) => {
              setDraft({
                ...draft,
                mission_points: Number(e.target.value),
              })
            }}/>
        </Field>
        <Field label="Difficulty tier">
          <select
            className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            disabled={!canManage}
            value={(draft.params?.difficulty_id as string | undefined) ?? ""}
            onChange={(e) => {
              const v = e.target.value
              const next = {...(draft.params ?? {})}
              if (v) next.difficulty_id = v; else delete next.difficulty_id
              setDraft({
                ...draft,
                params: next,
              })
            }}>
            <option value="">None (any tier)</option>
            <option value="beginner">Beginner</option>
            <option value="advanced">Advanced</option>
            <option value="pro">Pro</option>
            <option value="expert">Expert</option>
            <option value="grand-master">Grand Master</option>
          </select>
          <span className="mt-0.5 block text-[10px] text-white/35">
            Pins the mission to a tier: fills <span className="font-mono text-white/55">{"{tier}"}</span>,
            scopes progress, and sets the wager the cashback reward is based on.
          </span>
        </Field>
        {draft.resolution_mode === "personalized" ? (<Field
          wide
          label="Goal & reward">
          <div
            className="rounded bg-sky-950/40 px-3 py-2 text-xs leading-relaxed text-sky-100/80 ring-1 ring-sky-400/20">
            Generated <span className="font-bold text-sky-200">per player</span> at assignment: the
            goal adapts to each player's habit (and eases if they keep missing), and the reward is a
            % of their expected loss. Tune the coefficients for this type in the{" "}
            <span className="font-bold text-sky-200">Mission Types</span> tab. The fixed/stretch goal
            and the reward bundle below are ignored for personalized missions.
          </div>
        </Field>) : (<>
          {draft.resolution_mode === "fixed" ? (<Field label="Goal value (fixed)">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="number"
              value={draft.goal_value ?? 0}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  goal_value: Number(e.target.value),
                })
              }}/>
          </Field>) : (<Field label="Stretch factor">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              step="0.05"
              type="number"
              value={draft.stretch_factor ?? 1}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  stretch_factor: Number(e.target.value),
                })
              }}/>
          </Field>)}
          <Field label="Goal min (clamp)">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="number"
              value={draft.goal_min}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  goal_min: Number(e.target.value),
                })
              }}/>
          </Field>
          <Field label="Goal max (clamp)">
            <input
              className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              disabled={!canManage}
              type="number"
              value={draft.goal_max}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  goal_max: Number(e.target.value),
                })
              }}/>
          </Field>
        </>)}
        <div className="col-span-2">
          <ImageField
            disabled={!canManage}
            folder="missions"
            kind={draft.mission_type}
            label="Icon"
            value={draft.icon_url ?? ""}
            onChange={(v) => {
              setDraft({
                ...draft,
                icon_url: v || null,
              })
            }}/>
        </div>
        <Field
          wide
          label="Eligibility (JSON)">
          <JsonField
            disabled={!canManage}
            value={draft.eligibility}
            onChange={(v) => {
              setDraft({
                ...draft,
                eligibility: v,
              })
            }}/>
        </Field>
        <Field
          wide
          label="Params (JSON)">
          <JsonField
            disabled={!canManage}
            value={draft.params}
            onChange={(v) => {
              setDraft({
                ...draft,
                params: v,
              })
            }}/>
        </Field>
        <Field
          wide
          label="Enabled">
          <label className="flex items-center gap-2 text-sm text-white">
            <input
              checked={draft.enabled}
              disabled={!canManage}
              type="checkbox"
              onChange={(e) => {
                setDraft({
                  ...draft,
                  enabled: e.target.checked,
                })
              }}/>
            {draft.enabled ? "Active in catalog" : "Disabled"}
          </label>
        </Field>
      </div>

      {/* Reward */}
      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-amber-100/70">Reward</span>
          <select
            className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
            disabled={!canManage}
            value={draft.reward_mode}
            onChange={(e) => {
              setDraft({
                ...draft,
                reward_mode: e.target.value as MissionTemplate["reward_mode"],
              })
            }}>
            <option value="manual">Manual bundle</option>
            <option value="cashback">Cashback — % of house edge</option>
          </select>
        </div>
        {draft.reward_mode === "cashback" ? (
          <div className="rounded bg-amber-950/30 px-3 py-3 ring-1 ring-amber-400/20">
            <div className="flex items-center gap-2">
              <label className="text-xs text-amber-100/80">Cashback</label>
              <input
                className="w-24 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                disabled={!canManage}
                min="0"
                step="0.5"
                type="number"
                value={draft.cashback_pct != null ? +(draft.cashback_pct * 100).toFixed(2) : ""}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    cashback_pct: e.target.value === "" ? null : Number(e.target.value) / 100,
                  })
                }}/>
              <span className="text-sm text-white/70">% of house edge</span>
            </div>
            {(() => {
              const p = previewCashback(draft)
              if (!p) return (<div className="mt-2 text-xs text-white/45">Enter a cashback % to preview the
                reward.</div>)
              if (p.needsTier) return (<div className="mt-2 text-xs text-rose-200/90">Pin a difficulty tier above to
                size the cashback — the entry fee sets the wager.</div>)
              return (<div className="mt-2 text-xs leading-relaxed text-amber-100/85">
                ≈ <span className="font-bold text-amber-200">{p.reward.toLocaleString()} coins</span> at
                goal {p.goal}
                {" "}· {(draft.cashback_pct! * 100).toFixed(1)}% of edge on {p.investment.toLocaleString()} coins
                wagered
                {p.tier ? ` in ${p.tier}` : ""}
                <div className="mt-1 text-white/40">Sized per player at assignment from the live tier fee/RTP;
                  this is an estimate.
                </div>
              </div>)
            })()}
          </div>) : (<RewardBundleEditor
          disabled={!canManage}
          rows={draftRewards}
          onChange={setDraftRewards}/>)}
      </div>

      {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}

      {canManage && (<div className="mt-4 flex gap-2">
        <button
          className="flex-1 rounded bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={saving}
          type="button"
          onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {draft.id && (<button
          className="rounded bg-sky-700 px-4 py-2 font-bold text-white hover:bg-sky-600 disabled:opacity-50"
          disabled={saving}
          type="button"
          onClick={() => {
            setDraft({
              ...draft,
              id: "",
              title: `Copy of ${draft.title}`,
            })
          }}>
          Duplicate
        </button>)}
        {draft.id && !confirmingDelete && (<button
          className="rounded bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-600 disabled:opacity-50"
          disabled={saving}
          type="button"
          onClick={() => {
            setConfirmingDelete(true)
          }}>
          Delete
        </button>)}
        {draft.id && confirmingDelete && (
          <div className="flex items-center gap-2 rounded bg-rose-950/50 px-2 py-1 ring-1 ring-rose-500/40">
            <span className="px-1 text-xs font-semibold text-rose-100">Delete permanently?</span>
            <button
              className="rounded bg-rose-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-50"
              disabled={saving}
              type="button"
              onClick={remove}>
              {saving ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              className="rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50"
              disabled={saving}
              type="button"
              onClick={() => {
                setConfirmingDelete(false)
              }}>
              Cancel
            </button>
          </div>)}
      </div>)}
    </div>)}
  </div>)
}
