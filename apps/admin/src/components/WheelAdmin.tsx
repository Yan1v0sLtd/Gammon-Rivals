import { useCallback, useEffect, useMemo, useState } from 'react';
// Use the BO's independent admin session so wheel_configs /
// wheel_slots upserts run as the signed-in admin (the RLS policies
// gate writes on private.is_admin(auth.uid())). The regular
// `supabase` client is the game tab's session, which may be a
// different user or none at all.
import { adminSupabase as supabase } from '../lib/adminSupabase';
import {
  buildCurrencyRateMap,
  formatUsdMicros,
  usdMicrosFor,
  type CurrencyConfigRow,
} from '@shared/lib/currency';
import type { Database } from '@shared/types/database';
import ImageField from './ImageField';

type WheelConfigRow = Database['public']['Tables']['wheel_configs']['Row'];
type WheelSlotRow = Database['public']['Tables']['wheel_slots']['Row'];

/** The reward types spin_wheel knows how to credit. Adding a new
 *  one is a one-line CASE branch in the RPC + a new option here.
 *  Keeping it small for now — coins / gems / XP cover every slot
 *  in the default seed. */
const REWARD_TYPES = ['coins', 'gems', 'xp'] as const;
type RewardType = (typeof REWARD_TYPES)[number];

/** Accent slugs the WheelModal recognises (see ACCENT_PAIRS).
 *  Constraining the BO to this list avoids an operator typo
 *  shipping a wedge with no colour. */
const ACCENT_COLORS = ['gold', 'purple', 'red', 'green', 'blue', 'orange'] as const;

const SLOT_COUNT = 10;
const CONFIG_ID = 'main';

interface SlotDraft {
  primary_reward_type: RewardType;
  primary_reward_amount: string;
  primary_reward_icon_url: string;
  /** Empty string means "no secondary". UI exposes a toggle that
   *  flips this between '' and a real type. */
  secondary_reward_type: RewardType | '';
  secondary_reward_amount: string;
  secondary_reward_icon_url: string;
  /** Chance as a percentage string with up to 2 decimal places.
   *  Converted to integer basis points (0..10000) on save. */
  chance_percent: string;
  label: string;
  accent_color: (typeof ACCENT_COLORS)[number];
  is_enabled: boolean;
}

interface ConfigDraft {
  cooldown_seconds: string;
  is_enabled: boolean;
}

interface Props {
  readonly canManage: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Convert a stored slot row into the BO draft shape. */
function slotToDraft(row: WheelSlotRow | undefined): SlotDraft {
  return {
    primary_reward_type:
      (row?.primary_reward_type as RewardType) ?? 'coins',
    primary_reward_amount: row?.primary_reward_amount?.toString() ?? '0',
    primary_reward_icon_url: row?.primary_reward_icon_url ?? '',
    secondary_reward_type:
      (row?.secondary_reward_type as RewardType | null) ?? '',
    secondary_reward_amount: row?.secondary_reward_amount?.toString() ?? '0',
    secondary_reward_icon_url: row?.secondary_reward_icon_url ?? '',
    chance_percent: row
      ? (row.chance_basis_points / 100).toFixed(2)
      : '0',
    label: row?.label ?? '',
    accent_color:
      (row?.accent_color as (typeof ACCENT_COLORS)[number]) ?? 'gold',
    is_enabled: row?.is_enabled ?? true,
  };
}

function configToDraft(row: WheelConfigRow | null): ConfigDraft {
  return {
    cooldown_seconds: row?.cooldown_seconds?.toString() ?? '3600',
    is_enabled: row?.is_enabled ?? true,
  };
}

/** Default icon URL per reward type so operators don't have to
 *  re-upload the standard coin / gem / XP glyph for every slot. */
function defaultIconFor(type: RewardType): string {
  switch (type) {
    case 'coins':
      return '/lobby/icons/gold-coin.webp';
    case 'gems':
      return '/lobby/icons/gem.webp';
    case 'xp':
      // No webp asset exists; the wheel renders the inline hex
      // for type === 'xp' regardless of icon_url. Storing an empty
      // string keeps the DB honest.
      return '';
  }
}

/** Parse a percent string like "25.5" into basis points (2550).
 *  Throws on values outside 0..100 or with too many decimals so
 *  the operator gets a clear error before the upsert fires. */
function percentToBasisPoints(percent: string, fieldLabel: string): number {
  const trimmed = percent.trim();
  if (!trimmed) throw new Error(`${fieldLabel} is required.`);
  const n = Number(trimmed);
  if (!Number.isFinite(n)) throw new Error(`${fieldLabel} must be a number.`);
  if (n < 0 || n > 100) {
    throw new Error(`${fieldLabel} must be between 0 and 100.`);
  }
  // Round to nearest basis point so 25.555 doesn't silently drift.
  return Math.round(n * 100);
}

function requireNonNegInt(value: string, fieldLabel: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${fieldLabel} is required.`);
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldLabel} must be a non-negative integer.`);
  }
  return n;
}

