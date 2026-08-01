import { useCallback, useEffect, useMemo, useState } from 'react';
// IMPORTANT: use the BO's independent Supabase session, NOT the
// main player-facing client. The main client carries the operator's
// PLAYER auth (which isn't in admin_roles), and our admin-gated
// RPCs check auth.uid() inline → would return 'forbidden'. The
// adminSupabase client is the one logged in as the operator's BO
// session and is what every other admin/* file uses.
import { adminSupabase as supabase } from '../lib/adminSupabase';
import { extractErrorMessage } from '@shared/errors';
import ImageField from './ImageField';
import { useConfirm } from './useConfirm';

// The Daily Missions tables aren't in the generated Database type
// (a full Supabase types regen would lose our hand-patched phantom
// columns — see Phase 1 commit notes). Until we do a careful merge,
// we use a loosely-typed `sb` alias for table writes in this file.
// All the RPCs go through the typed surface (added in src/types/
// database.ts during Phase 6).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Daily Missions BO admin — Phase 7 per docs/specs/daily-missions.md.
 *
 * One self-contained component (mirroring WheelAdmin's pattern) with
 * internal sub-tabs:
 *   • Templates     — mission_templates CRUD + per-template reward bundle
 *   • Chests        — chest_milestones + chest_rewards bundles
 *   • Reroll        — reroll_pricing_config singleton (ladder + cap)
 *   • Streak Chest  — streak_chest_rewards bundle
 *   • Preview       — dry-run: pick a profile, see what they'd be
 *                     assigned today (stub in this pass — will be a
 *                     fast-follow once the first 3 tabs are real-world
 *                     tested by the operator).
 *
 * Each editor lists rows in a table + opens a side draft pane on row
 * click. Saves write directly to the table (authoring writes are
 * gated by RLS to private.can_manage_config, which is the owner/admin
 * role; non-admins see read-only views from the same client).
 */

interface Props {
  readonly canManage: boolean;
}

type SubTab = 'templates' | 'types' | 'chests' | 'reroll' | 'streak' | 'simulator';

export function MissionsAdmin({ canManage }: Props) {
  const [tab, setTab] = useState<SubTab>('templates');

  const tabs: ReadonlyArray<{ readonly id: SubTab; readonly label: string }> = [
    { id: 'templates', label: 'Templates' },
    { id: 'types',     label: 'Mission Types' },
    { id: 'chests',    label: 'Chests' },
    { id: 'reroll',    label: 'Reroll' },
    { id: 'streak',    label: 'Streak Chest' },
    { id: 'simulator', label: 'Simulator' },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-white/[0.04] p-1 ring-1 ring-white/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/40'
                : 'text-white/70 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <RefreshMissionsTool canManage={canManage} />

      {tab === 'templates' && <TemplatesEditor canManage={canManage} />}
      {tab === 'types'     && <MissionTypesEditor canManage={canManage} />}
      {tab === 'chests'    && <ChestsEditor canManage={canManage} />}
      {tab === 'reroll'    && <RerollEditor canManage={canManage} />}
      {tab === 'streak'    && <StreakEditor canManage={canManage} />}
      {tab === 'simulator' && <SimulatorTab canManage={canManage} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Testing helper: refresh a real player's daily missions on demand   */
/* ────────────────────────────────────────────────────────────────── */

function RefreshMissionsTool({ canManage }: { readonly canManage: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!canManage) return null;

  const run = async () => {
    const e = email.trim();
    if (!e || busy) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const { data, error } = await sb.rpc('admin_refresh_player_missions', { p_email: e });
      if (error) throw error;
      const d = (data ?? {}) as { deleted?: number; assigned?: number };
      setMsg(`Refreshed — cleared ${d.deleted ?? 0}, assigned ${d.assigned ?? 0} daily mission(s). Reload the player's lobby.`);
    } catch (ex) {
      setErr(extractErrorMessage(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-950/20 px-3 py-2">
      <span className="text-xs font-bold uppercase tracking-wider text-amber-200/80">Testing · Refresh missions</span>
      <input
        type="email"
        placeholder="player email"
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
        onKeyDown={(ev) => { if (ev.key === 'Enter') run(); }}
        className="min-w-[200px] flex-1 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
      />
      <button
        type="button"
        disabled={busy || !email.trim()}
        onClick={run}
        className="rounded bg-amber-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-50"
      >
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
      {msg && <span className="text-xs text-emerald-300">{msg}</span>}
      {err && <span className="text-xs text-rose-300">{err}</span>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Mission Templates editor                                           */
/* ────────────────────────────────────────────────────────────────── */

interface MissionTemplate {
  id: string;
  mission_type: string;
  metric_code: string;
  rarity: 'common' | 'rare' | 'epic';
  resolution_mode: 'fixed' | 'stretch' | 'personalized';
  goal_value: number | null;
  stretch_factor: number | null;
  goal_min: number;
  goal_max: number;
  eligibility: Record<string, unknown>;
  params: Record<string, unknown>;
  mission_points: number;
  period: 'daily' | 'weekly';
  title: string;
  subtitle: string | null;
  icon_url: string | null;
  enabled: boolean;
  reward_mode: 'manual' | 'cashback';
  cashback_pct: number | null;
}

// Per-tier entry fee + target RTP, mirrored from table_configs for the BO
// cashback PREVIEW only (the server recomputes authoritatively at assignment via
// mp_cashback_reward). Keep loosely in sync with table_configs.
const TIER_INFO: Record<string, { fee: number; rtp: number; name: string }> = {
  beginner: { fee: 1000, rtp: 90, name: 'Beginner' },
  advanced: { fee: 3000, rtp: 87, name: 'Advanced' },
  pro: { fee: 10000, rtp: 85, name: 'Pro' },
  expert: { fee: 30000, rtp: 82, name: 'Expert' },
  'grand-master': { fee: 100000, rtp: 80, name: 'Grand Master' },
};

/** Estimate the cashback coin reward for the editor preview; mirrors the
 *  server's mp_cashback_reward(). Returns null when there's nothing to show. */
function previewCashback(d: MissionTemplate) {
  const pct = d.cashback_pct ?? 0;
  if (pct <= 0) return null;
  const goal = d.resolution_mode === 'fixed' ? (d.goal_value ?? 0) : d.goal_min;
  if (goal <= 0) return null;
  const tierId = (d.params?.difficulty_id as string | undefined) ?? '';
  const tier = TIER_INFO[tierId];
  const isWager = d.metric_code === 'coins_wagered_per_day';
  if (!isWager && !tier) return { reward: 0, goal, investment: 0, tier: null as string | null, needsTier: true };
  const edge = 1 - (tier?.rtp ?? 90) / 100;
  const investment = isWager ? goal : goal * (tier?.fee ?? 0);
  // Round UP to the next 100 (matches mp_cashback_reward server-side).
  const reward = Math.ceil((pct * investment * edge) / 100) * 100;
  return { reward, goal, investment, tier: (tier?.name ?? null) as string | null, needsTier: false };
}

/** A row of mission_type_config — the registry that binds a mission type to its
 *  progress metric, records whether that event is actually wired, and holds the
 *  per-type adaptive-controller coefficients used by personalized missions. */
interface MissionTypeConfig {
  mission_type: string;
  metric_code: string;
  label: string;
  description: string | null;
  is_wired: boolean;
  supports_personalized: boolean;
  base_stretch: number;
  up_step: number;
  ease_after: number;
  ease_factor: number;
  floor_mult: number;
  cap_mult: number;
  reward_pct: number;
  floor_reward: number;
  round_to: number;
  baseline_window_days: number;
  goal_round_to: number;
  rollout_pct: number;
}

const COEFFICIENT_FIELDS: ReadonlyArray<{
  readonly key: keyof MissionTypeConfig;
  readonly label: string;
  readonly step: number;
  readonly hint: string;
}> = [
  { key: 'base_stretch',         label: 'Base stretch',      step: 0.05, hint: 'Cold-start goal = ceil(baseline × this).' },
  { key: 'up_step',              label: 'Ramp step (+)',     step: 1,    hint: 'Goal increase after a completed mission.' },
  { key: 'ease_after',           label: 'Ease after N miss', step: 1,    hint: 'Misses before the goal eases.' },
  { key: 'ease_factor',          label: 'Ease factor',       step: 0.05, hint: 'On ease: goal = last completed × this.' },
  { key: 'floor_mult',           label: 'Floor ×baseline',   step: 0.05, hint: 'Lower clamp = ceil(baseline × this).' },
  { key: 'cap_mult',             label: 'Cap ×baseline',     step: 0.5,  hint: 'Upper clamp = ceil(baseline × this).' },
  { key: 'reward_pct',           label: 'Reward % of loss',  step: 0.01, hint: 'Reward = this × expected loss. Must stay < 1.' },
  { key: 'floor_reward',         label: 'Floor reward',      step: 50,   hint: 'Minimum coin reward, before rounding.' },
  { key: 'round_to',             label: 'Round reward to',   step: 50,   hint: 'Reward is rounded to this multiple.' },
  { key: 'baseline_window_days', label: 'Baseline window (d)', step: 5,  hint: 'Days of history used for the baseline median.' },
  { key: 'goal_round_to',        label: 'Goal rounding',       step: 1,    hint: 'Goal rounds to this multiple (1 for counts, e.g. 250 for coins).' },
];

interface RewardRow {
  id?: string;
  mission_id?: string;
  milestone_id?: string;
  reward_kind: 'currency' | 'item';
  currency_code: string | null;
  item_table: string | null;
  item_id: string | null;
  amount: number;
  display_order: number;
}

function TemplatesEditor({ canManage }: { readonly canManage: boolean }) {
  const [templates, setTemplates] = useState<MissionTemplate[]>([]);
  const [types, setTypes] = useState<MissionTypeConfig[]>([]);
  const [rewardsByTemplate, setRewardsByTemplate] = useState<Record<string, RewardRow[]>>({});
  const [draft, setDraft] = useState<MissionTemplate | null>(null);
  const [draftRewards, setDraftRewards] = useState<RewardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Inline delete confirmation. We deliberately do NOT use window.confirm():
  // it's synchronous and blocks the main thread for the whole time the dialog
  // is open, which the browser attributes to the click handler and reports as
  // a multi-second INP / "blocked UI updates" spike.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [filterRarity, setFilterRarity] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');

  const load = useCallback(async () => {
    setError(null);
    const { data: cfgs, error: cErr } = await sb.from('mission_type_config')
      .select('*')
      .order('label');
    if (cErr) { setError(extractErrorMessage(cErr)); return; }
    setTypes((cfgs ?? []) as MissionTypeConfig[]);

    const { data: tpls, error: tErr } = await sb.from('mission_templates')
      .select('*')
      .order('period')
      .order('rarity')
      .order('mission_type');
    if (tErr) { setError(extractErrorMessage(tErr)); return; }
    setTemplates((tpls ?? []) as MissionTemplate[]);

    const { data: rws, error: rErr } = await sb.from('mission_rewards')
      .select('*')
      .order('display_order');
    if (rErr) { setError(extractErrorMessage(rErr)); return; }

    const grouped: Record<string, RewardRow[]> = {};
    for (const r of (rws ?? []) as RewardRow[]) {
      const key = r.mission_id ?? '';
      (grouped[key] ??= []).push(r);
    }
    setRewardsByTemplate(grouped);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    return templates.filter((t) =>
      (filterRarity === 'all' || t.rarity === filterRarity) &&
      (filterPeriod === 'all' || t.period === filterPeriod)
    );
  }, [templates, filterRarity, filterPeriod]);

  const typeByCode = useMemo(() => {
    const m = new Map<string, MissionTypeConfig>();
    for (const t of types) m.set(t.mission_type, t);
    return m;
  }, [types]);

  // The registry row backing the draft's selected mission type (may be undefined
  // for a legacy type not yet in mission_type_config).
  const draftType = draft ? typeByCode.get(draft.mission_type) : undefined;

  /** Switch mission type: derive the metric from the registry, and if the new
   *  type can't be personalized, fall back to a fixed goal. */
  const onChangeMissionType = (code: string) => {
    if (!draft) return;
    const cfg = typeByCode.get(code);
    const nextMode =
      draft.resolution_mode === 'personalized' && !cfg?.supports_personalized
        ? 'fixed'
        : draft.resolution_mode;
    setDraft({
      ...draft,
      mission_type: code,
      metric_code: cfg?.metric_code ?? draft.metric_code,
      resolution_mode: nextMode,
      goal_value: nextMode === 'fixed' ? (draft.goal_value ?? 1) : draft.goal_value,
    });
  };

  const startEdit = (t: MissionTemplate | null) => {
    setError(null);
    setConfirmingDelete(false);
    if (t) {
      setDraft({ ...t });
      setDraftRewards(rewardsByTemplate[t.id] ?? []);
    } else {
      // New template
      setDraft({
        id: '',
        mission_type: 'play_matches',
        metric_code: 'matches_per_day',
        rarity: 'common',
        resolution_mode: 'fixed',
        goal_value: 1,
        stretch_factor: null,
        goal_min: 1,
        goal_max: 999999,
        eligibility: {},
        params: {},
        mission_points: 10,
        period: 'daily',
        title: 'New mission',
        subtitle: '',
        icon_url: null,
        enabled: false,
        reward_mode: 'manual',
        cashback_pct: null,
      });
      setDraftRewards([]);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<MissionTemplate> = { ...draft };
      // Clean up resolution-mode-specific fields so the check constraint passes.
      // fixed → goal_value only; stretch → stretch_factor only; personalized →
      // neither (goal + reward are generated per player at assignment).
      if (payload.resolution_mode === 'fixed') {
        payload.stretch_factor = null;
      } else if (payload.resolution_mode === 'stretch') {
        payload.goal_value = null;
      } else {
        payload.goal_value = null;
        payload.stretch_factor = null;
      }
      // Cashback % only applies in cashback mode; null it otherwise.
      if (payload.reward_mode !== 'cashback') payload.cashback_pct = null;
      delete (payload as { id?: string }).id;

      let templateId: string;
      if (draft.id) {
        const { error: e } = await sb.from('mission_templates')
          .update(payload)
          .eq('id', draft.id);
        if (e) throw e;
        templateId = draft.id;
      } else {
        const { data, error: e } = await sb.from('mission_templates')
          .insert(payload)
          .select('id')
          .single();
        if (e) throw e;
        templateId = (data as { id: string }).id;
      }

      // Replace rewards: simplest correct approach is to delete
      // existing + re-insert. Operator-scale; rewards-per-mission
      // is small.
      const { error: delErr } = await sb.from('mission_rewards')
        .delete()
        .eq('mission_id', templateId);
      if (delErr) throw delErr;

      if (draftRewards.length > 0) {
        const rows = draftRewards.map((r, i) => ({
          mission_id: templateId,
          reward_kind: r.reward_kind,
          currency_code: r.reward_kind === 'currency' ? r.currency_code : null,
          item_table: r.reward_kind === 'item' ? r.item_table : null,
          item_id: r.reward_kind === 'item' ? r.item_id : null,
          amount: r.amount,
          display_order: r.display_order ?? i,
        }));
        const { error: insErr } = await sb.from('mission_rewards')
          .insert(rows);
        if (insErr) throw insErr;
      }

      await load();
      setDraft(null);
      setDraftRewards([]);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft || !draft.id) return;
    setConfirmingDelete(false);
    setSaving(true);
    const { error: e } = await sb.from('mission_templates')
      .delete()
      .eq('id', draft.id);
    setSaving(false);
    if (e) { setError(extractErrorMessage(e)); return; }
    await load();
    setDraft(null);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      {/* List */}
      <div className="rounded-xl border border-white/10 bg-white/[0.045]">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <select
            value={filterRarity}
            onChange={(e) => setFilterRarity(e.target.value)}
            className="rounded-md bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          >
            <option value="all">All rarities</option>
            <option value="common">Common</option>
            <option value="rare">Rare</option>
            <option value="epic">Epic</option>
          </select>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            className="rounded-md bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          >
            <option value="all">All periods</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <div className="ml-auto text-xs text-white/50">
            {filtered.length} of {templates.length}
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => startEdit(null)}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-bold text-white hover:bg-emerald-500"
            >
              + New
            </button>
          )}
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
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => startEdit(t)}
                  className={`cursor-pointer border-t border-white/5 transition hover:bg-white/[0.04] ${
                    draft?.id === t.id ? 'bg-amber-500/10' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-white">{t.title}</td>
                  <td className="px-3 py-2 capitalize text-white/80">{t.rarity}</td>
                  <td className="px-3 py-2 capitalize text-white/80">{t.period}</td>
                  <td className="px-3 py-2 font-mono text-xs text-white/60">
                    {typeByCode.get(t.mission_type)?.label ?? t.mission_type}
                    {typeByCode.get(t.mission_type)?.is_wired === false && (
                      <span className="ml-1 rounded bg-rose-600/30 px-1 py-0.5 text-[9px] font-bold uppercase text-rose-200">dead</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/80">
                    {t.resolution_mode === 'fixed'
                      ? t.goal_value
                      : t.resolution_mode === 'stretch'
                        ? `×${t.stretch_factor} [${t.goal_min}..${t.goal_max}]`
                        : 'auto'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-200">{t.mission_points}</td>
                  <td className="px-3 py-2 text-center">{t.enabled ? '✓' : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Draft editor */}
      {draft && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-amber-100">
              {draft.id ? `Edit: ${draft.title}` : 'New template'}
            </h3>
            <button
              type="button"
              onClick={() => { setDraft(null); setDraftRewards([]); }}
              className="text-sm text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Title">
              <input
                type="text" value={draft.title} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
            </Field>
            <Field label="Subtitle">
              <input
                type="text" value={draft.subtitle ?? ''} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
              <span className="mt-0.5 block text-[10px] leading-relaxed text-white/35">
                Title &amp; subtitle support tokens:{' '}
                <span className="font-mono text-white/55">{'{goal}'}</span> = per-player goal,{' '}
                <span className="font-mono text-white/55">{'{tier}'}</span> = difficulty tier,{' '}
                <span className="font-mono text-white/55">{'{goal|singular|plural}'}</span> = picks the word
                by the goal (singular when the goal is 1, else plural). You write both forms once.{' '}
                e.g. <span className="font-mono text-white/55">{'Spin the wheel {goal} {goal|time|times}'}</span>{' '}
                renders &ldquo;Spin the wheel 1 time&rdquo; or &ldquo;Spin the wheel 5 times&rdquo;.
              </span>
            </Field>
            <Field label="Mission type">
              <select
                value={draft.mission_type} disabled={!canManage}
                onChange={(e) => onChangeMissionType(e.target.value)}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              >
                {/* keep a legacy type (not in the registry) selectable so it isn't silently lost */}
                {!typeByCode.has(draft.mission_type) && (
                  <option value={draft.mission_type}>{draft.mission_type} (legacy)</option>
                )}
                {types.map((t) => (
                  <option key={t.mission_type} value={t.mission_type}>
                    {t.label}{t.is_wired ? '' : ' — NOT WIRED'}
                  </option>
                ))}
              </select>
              {draftType && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                  {draftType.is_wired
                    ? <span className="rounded bg-emerald-600/30 px-1.5 py-0.5 font-bold uppercase tracking-wider text-emerald-200">● wired</span>
                    : <span className="rounded bg-rose-600/30 px-1.5 py-0.5 font-bold uppercase tracking-wider text-rose-200">✗ not wired</span>}
                  {draftType.supports_personalized && (
                    <span className="rounded bg-sky-600/30 px-1.5 py-0.5 font-bold uppercase tracking-wider text-sky-200">personalized-capable</span>
                  )}
                </div>
              )}
            </Field>
            <Field label="Metric code (from type)">
              <div className="w-full rounded bg-black/20 px-2 py-1 text-sm font-mono text-white/50 ring-1 ring-white/5">
                {draft.metric_code || '—'}
              </div>
            </Field>
            <Field label="Rarity">
              <select
                value={draft.rarity} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, rarity: e.target.value as MissionTemplate['rarity'] })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              >
                <option value="common">Common</option>
                <option value="rare">Rare</option>
                <option value="epic">Epic</option>
              </select>
            </Field>
            <Field label="Period">
              <select
                value={draft.period} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, period: e.target.value as MissionTemplate['period'] })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>
            <Field label="Resolution mode">
              <select
                value={draft.resolution_mode} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, resolution_mode: e.target.value as MissionTemplate['resolution_mode'] })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              >
                <option value="fixed">Fixed</option>
                <option value="stretch">Stretch (× baseline)</option>
                <option value="personalized" disabled={!draftType?.supports_personalized}>
                  Personalized{draftType?.supports_personalized ? '' : ' — type N/A'}
                </option>
              </select>
            </Field>
            <Field label="Mission points">
              <input
                type="number" value={draft.mission_points} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, mission_points: Number(e.target.value) })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
            </Field>
            <Field label="Difficulty tier">
              <select
                value={(draft.params?.difficulty_id as string | undefined) ?? ''}
                disabled={!canManage}
                onChange={(e) => {
                  const v = e.target.value;
                  const next = { ...(draft.params ?? {}) };
                  if (v) next.difficulty_id = v; else delete next.difficulty_id;
                  setDraft({ ...draft, params: next });
                }}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              >
                <option value="">None (any tier)</option>
                <option value="beginner">Beginner</option>
                <option value="advanced">Advanced</option>
                <option value="pro">Pro</option>
                <option value="expert">Expert</option>
                <option value="grand-master">Grand Master</option>
              </select>
              <span className="mt-0.5 block text-[10px] text-white/35">
                Pins the mission to a tier: fills <span className="font-mono text-white/55">{'{tier}'}</span>,
                scopes progress, and sets the wager the cashback reward is based on.
              </span>
            </Field>
            {draft.resolution_mode === 'personalized' ? (
              <Field label="Goal & reward" wide>
                <div className="rounded bg-sky-950/40 px-3 py-2 text-xs leading-relaxed text-sky-100/80 ring-1 ring-sky-400/20">
                  Generated <span className="font-bold text-sky-200">per player</span> at assignment: the
                  goal adapts to each player's habit (and eases if they keep missing), and the reward is a
                  % of their expected loss. Tune the coefficients for this type in the{' '}
                  <span className="font-bold text-sky-200">Mission Types</span> tab. The fixed/stretch goal
                  and the reward bundle below are ignored for personalized missions.
                </div>
              </Field>
            ) : (
              <>
                {draft.resolution_mode === 'fixed' ? (
                  <Field label="Goal value (fixed)">
                    <input
                      type="number" value={draft.goal_value ?? 0} disabled={!canManage}
                      onChange={(e) => setDraft({ ...draft, goal_value: Number(e.target.value) })}
                      className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                    />
                  </Field>
                ) : (
                  <Field label="Stretch factor">
                    <input
                      type="number" step="0.05" value={draft.stretch_factor ?? 1} disabled={!canManage}
                      onChange={(e) => setDraft({ ...draft, stretch_factor: Number(e.target.value) })}
                      className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                    />
                  </Field>
                )}
                <Field label="Goal min (clamp)">
                  <input
                    type="number" value={draft.goal_min} disabled={!canManage}
                    onChange={(e) => setDraft({ ...draft, goal_min: Number(e.target.value) })}
                    className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                  />
                </Field>
                <Field label="Goal max (clamp)">
                  <input
                    type="number" value={draft.goal_max} disabled={!canManage}
                    onChange={(e) => setDraft({ ...draft, goal_max: Number(e.target.value) })}
                    className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                  />
                </Field>
              </>
            )}
            <div className="col-span-2">
              <ImageField
                label="Icon"
                value={draft.icon_url ?? ''}
                disabled={!canManage}
                onChange={(v) => setDraft({ ...draft, icon_url: v || null })}
                folder="missions"
                kind={draft.mission_type}
              />
            </div>
            <Field label="Eligibility (JSON)" wide>
              <JsonField
                value={draft.eligibility}
                disabled={!canManage}
                onChange={(v) => setDraft({ ...draft, eligibility: v })}
              />
            </Field>
            <Field label="Params (JSON)" wide>
              <JsonField
                value={draft.params}
                disabled={!canManage}
                onChange={(v) => setDraft({ ...draft, params: v })}
              />
            </Field>
            <Field label="Enabled" wide>
              <label className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox" checked={draft.enabled} disabled={!canManage}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                {draft.enabled ? 'Active in catalog' : 'Disabled'}
              </label>
            </Field>
          </div>

          {/* Reward */}
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <span className="text-xs uppercase tracking-wider text-amber-100/70">Reward</span>
              <select
                value={draft.reward_mode}
                disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, reward_mode: e.target.value as MissionTemplate['reward_mode'] })}
                className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
              >
                <option value="manual">Manual bundle</option>
                <option value="cashback">Cashback — % of house edge</option>
              </select>
            </div>
            {draft.reward_mode === 'cashback' ? (
              <div className="rounded bg-amber-950/30 px-3 py-3 ring-1 ring-amber-400/20">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-amber-100/80">Cashback</label>
                  <input
                    type="number" step="0.5" min="0" disabled={!canManage}
                    value={draft.cashback_pct != null ? +(draft.cashback_pct * 100).toFixed(2) : ''}
                    onChange={(e) => setDraft({ ...draft, cashback_pct: e.target.value === '' ? null : Number(e.target.value) / 100 })}
                    className="w-24 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                  />
                  <span className="text-sm text-white/70">% of house edge</span>
                </div>
                {(() => {
                  const p = previewCashback(draft);
                  if (!p) return <div className="mt-2 text-xs text-white/45">Enter a cashback % to preview the reward.</div>;
                  if (p.needsTier) return <div className="mt-2 text-xs text-rose-200/90">Pin a difficulty tier above to size the cashback — the entry fee sets the wager.</div>;
                  return (
                    <div className="mt-2 text-xs leading-relaxed text-amber-100/85">
                      ≈ <span className="font-bold text-amber-200">{p.reward.toLocaleString()} coins</span> at goal {p.goal}
                      {' '}· {(draft.cashback_pct! * 100).toFixed(1)}% of edge on {p.investment.toLocaleString()} coins wagered
                      {p.tier ? ` in ${p.tier}` : ''}
                      <div className="mt-1 text-white/40">Sized per player at assignment from the live tier fee/RTP; this is an estimate.</div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <RewardBundleEditor
                rows={draftRewards}
                onChange={setDraftRewards}
                disabled={!canManage}
              />
            )}
          </div>

          {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}

          {canManage && (
            <div className="mt-4 flex gap-2">
              <button
                type="button" disabled={saving} onClick={save}
                className="flex-1 rounded bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {draft.id && (
                <button
                  type="button" disabled={saving}
                  onClick={() => setDraft({ ...draft, id: '', title: `Copy of ${draft.title}` })}
                  className="rounded bg-sky-700 px-4 py-2 font-bold text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  Duplicate
                </button>
              )}
              {draft.id && !confirmingDelete && (
                <button
                  type="button" disabled={saving} onClick={() => setConfirmingDelete(true)}
                  className="rounded bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              {draft.id && confirmingDelete && (
                <div className="flex items-center gap-2 rounded bg-rose-950/50 px-2 py-1 ring-1 ring-rose-500/40">
                  <span className="px-1 text-xs font-semibold text-rose-100">Delete permanently?</span>
                  <button
                    type="button" disabled={saving} onClick={remove}
                    className="rounded bg-rose-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-50"
                  >
                    {saving ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    type="button" disabled={saving} onClick={() => setConfirmingDelete(false)}
                    className="rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Mission Types editor — registry + per-type coefficients            */
/* ────────────────────────────────────────────────────────────────── */

function MissionTypesEditor({ canManage }: { readonly canManage: boolean }) {
  const [rows, setRows] = useState<MissionTypeConfig[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MissionTypeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await sb.from('mission_type_config').select('*').order('label');
    if (e) { setError(extractErrorMessage(e)); return; }
    setRows((data ?? []) as MissionTypeConfig[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (r: MissionTypeConfig) => {
    setEditing(r.mission_type);
    setDraft({ ...r });
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      // mission_type is the PK; metric_code + is_wired are code-derived truth,
      // not operator-editable here — so they're intentionally not in the update.
      const { error: e } = await sb.from('mission_type_config')
        .update({
          label: draft.label,
          description: draft.description,
          supports_personalized: draft.supports_personalized,
          base_stretch: draft.base_stretch,
          up_step: draft.up_step,
          ease_after: draft.ease_after,
          ease_factor: draft.ease_factor,
          floor_mult: draft.floor_mult,
          cap_mult: draft.cap_mult,
          reward_pct: draft.reward_pct,
          floor_reward: draft.floor_reward,
          round_to: draft.round_to,
          baseline_window_days: draft.baseline_window_days,
          goal_round_to: draft.goal_round_to,
          rollout_pct: draft.rollout_pct,
        })
        .eq('mission_type', draft.mission_type);
      if (e) throw e;
      await load();
      setEditing(null);
      setDraft(null);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-xs leading-relaxed text-white/60">
        The mission-type registry. Each type binds to a progress{' '}
        <span className="font-mono text-white/80">metric</span>;{' '}
        <span className="font-bold text-emerald-300">wired</span> means that event actually fires in the
        game today (a <span className="font-bold text-rose-300">not-wired</span> type will never make
        progress — fix the hook or retire it). For{' '}
        <span className="font-bold text-sky-300">personalized</span> types, the coefficients drive the
        adaptive goal + self-funding reward (design doc §G).
      </p>

      {rows.map((r) => (
        <div
          key={r.mission_type}
          className={`rounded-xl border bg-white/[0.045] p-3 ${
            editing === r.mission_type ? 'border-amber-500/60' : 'border-white/10'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white">{r.label}</span>
                {r.is_wired
                  ? <span className="rounded bg-emerald-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">● wired</span>
                  : <span className="rounded bg-rose-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200">✗ not wired</span>}
                {r.supports_personalized && (
                  <span className="rounded bg-sky-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-200">personalized</span>
                )}
                {r.supports_personalized && r.rollout_pct > 0 && (
                  <span className="rounded bg-emerald-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">{r.rollout_pct}% live</span>
                )}
              </div>
              <div className="mt-0.5 font-mono text-xs text-white/50">{r.mission_type} → {r.metric_code}</div>
              {r.description && <div className="mt-1 text-xs text-white/60">{r.description}</div>}
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => (editing === r.mission_type ? setEditing(null) : startEdit(r))}
                className="shrink-0 rounded bg-amber-500/20 px-3 py-1 text-sm text-amber-100 hover:bg-amber-500/30"
              >
                {editing === r.mission_type ? 'Close' : 'Edit'}
              </button>
            )}
          </div>

          {editing === r.mission_type && draft && (
            <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Label">
                  <input
                    type="text" value={draft.label} disabled={!canManage}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                  />
                </Field>
                <Field label="Personalized">
                  <label className="flex items-center gap-2 text-sm text-white">
                    <input
                      type="checkbox" checked={draft.supports_personalized} disabled={!canManage}
                      onChange={(e) => setDraft({ ...draft, supports_personalized: e.target.checked })}
                    />
                    {draft.supports_personalized ? 'Adaptive goal + reward' : 'Fixed/stretch only'}
                  </label>
                </Field>
                {draft.supports_personalized && (
                  <Field label="Rollout %">
                    <input
                      type="number" min={0} max={100} value={draft.rollout_pct} disabled={!canManage}
                      onChange={(e) => setDraft({ ...draft, rollout_pct: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                    />
                    <span className="mt-0.5 block text-[10px] text-white/35">
                      % of players the nightly cron assigns this personalized mission (occupies one common slot). 0 = off.
                    </span>
                  </Field>
                )}
                <Field label="Description" wide>
                  <textarea
                    rows={2} value={draft.description ?? ''} disabled={!canManage}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                  />
                </Field>
              </div>

              {draft.supports_personalized && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-sky-200/70">
                    Personalized coefficients
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {COEFFICIENT_FIELDS.map((f) => (
                      <label key={String(f.key)} className="block">
                        <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/50">{f.label}</span>
                        <input
                          type="number" step={f.step}
                          value={String(draft[f.key] as number)} disabled={!canManage}
                          onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
                          className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                        />
                        <span className="mt-0.5 block text-[10px] text-white/35">{f.hint}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-amber-200/70">
                    Reward % of loss must stay below 1 — the economy only remains a net sink while it does.
                  </p>
                </div>
              )}

              {error && <div className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
              {canManage && (
                <button
                  type="button" disabled={saving} onClick={save}
                  className="rounded bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save type'}
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {rows.length === 0 && <div className="text-sm text-white/40">No mission types configured.</div>}
      {error && editing === null && <div className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Chest Milestones editor                                            */
/* ────────────────────────────────────────────────────────────────── */

interface ChestMilestoneRow {
  id: string;
  milestone_index: number;
  threshold_mp: number;
  display_name: string;
  rarity: string;
  enabled: boolean;
}

function ChestsEditor({ canManage }: { readonly canManage: boolean }) {
  const [chests, setChests] = useState<ChestMilestoneRow[]>([]);
  const [rewardsByMilestone, setRewardsByMilestone] = useState<Record<string, RewardRow[]>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftChest, setDraftChest] = useState<ChestMilestoneRow | null>(null);
  const [draftRewards, setDraftRewards] = useState<RewardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await sb.from('chest_milestones').select('*').order('milestone_index');
    if (e) { setError(extractErrorMessage(e)); return; }
    setChests((data ?? []) as ChestMilestoneRow[]);

    const { data: rws } = await sb.from('chest_rewards').select('*').order('display_order');
    const grouped: Record<string, RewardRow[]> = {};
    for (const r of (rws ?? []) as RewardRow[]) {
      const key = r.milestone_id ?? '';
      (grouped[key] ??= []).push(r);
    }
    setRewardsByMilestone(grouped);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (c: ChestMilestoneRow) => {
    setEditingId(c.id);
    setDraftChest({ ...c });
    setDraftRewards(rewardsByMilestone[c.id] ?? []);
    setError(null);
  };

  const save = async () => {
    if (!draftChest) return;
    setSaving(true);
    setError(null);
    try {
      const { id, ...rest } = draftChest;
      const { error: e } = await sb.from('chest_milestones').update(rest).eq('id', id);
      if (e) throw e;
      await sb.from('chest_rewards').delete().eq('milestone_id', id);
      if (draftRewards.length > 0) {
        const rows = draftRewards.map((r, i) => ({
          milestone_id: id,
          reward_kind: r.reward_kind,
          currency_code: r.reward_kind === 'currency' ? r.currency_code : null,
          item_table: r.reward_kind === 'item' ? r.item_table : null,
          item_id: r.reward_kind === 'item' ? r.item_id : null,
          amount: r.amount,
          display_order: r.display_order ?? i,
        }));
        const { error: insErr } = await sb.from('chest_rewards').insert(rows);
        if (insErr) throw insErr;
      }
      await load();
      setEditingId(null);
      setDraftChest(null);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {chests.map((c) => (
        <div
          key={c.id}
          className={`rounded-xl border bg-white/[0.045] p-3 ${
            editingId === c.id ? 'border-amber-500/60' : 'border-white/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={`/lobby/missions/chest-${c.milestone_index}.webp`}
                alt="" className="h-10 w-10 object-contain" draggable={false}
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
              <div>
                <div className="font-bold text-white">{c.display_name}</div>
                <div className="text-xs text-white/60">
                  Milestone {c.milestone_index} · {c.threshold_mp} MP · {c.rarity}
                  · {c.enabled ? 'enabled' : 'disabled'}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(rewardsByMilestone[c.id] ?? []).map((r, i) => (
                    <span key={i} className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">
                      +{r.amount} {r.reward_kind === 'currency' ? r.currency_code : r.item_id}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {canManage && (
              <button
                type="button" onClick={() => editingId === c.id ? setEditingId(null) : startEdit(c)}
                className="rounded bg-amber-500/20 px-3 py-1 text-sm text-amber-100 hover:bg-amber-500/30"
              >
                {editingId === c.id ? 'Close' : 'Edit'}
              </button>
            )}
          </div>

          {editingId === c.id && draftChest && (
            <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2">
              <Field label="Display name">
                <input
                  type="text" value={draftChest.display_name}
                  onChange={(e) => setDraftChest({ ...draftChest, display_name: e.target.value })}
                  className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                />
              </Field>
              <Field label="Threshold MP">
                <input
                  type="number" value={draftChest.threshold_mp}
                  onChange={(e) => setDraftChest({ ...draftChest, threshold_mp: Number(e.target.value) })}
                  className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                />
              </Field>
              <Field label="Rarity">
                <select
                  value={draftChest.rarity}
                  onChange={(e) => setDraftChest({ ...draftChest, rarity: e.target.value })}
                  className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                >
                  <option value="common">common</option>
                  <option value="rare">rare</option>
                  <option value="epic">epic</option>
                  <option value="legendary">legendary</option>
                </select>
              </Field>
              <Field label="Enabled">
                <label className="flex items-center gap-2 text-sm text-white">
                  <input
                    type="checkbox" checked={draftChest.enabled}
                    onChange={(e) => setDraftChest({ ...draftChest, enabled: e.target.checked })}
                  />
                  {draftChest.enabled ? 'Active' : 'Hidden'}
                </label>
              </Field>
              <div className="sm:col-span-2">
                <div className="mb-1 text-xs uppercase tracking-wider text-amber-100/70">Reward bundle</div>
                <RewardBundleEditor rows={draftRewards} onChange={setDraftRewards} disabled={!canManage} />
              </div>
              {error && <div className="rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200 sm:col-span-2">{error}</div>}
              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="button" disabled={saving} onClick={save}
                  className="flex-1 rounded bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Reroll pricing editor                                              */
/* ────────────────────────────────────────────────────────────────── */

function RerollEditor({ canManage }: { readonly canManage: boolean }) {
  const [ladder, setLadder] = useState<number[]>([]);
  const [dailyCap, setDailyCap] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await sb.from('reroll_pricing_config').select('*').eq('id', 'default').single();
    if (e) { setError(extractErrorMessage(e)); return; }
    setLadder(((data as { gem_cost_ladder?: number[] }).gem_cost_ladder ?? []).slice());
    setDailyCap((data as { daily_cap: number }).daily_cap);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: e } = await sb.from('reroll_pricing_config')
      .update({ gem_cost_ladder: ladder, daily_cap: dailyCap })
      .eq('id', 'default');
    setSaving(false);
    if (e) setError(extractErrorMessage(e));
    else await load();
  };

  return (
    <div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h3 className="mb-3 font-bold text-amber-100">Reroll pricing</h3>
      <p className="mb-3 text-xs text-white/60">
        Escalating gem cost per reroll. <code>ladder[i]</code> is the cost of the i-th reroll on a given day
        (0-indexed; ladder[0] should be 0 so the first reroll is free).
      </p>

      <div className="space-y-2">
        {ladder.map((cost, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-10 text-xs text-white/50">#{i + 1}</span>
            <input
              type="number" value={cost} disabled={!canManage}
              onChange={(e) => {
                const next = [...ladder]; next[i] = Number(e.target.value); setLadder(next);
              }}
              className="flex-1 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
            />
            <span className="text-xs text-white/50">gems</span>
            {canManage && (
              <button
                type="button"
                onClick={() => setLadder(ladder.filter((_, j) => j !== i))}
                className="rounded bg-rose-700/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-700/60"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {canManage && (
          <button
            type="button"
            onClick={() => setLadder([...ladder, 100])}
            className="rounded bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
          >
            + Add rung
          </button>
        )}
      </div>

      <div className="mt-4">
        <Field label="Daily cap (max rerolls per player per day)">
          <input
            type="number" value={dailyCap} disabled={!canManage}
            onChange={(e) => setDailyCap(Number(e.target.value))}
            className="w-32 rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          />
        </Field>
      </div>

      {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
      {canManage && (
        <button
          type="button" disabled={saving} onClick={save}
          className="mt-4 rounded bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save pricing'}
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Streak chest editor                                                */
/* ────────────────────────────────────────────────────────────────── */

function StreakEditor({ canManage }: { readonly canManage: boolean }) {
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await sb.from('streak_chest_rewards').select('*').order('display_order');
    if (e) { setError(extractErrorMessage(e)); return; }
    setRewards((data ?? []) as RewardRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: delErr } = await sb.from('streak_chest_rewards').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw delErr;
      if (rewards.length > 0) {
        const rows = rewards.map((r, i) => ({
          reward_kind: r.reward_kind,
          currency_code: r.reward_kind === 'currency' ? r.currency_code : null,
          item_table: r.reward_kind === 'item' ? r.item_table : null,
          item_id: r.reward_kind === 'item' ? r.item_id : null,
          amount: r.amount,
          display_order: r.display_order ?? i,
        }));
        const { error: insErr } = await sb.from('streak_chest_rewards').insert(rows);
        if (insErr) throw insErr;
      }
      await load();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <h3 className="mb-3 font-bold text-amber-100">7-Day Streak Chest contents</h3>
      <p className="mb-3 text-xs text-white/60">
        The single bundle awarded when a player claims the streak chest (after 7 consecutive days of completing
        all daily missions). Currency amounts add to wallet; item rewards drop into the player's inventory.
      </p>
      <RewardBundleEditor rows={rewards} onChange={setRewards} disabled={!canManage} />
      {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
      {canManage && (
        <button
          type="button" disabled={saving} onClick={save}
          className="mt-4 rounded bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save streak chest'}
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Dry-run preview (stub for v1; full impl is a fast-follow)          */
/* ────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────── */
/* Simulator tab — test-user builder + archetype-spawn + cleanup      */
/* ────────────────────────────────────────────────────────────────── */

interface TestProfileSummary {
  id: string;
  display_name: string;
  level: number;
  pvp_rating: number;
  created_at: string;
}

interface TestUserState {
  profile: { id: string; display_name: string; level: number; xp: number; pvp_rating: number };
  metrics: ReadonlyArray<{ metric_code: string; baseline_7d: number; tier: string | null }>;
  missions: ReadonlyArray<{
    id: string; title: string; rarity: string; period: string; mission_type: string;
    metric_code: string; resolution_mode: string; resolved_goal: number;
    mission_points: number;
    rewards: ReadonlyArray<{ currency_code: string | null; amount: number }>;
  }>;
}

/** Metrics the operator can author baselines for. The Phase 4
 *  triggers feed these for real users; for synthetic users we
 *  set them directly. */
const KNOWN_METRICS = [
  'matches_per_day',
  'coins_wagered_per_day',
  'coins_won_net_per_day',
  'xp_per_day',
  'gems_spent_per_day',
  'wheel_spins_per_day',
  'ranked_wins_per_week',
  'win_streak',
  'levels_per_week',
];

function SimulatorTab({ canManage }: { readonly canManage: boolean }) {
  const [profiles, setProfiles] = useState<TestProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<TestUserState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmUI } = useConfirm();

  // New-profile form
  const [newName, setNewName] = useState('');
  const [newLevel, setNewLevel] = useState(10);
  const [newRating, setNewRating] = useState(1200);

  // Archetype-spawn form
  const [casuals, setCasuals] = useState(5);
  const [regulars, setRegulars] = useState(5);
  const [whales, setWhales] = useState(3);

  const loadProfiles = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('simulate_list_test_profiles');
    if (e) { setError(extractErrorMessage(e)); return; }
    setProfiles(((data ?? []) as unknown) as TestProfileSummary[]);
  }, []);

  const loadState = useCallback(async (id: string) => {
    const { data, error: e } = await supabase.rpc('simulate_get_test_user_state', { p_profile_id: id });
    if (e) { setError(extractErrorMessage(e)); return; }
    setState(data as unknown as TestUserState);
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);
  useEffect(() => {
    if (selectedId) void loadState(selectedId);
    else setState(null);
  }, [selectedId, loadState]);

  const createProfile = async () => {
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const { data, error: e } = await supabase.rpc('simulate_create_test_profile', {
        p_display_name: newName.trim(),
        p_level: newLevel,
        p_pvp_rating: newRating,
      });
      if (e) throw e;
      setNewName('');
      await loadProfiles();
      setSelectedId(data as unknown as string);
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const setMetric = async (metric: string, baseline: number) => {
    if (!selectedId) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.rpc('simulate_set_metric', {
        p_profile_id: selectedId, p_metric_code: metric, p_baseline: baseline,
      });
      if (e) throw e;
      await loadState(selectedId);
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const reassign = async () => {
    if (!selectedId) return;
    setBusy(true); setError(null);
    try {
      const { error: rErr } = await supabase.rpc('simulate_reset_today_missions', { p_profile_id: selectedId });
      if (rErr) throw rErr;
      const { error: aErr } = await supabase.rpc('assign_daily_missions_for_profile', { p_profile_id: selectedId });
      if (aErr) throw aErr;
      await loadState(selectedId);
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const spawnArchetypes = async () => {
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.rpc('simulate_spawn_archetypes', {
        p_casuals: casuals, p_regulars: regulars, p_whales: whales,
      });
      if (e) throw e;
      await loadProfiles();
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const cleanupAll = async () => {
    if (!(await confirm({
      title: 'Delete all test profiles?',
      message: `Permanently removes all ${profiles.length} synthetic test profiles. This cannot be undone.`,
      confirmLabel: 'Delete all',
      tone: 'danger',
    }))) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.rpc('simulate_cleanup_all');
      if (e) throw e;
      setSelectedId(null);
      await loadProfiles();
    } catch (e) { setError(extractErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      {confirmUI}
      {/* Left column: profile list + new-profile form + bulk spawn */}
      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
          <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">Create test user</h4>
          <input
            type="text" placeholder="display name" value={newName}
            disabled={!canManage}
            onChange={(e) => setNewName(e.target.value)}
            className="mb-2 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
          />
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-white/60">
              Level
              <input
                type="number" value={newLevel} disabled={!canManage}
                onChange={(e) => setNewLevel(Number(e.target.value))}
                className="mt-0.5 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
            </label>
            <label className="text-xs text-white/60">
              pvp_rating
              <input
                type="number" value={newRating} disabled={!canManage}
                onChange={(e) => setNewRating(Number(e.target.value))}
                className="mt-0.5 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
            </label>
          </div>
          {canManage && (
            <button
              type="button" disabled={busy || !newName.trim()} onClick={createProfile}
              className="w-full rounded bg-emerald-600 py-1.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              + Create
            </button>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
          <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">Spawn archetypes (bulk)</h4>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {[
              { label: 'Casuals',  value: casuals,  set: setCasuals },
              { label: 'Regulars', value: regulars, set: setRegulars },
              { label: 'Whales',   value: whales,   set: setWhales },
            ].map((row) => (
              <label key={row.label} className="text-xs text-white/60">
                {row.label}
                <input
                  type="number" value={row.value} disabled={!canManage}
                  onChange={(e) => row.set(Number(e.target.value))}
                  className="mt-0.5 w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
                />
              </label>
            ))}
          </div>
          {canManage && (
            <button
              type="button" disabled={busy} onClick={spawnArchetypes}
              className="w-full rounded bg-amber-600 py-1.5 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              Spawn + assign + recompute
            </button>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.045]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-xs uppercase tracking-wider text-amber-100/70">Test users ({profiles.length})</span>
            {canManage && profiles.length > 0 && (
              <button
                type="button" disabled={busy} onClick={cleanupAll}
                className="rounded bg-rose-700/60 px-2 py-0.5 text-xs text-white hover:bg-rose-700"
              >
                Delete all
              </button>
            )}
          </div>
          <div className="max-h-[40vh] overflow-y-auto">
            {profiles.length === 0 ? (
              <div className="p-3 text-sm text-white/40">No synthetic profiles yet.</div>
            ) : (
              profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full items-center justify-between border-t border-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/[0.04] ${
                    selectedId === p.id ? 'bg-amber-500/10' : ''
                  }`}
                >
                  <span className="text-white">{p.display_name}</span>
                  <span className="text-xs text-white/50">L{p.level} · {p.pvp_rating}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right column: selected user detail */}
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        {!state ? (
          <p className="text-sm text-white/50">Select a test user, or create one to begin.</p>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-amber-100">{state.profile.display_name}</h3>
                <div className="text-xs text-white/50">
                  Level {state.profile.level} · pvp_rating {state.profile.pvp_rating} · {state.profile.xp} XP
                </div>
              </div>
              {canManage && (
                <button
                  type="button" disabled={busy} onClick={reassign}
                  className="rounded bg-amber-500 px-3 py-1.5 text-sm font-bold text-amber-950 hover:brightness-110 disabled:opacity-50"
                >
                  Reset & re-assign
                </button>
              )}
            </div>

            {/* Metrics editor */}
            <div className="mb-4">
              <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">
                Metric baselines (drives stretch resolution + tier)
              </h4>
              <div className="space-y-1.5">
                {KNOWN_METRICS.map((m) => {
                  const row = state.metrics.find((x) => x.metric_code === m);
                  return (
                    <MetricRow
                      key={m}
                      metric={m}
                      baseline={row?.baseline_7d ?? 0}
                      tier={row?.tier ?? null}
                      disabled={!canManage || busy}
                      onCommit={(v) => setMetric(m, v)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Currently-assigned missions */}
            <div>
              <h4 className="mb-2 text-xs uppercase tracking-wider text-amber-100/70">
                Active missions ({state.missions.length})
              </h4>
              {state.missions.length === 0 ? (
                <p className="text-sm text-white/40">No missions assigned — hit Reset &amp; re-assign.</p>
              ) : (
                <div className="space-y-2">
                  {state.missions.map((m) => (
                    <div key={m.id} className="rounded bg-black/30 p-2 ring-1 ring-white/5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{m.title}</span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                          m.rarity === 'epic' ? 'bg-fuchsia-700 text-white' :
                          m.rarity === 'rare' ? 'bg-sky-700 text-white' : 'bg-stone-700 text-white'
                        }`}>{m.rarity}{m.period === 'weekly' ? ' · weekly' : ''}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/60">
                        <span className="font-mono">{m.mission_type}</span>
                        <span>→ goal {m.resolved_goal} ({m.resolution_mode})</span>
                        <span>+{m.mission_points} MP</span>
                        {m.rewards.length > 0 && (
                          <span>
                            {m.rewards.map((r, i) => (
                              <span key={i} className="ml-1 rounded bg-white/10 px-1.5 py-0.5">
                                +{r.amount} {r.currency_code}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {error && <div className="mt-3 rounded bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{error}</div>}
      </div>
    </div>
  );
}

function MetricRow({
  metric, baseline, tier, disabled, onCommit,
}: {
  readonly metric: string; readonly baseline: number; readonly tier: string | null;
  readonly disabled?: boolean; readonly onCommit: (v: number) => void;
}) {
  const [val, setVal] = useState(String(baseline));
  useEffect(() => { setVal(String(baseline)); }, [baseline]);
  const tierColor =
    tier === 'whale' ? 'bg-fuchsia-700' :
    tier === 'regular' ? 'bg-sky-700' :
    tier === 'casual' ? 'bg-stone-700' : 'bg-black/40';
  return (
    <div className="flex items-center gap-2">
      <span className="w-44 font-mono text-xs text-white/60">{metric}</span>
      <input
        type="number" step="0.1" value={val} disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { const n = Number(val); if (!Number.isNaN(n) && n !== baseline) onCommit(n); }}
        className="w-24 rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
      />
      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${tierColor}`}>
        {tier ?? '—'}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Reusable: reward bundle editor + small Field wrapper + JSON field  */
/* ────────────────────────────────────────────────────────────────── */

function RewardBundleEditor({
  rows, onChange, disabled,
}: {
  readonly rows: readonly RewardRow[];
  readonly onChange: (rows: RewardRow[]) => void;
  readonly disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<RewardRow>) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, {
    reward_kind: 'currency', currency_code: 'coins',
    item_table: null, item_id: null,
    amount: 100, display_order: rows.length,
  }]);

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[auto_1fr_1fr_5rem_auto] items-center gap-2 rounded bg-black/30 p-2 ring-1 ring-white/5">
          <select
            value={r.reward_kind} disabled={disabled}
            onChange={(e) => update(i, { reward_kind: e.target.value as RewardRow['reward_kind'] })}
            className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
          >
            <option value="currency">Currency</option>
            <option value="item">Item</option>
          </select>
          {r.reward_kind === 'currency' ? (
            <>
              <select
                value={r.currency_code ?? 'coins'} disabled={disabled}
                onChange={(e) => update(i, { currency_code: e.target.value })}
                className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
              >
                <option value="coins">coins</option>
                <option value="gems">gems</option>
                <option value="xp">xp</option>
              </select>
              <span className="text-xs text-white/40">—</span>
            </>
          ) : (
            <>
              <input
                type="text" placeholder="item_table" value={r.item_table ?? ''} disabled={disabled}
                onChange={(e) => update(i, { item_table: e.target.value })}
                className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
              />
              <input
                type="text" placeholder="item_id" value={r.item_id ?? ''} disabled={disabled}
                onChange={(e) => update(i, { item_id: e.target.value })}
                className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
              />
            </>
          )}
          <input
            type="number" value={r.amount} disabled={disabled}
            onChange={(e) => update(i, { amount: Number(e.target.value) })}
            className="rounded bg-black/40 px-2 py-1 text-xs text-white ring-1 ring-white/10"
          />
          {!disabled && (
            <button
              type="button" onClick={() => remove(i)}
              className="rounded bg-rose-700/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-700/60"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button" onClick={add}
          className="rounded bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
        >
          + Add reward
        </button>
      )}
    </div>
  );
}

function Field({ label, children, wide = false }: { readonly label: string; readonly children: React.ReactNode; readonly wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/50">{label}</span>
      {children}
    </label>
  );
}

function JsonField({
  value, onChange, disabled,
}: {
  readonly value: Record<string, unknown>;
  readonly onChange: (v: Record<string, unknown>) => void;
  readonly disabled?: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setText(JSON.stringify(value, null, 2)); }, [value]);

  return (
    <div>
      <textarea
        rows={3}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value || '{}');
            setErr(null);
            onChange(parsed);
          } catch (er) {
            setErr((er as Error).message);
          }
        }}
        className="w-full rounded bg-black/40 px-2 py-1 font-mono text-xs text-white ring-1 ring-white/10"
      />
      {err && <div className="mt-0.5 text-[10px] text-rose-300">{err}</div>}
    </div>
  );
}
