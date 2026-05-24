import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { extractErrorMessage } from '../lib/errors';

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

type SubTab = 'templates' | 'chests' | 'reroll' | 'streak' | 'preview';

export function MissionsAdmin({ canManage }: Props) {
  const [tab, setTab] = useState<SubTab>('templates');

  const tabs: ReadonlyArray<{ readonly id: SubTab; readonly label: string }> = [
    { id: 'templates', label: 'Templates' },
    { id: 'chests',    label: 'Chests' },
    { id: 'reroll',    label: 'Reroll' },
    { id: 'streak',    label: 'Streak Chest' },
    { id: 'preview',   label: 'Dry-run preview' },
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

      {tab === 'templates' && <TemplatesEditor canManage={canManage} />}
      {tab === 'chests'    && <ChestsEditor canManage={canManage} />}
      {tab === 'reroll'    && <RerollEditor canManage={canManage} />}
      {tab === 'streak'    && <StreakEditor canManage={canManage} />}
      {tab === 'preview'   && <DryRunPreview />}
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
  resolution_mode: 'fixed' | 'stretch';
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
}

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
  const [rewardsByTemplate, setRewardsByTemplate] = useState<Record<string, RewardRow[]>>({});
  const [draft, setDraft] = useState<MissionTemplate | null>(null);
  const [draftRewards, setDraftRewards] = useState<RewardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterRarity, setFilterRarity] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');

  const load = useCallback(async () => {
    setError(null);
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

  const startEdit = (t: MissionTemplate | null) => {
    setError(null);
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
      // Clean up resolution-mode-specific fields so the check
      // constraint passes.
      if (payload.resolution_mode === 'fixed') {
        payload.stretch_factor = null;
      } else {
        payload.goal_value = null;
      }
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
    if (!window.confirm(`Delete template "${draft.title}"? This cannot be undone.`)) return;
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
                <th className="px-3 py-2 text-left">Metric</th>
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
                  <td className="px-3 py-2 font-mono text-xs text-white/60">{t.metric_code}</td>
                  <td className="px-3 py-2 text-right font-mono text-white/80">
                    {t.resolution_mode === 'fixed'
                      ? t.goal_value
                      : `×${t.stretch_factor} [${t.goal_min}..${t.goal_max}]`}
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
            </Field>
            <Field label="Mission type">
              <input
                type="text" value={draft.mission_type} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, mission_type: e.target.value })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm font-mono text-white ring-1 ring-white/10"
              />
            </Field>
            <Field label="Metric code">
              <input
                type="text" value={draft.metric_code} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, metric_code: e.target.value })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm font-mono text-white ring-1 ring-white/10"
              />
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
                <option value="stretch">Stretch</option>
              </select>
            </Field>
            <Field label="Mission points">
              <input
                type="number" value={draft.mission_points} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, mission_points: Number(e.target.value) })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
            </Field>
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
            <Field label="Icon URL">
              <input
                type="text" value={draft.icon_url ?? ''} disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, icon_url: e.target.value || null })}
                className="w-full rounded bg-black/40 px-2 py-1 text-sm text-white ring-1 ring-white/10"
              />
            </Field>
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

          {/* Reward bundle */}
          <div className="mt-4">
            <div className="mb-1 text-xs uppercase tracking-wider text-amber-100/70">Reward bundle</div>
            <RewardBundleEditor
              rows={draftRewards}
              onChange={setDraftRewards}
              disabled={!canManage}
            />
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
                  type="button" disabled={saving} onClick={remove}
                  className="rounded bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
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

function DryRunPreview() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/70">
      <h3 className="mb-2 font-bold text-amber-100">Dry-run preview</h3>
      <p className="mb-2">
        Coming as a Phase 7 fast-follow: pick any player by ID/handle, see what they'd be assigned today
        and why (rarity pool sizes, eligibility filter results, resolved goal math).
      </p>
      <p className="text-xs text-white/50">
        Until this lands, you can test on yourself: claim/reroll missions on your live account and watch the
        DB tables via Studio. The `assign_daily_missions_for_profile(uuid)` RPC is already callable directly
        from Studio for ad-hoc per-profile tests.
      </p>
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