/** Format basis points as a percent string with 2 decimals. */
function formatPercent(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
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
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      {label}
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50"
      />
    </label>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly T[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition focus:border-amber-200/60 disabled:opacity-50"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
      <span>{label}</span>
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-amber-200/40 bg-amber-200/15 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-amber-100 transition hover:bg-amber-200/25 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/70 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function WheelAdmin({ canManage }: Props) {
  const [config, setConfig] = useState<WheelConfigRow | null>(null);
  const [slots, setSlots] = useState<WheelSlotRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyConfigRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(() => configToDraft(null));
  const [slotDraft, setSlotDraft] = useState<SlotDraft>(() => slotToDraft(undefined));
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setErrFromUnknown = useCallback((err: unknown) => {
    if (err instanceof Error) setError(err.message);
    else if (err && typeof err === 'object' && 'message' in err) {
      setError(String((err as { message: unknown }).message));
    } else setError(String(err));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, sl, cur] = await Promise.all([
        supabase.from('wheel_configs').select('*').eq('id', CONFIG_ID).maybeSingle(),
        supabase
          .from('wheel_slots')
          .select('*')
          .eq('config_id', CONFIG_ID)
          .order('slot_index', { ascending: true }),
        supabase.from('currency_configs').select('*'),
      ]);
      if (cfg.error) throw cfg.error;
      if (sl.error) throw sl.error;
      if (cur.error) throw cur.error;
      setConfig(cfg.data ?? null);
      setConfigDraft(configToDraft(cfg.data ?? null));
      setSlots(sl.data ?? []);
      setCurrencies(cur.data ?? []);
    } catch (err) {
      setErrFromUnknown(err);
    } finally {
      setLoading(false);
    }
  }, [setErrFromUnknown]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Re-sync the slot draft whenever the user picks a different slot,
  // or when the underlying row changes (e.g. after a save).
  useEffect(() => {
    const row = slots.find((s) => s.slot_index === selectedIndex);
    setSlotDraft(slotToDraft(row));
  }, [selectedIndex, slots]);

  /** Sum of chance_basis_points across ENABLED slots, in real
   *  basis points (max 10000). Disabled slots contribute zero —
   *  matches the server's sum check in spin_wheel. */
  const totalBasisPoints = useMemo(() => {
    return slots.reduce(
      (acc, s) => (s.is_enabled ? acc + s.chance_basis_points : acc),
      0
    );
  }, [slots]);

  const totalIsValid = totalBasisPoints === 10000;

  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies]);

  /** Raw USD value of a slot's combined reward (primary + secondary) in
   *  micros. Doesn't account for chance — that's the EV-per-spin
   *  footer's job. XP and any currency not in currency_configs return 0
   *  by design (we don't price progression metrics). */
  const slotValueMicros = useCallback(
    (row: WheelSlotRow | undefined): number => {
      if (!row) return 0;
      return (
        usdMicrosFor(rateMap, row.primary_reward_type, row.primary_reward_amount) +
        usdMicrosFor(rateMap, row.secondary_reward_type, row.secondary_reward_amount)
      );
    },
    [rateMap]
  );

  /** Probability-weighted EV per spin in micros. Sum over ENABLED slots
   *  of (slot_value × chance_basis_points / 10000). This is the number
   *  the operator should tune the wheel against — it's the expected $
   *  the house pays out every time a player spins. */
  const evPerSpinMicros = useMemo(() => {
    return slots.reduce((acc, row) => {
      if (!row.is_enabled) return acc;
      return acc + (slotValueMicros(row) * row.chance_basis_points) / 10000;
    }, 0);
  }, [slots, slotValueMicros]);

  const saveConfig = async () => {
    if (!canManage) return;
    setSavingKey('config');
    setError(null);
    try {
      const cooldown = requireNonNegInt(configDraft.cooldown_seconds, 'Cooldown seconds');
      if (cooldown < 300 || cooldown > 604800) {
        throw new Error('Cooldown must be between 300 (5 min) and 604800 (7 d) seconds.');
      }
      const { error: err } = await supabase
        .from('wheel_configs')
        .upsert(
          {
            id: CONFIG_ID,
            display_name: config?.display_name ?? 'Hourly Bonus',
            cooldown_seconds: cooldown,
            is_enabled: configDraft.is_enabled,
          },
          { onConflict: 'id' }
        );
      if (err) throw err;
      await loadAll();
    } catch (err) {
      setErrFromUnknown(err);
    } finally {
      setSavingKey(null);
    }
  };

  const saveSlot = async () => {
    if (!canManage) return;
    setSavingKey('slot');
    setError(null);
    try {
      const primaryAmount = requireNonNegInt(
        slotDraft.primary_reward_amount,
        'Primary reward amount'
      );
      const chanceBp = percentToBasisPoints(slotDraft.chance_percent, 'Chance %');
      const hasSecondary = slotDraft.secondary_reward_type !== '';
      const secondaryAmount = hasSecondary
        ? requireNonNegInt(slotDraft.secondary_reward_amount, 'Secondary reward amount')
        : null;

      const payload: Database['public']['Tables']['wheel_slots']['Insert'] = {
        config_id: CONFIG_ID,
        slot_index: selectedIndex,
        primary_reward_type: slotDraft.primary_reward_type,
        primary_reward_amount: primaryAmount,
        primary_reward_icon_url: slotDraft.primary_reward_icon_url || null,
        secondary_reward_type: hasSecondary ? slotDraft.secondary_reward_type : null,
        secondary_reward_amount: secondaryAmount,
        secondary_reward_icon_url:
          hasSecondary && slotDraft.secondary_reward_icon_url
            ? slotDraft.secondary_reward_icon_url
            : null,
        chance_basis_points: chanceBp,
        label: slotDraft.label || null,
        accent_color: slotDraft.accent_color,
        is_enabled: slotDraft.is_enabled,
      };

      const { error: err } = await supabase
        .from('wheel_slots')
        .upsert(payload, { onConflict: 'config_id,slot_index' });
      if (err) throw err;
      await loadAll();
    } catch (err) {
      setErrFromUnknown(err);
    } finally {
      setSavingKey(null);
    }
  };

  // When the operator changes the reward TYPE on either reward, swap
  // the icon_url over to that type's default ONLY when the existing
  // url is empty or matches another type's default. Custom uploads
  // (a public URL the operator pasted) are preserved.
  const isStockIcon = (url: string): boolean => {
    return (
      url === '' ||
      url === '/lobby/icons/gold-coin.webp' ||
      url === '/lobby/icons/gem.webp'
    );
  };

  const setPrimaryType = (next: RewardType) => {
    setSlotDraft((d) => ({
      ...d,
      primary_reward_type: next,
      primary_reward_icon_url: isStockIcon(d.primary_reward_icon_url)
        ? defaultIconFor(next)
        : d.primary_reward_icon_url,
    }));
  };

  const setSecondaryType = (next: RewardType | '') => {
    setSlotDraft((d) => {
      if (next === '') {
        return {
          ...d,
          secondary_reward_type: '',
          secondary_reward_amount: '0',
          secondary_reward_icon_url: '',
        };
      }
      return {
        ...d,
        secondary_reward_type: next,
        secondary_reward_icon_url: isStockIcon(d.secondary_reward_icon_url)
          ? defaultIconFor(next)
          : d.secondary_reward_icon_url,
      };
    });
  };

  const hasSecondary = slotDraft.secondary_reward_type !== '';

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-6 text-sm text-white/55">
        Loading wheel configuration…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ============================================================
            Header: config + live total
         ============================================================ */}
      <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[8rem]">
            <Field
              label="Cooldown (sec)"
              value={configDraft.cooldown_seconds}
              onChange={(cooldown_seconds) =>
                setConfigDraft((d) => ({ ...d, cooldown_seconds }))
              }
              disabled={!canManage}
            />
            <div className="mt-1 text-[10px] normal-case tracking-normal text-white/35">
              Range: 300 (5 min) – 604800 (7 d).
            </div>
          </div>
          <div>
            <Toggle
              label="Wheel enabled"
              checked={configDraft.is_enabled}
              onChange={(is_enabled) =>
                setConfigDraft((d) => ({ ...d, is_enabled }))
              }
              disabled={!canManage}
            />
          </div>
          <div className="flex-1" />
          <div className="flex flex-col items-end gap-1">
            <div
              className={`rounded-lg border px-4 py-2 font-display text-2xl font-black ${
                totalIsValid
                  ? 'border-emerald-300/50 bg-emerald-300/15 text-emerald-200'
                  : 'border-rose-400/50 bg-rose-400/15 text-rose-200'
              }`}
            >
              Total: {formatPercent(totalBasisPoints)}
            </div>
            <div className="text-[10px] normal-case tracking-normal text-white/45">
              {totalIsValid
                ? 'Wheel will spin normally.'
                : 'Must equal 100.00% — wheel will fail with wheel_misconfigured.'}
            </div>
          </div>
          <PrimaryButton
            onClick={() => void saveConfig()}
            disabled={!canManage || savingKey === 'config'}
          >
            Save config
          </PrimaryButton>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-300/40 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-100">
          {error}
        </div>
      ) : null}

      {/* ============================================================
            Slots: list (left) + editor (right)
         ============================================================ */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]">
        {/* Slot list */}
        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h2 className="text-lg font-black">Slots</h2>
          <p className="mt-1 text-xs text-white/55">
            10 slots, fixed order. Click a row to edit. Disabled slots
            are skipped by spin_wheel and don't count toward the
            100.00% total.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.14em] text-white/45">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Reward</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Accent</th>
                  <th className="px-3 py-2 text-right">Chance</th>
                  <th className="px-3 py-2 text-right">$ Value</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                  const row = slots.find((s) => s.slot_index === i);
                  const isSelected = i === selectedIndex;
                  const rowMicros = slotValueMicros(row);
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelectedIndex(i)}
                      className={`cursor-pointer border-t border-white/5 transition ${
                        isSelected
                          ? 'bg-amber-200/15 text-amber-100'
                          : 'hover:bg-white/[0.04]'
                      } ${row?.is_enabled === false ? 'opacity-50' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{i}</td>
                      <td className="px-3 py-2">
                        {row ? (
                          <>
                            {row.primary_reward_amount}{' '}
                            {row.primary_reward_type}
                            {row.secondary_reward_type ? (
                              <span className="text-white/55">
                                {' '}
                                + {row.secondary_reward_amount}{' '}
                                {row.secondary_reward_type}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-white/30">empty</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-white/70">
                        {row?.label ?? <span className="text-white/30">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row?.accent_color ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {row ? formatPercent(row.chance_basis_points) : '0.00%'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-emerald-200/85">
                        {row ? formatUsdMicros(rowMicros) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-white/[0.04] text-[10px] uppercase tracking-[0.14em] text-white/55">
                <tr className="border-t border-white/10">
                  <td className="px-3 py-2 font-black" colSpan={4}>
                    EV per spin
                  </td>
                  <td className="px-3 py-2 text-right font-mono normal-case text-white/65">
                    {formatPercent(totalBasisPoints)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono normal-case text-emerald-100">
                    {formatUsdMicros(evPerSpinMicros, { precision: 4 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[10px] normal-case tracking-normal text-white/40">
            $ Value is the raw worth of each slot's reward (primary +
            secondary) at the rates configured in the Currencies section.
            XP and any unpriced currency contribute $0. EV per spin is the
            probability-weighted average: Σ (slot value × chance) over
            enabled slots — the expected $ paid out per spin.
          </p>
        </div>

        {/* Slot editor */}
        <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
          <h2 className="text-lg font-black">Edit slot #{selectedIndex}</h2>
          <p className="mt-1 text-xs text-white/55">
            Per-slot save. Label is shown in the spin RPC's response
            (used in the wallet_transactions ledger note) but does NOT
            appear on the wedge itself — the wedge always shows icon +
            amount stacked radially.
          </p>

          {/* Top row: label / accent / chance / enabled */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field
              label="Label (optional)"
              value={slotDraft.label}
              onChange={(label) => setSlotDraft((d) => ({ ...d, label }))}
              disabled={!canManage}
              placeholder="e.g. JACKPOT"
            />
            <Select
              label="Accent colour"
              value={slotDraft.accent_color}
              options={ACCENT_COLORS}
              onChange={(accent_color) =>
                setSlotDraft((d) => ({ ...d, accent_color }))
              }
              disabled={!canManage}
            />
            <Field
              label="Chance %"
              value={slotDraft.chance_percent}
              onChange={(chance_percent) =>
                setSlotDraft((d) => ({ ...d, chance_percent }))
              }
              disabled={!canManage}
              placeholder="0.00"
            />
            <div className="self-end pb-2">
              <Toggle
                label="Slot enabled"
                checked={slotDraft.is_enabled}
                onChange={(is_enabled) =>
                  setSlotDraft((d) => ({ ...d, is_enabled }))
                }
                disabled={!canManage}
              />
            </div>
          </div>

          {/* Primary reward */}
          <div className="mt-4 rounded-lg border border-white/10 bg-black/15 p-3">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-white/65">
              Primary reward
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select
                label="Type"
                value={slotDraft.primary_reward_type}
                options={REWARD_TYPES}
                onChange={setPrimaryType}
                disabled={!canManage}
              />
              <Field
                label="Amount"
                value={slotDraft.primary_reward_amount}
                onChange={(primary_reward_amount) =>
                  setSlotDraft((d) => ({ ...d, primary_reward_amount }))
                }
                disabled={!canManage}
              />
            </div>
            <div className="mt-3">
              <ImageField
                label="Icon"
                value={slotDraft.primary_reward_icon_url}
                onChange={(primary_reward_icon_url) =>
                  setSlotDraft((d) => ({ ...d, primary_reward_icon_url }))
                }
                folder="wheel"
                kind={`slot-${selectedIndex}-primary`}
                disabled={!canManage}
              />
              {slotDraft.primary_reward_type === 'xp' ? (
                <div className="mt-1 text-[10px] normal-case tracking-normal text-white/45">
                  Note: XP slots always render the inline hex glyph on
                  the wheel regardless of icon_url — no XP asset needs
                  to be uploaded.
                </div>
              ) : null}
            </div>
          </div>

          {/* Secondary reward (combo slot) */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/15 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-white/65">
                Secondary reward {hasSecondary ? '' : '(optional)'}
              </div>
              {hasSecondary ? (
                <button
                  type="button"
                  onClick={() => setSecondaryType('')}
                  disabled={!canManage}
                  className="rounded border border-white/15 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-white/60 transition hover:border-rose-300/40 hover:text-rose-200 disabled:opacity-50"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSecondaryType('coins')}
                  disabled={!canManage}
                  className="rounded border border-amber-200/40 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-amber-100/85 transition hover:bg-amber-200/15 disabled:opacity-50"
                >
                  Add second reward
                </button>
              )}
            </div>
            {hasSecondary ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Select
                    label="Type"
                    value={slotDraft.secondary_reward_type as RewardType}
                    options={REWARD_TYPES}
                    onChange={(t) => setSecondaryType(t)}
                    disabled={!canManage}
                  />
                  <Field
                    label="Amount"
                    value={slotDraft.secondary_reward_amount}
                    onChange={(secondary_reward_amount) =>
                      setSlotDraft((d) => ({ ...d, secondary_reward_amount }))
                    }
                    disabled={!canManage}
                  />
                </div>
                <div className="mt-3">
                  <ImageField
                    label="Icon"
                    value={slotDraft.secondary_reward_icon_url}
                    onChange={(secondary_reward_icon_url) =>
                      setSlotDraft((d) => ({ ...d, secondary_reward_icon_url }))
                    }
                    folder="wheel"
                    kind={`slot-${selectedIndex}-secondary`}
                    disabled={!canManage}
                  />
                </div>
              </>
            ) : null}
          </div>

          {/* Save / reset */}
          <div className="mt-4 flex gap-2">
            <PrimaryButton
              onClick={() => void saveSlot()}
              disabled={!canManage || savingKey === 'slot'}
            >
              Save slot #{selectedIndex}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                const row = slots.find((s) => s.slot_index === selectedIndex);
                setSlotDraft(slotToDraft(row));
              }}
            >
              Discard edits
            </SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
