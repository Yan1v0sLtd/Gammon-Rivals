import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnlineUsersWatcher } from '../lib/useOnlineUsersWatcher';
import { Link } from 'react-router-dom';
// The BO uses its own independent Supabase session (adminSupabase) so
// the operator can be signed in as admin here while the game tab is
// running as a guest or a different account. Aliased to `supabase`
// + `isSupabaseConfigured` so the rest of the file (30+ call sites)
// keeps working unchanged.
import {
  adminSupabase as supabase,
  isAdminSupabaseConfigured as isSupabaseConfigured,
} from '../lib/adminSupabase';
import { useAdminAuth } from '../lib/adminAuth';
import {
  buildCurrencyRateMap,
  formatUsdMicros,
  usdMicrosFor,
  type CurrencyConfigRow,
} from '../lib/currency';
import type { Database, Json } from '../types/database';
import ImageField from '../admin/ImageField';
import FeltCornersField from '../admin/FeltCornersField';
import BearOffTraysField from '../admin/BearOffTraysField';
import BoardTuningField from '../admin/BoardTuningField';
import BoardPreview from '../admin/BoardPreview';
import { WheelAdmin } from '../admin/WheelAdmin';
import { LevelCurveProposal } from '../admin/LevelCurveProposal';
import { MissionsAdmin } from '../admin/MissionsAdmin';
import { resolveStatusLabel } from '../lib/progression';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AdminRoleRow = Database['public']['Tables']['admin_roles']['Row'];
type AdminEmailRoleRow = Database['public']['Tables']['admin_email_allowlist']['Row'];
type AdminRole = AdminRoleRow['role'];
type LevelConfig = Database['public']['Tables']['level_configs']['Row'];
type LevelStatusTier = Database['public']['Tables']['level_status_tiers']['Row'];
/**
 * Editable per-row state for the Status Tiers panel. We keep `id`
 * nullable so a brand-new row (not yet inserted) can sit alongside
 * existing ones in the same draft array. All numeric fields are
 * stored as strings so the inputs can be empty mid-edit without
 * blanking the form state.
 */
type LevelStatusTierDraft = {
  id: string | null;
  level_from: string;
  level_to: string;
  label: string;
  sort_order: string;
  is_enabled: boolean;
};
/**
 * Number of rows shown at once in the Levels table. The curve can
 * easily hit 100+ levels, so we paginate to keep the BO scrollable.
 * 'all' is the escape hatch for spreadsheet-style scanning.
 */
type LevelsPageSize = 25 | 50 | 100 | 'all';
type EconomyGrant = Database['public']['Tables']['economy_grants']['Row'];
/**
 * Editable form state for one economy-grant rule. Numeric fields are
 * strings so inputs can be cleared mid-edit. `isNew` distinguishes a
 * brand-new rule (whose trigger_key is still editable) from an
 * existing one (whose key is the immutable PK).
 */
type EconomyGrantDraft = {
  trigger_key: string;
  display_name: string;
  description: string;
  coins: string;
  gems: string;
  one_time: boolean;
  is_enabled: boolean;
  sort_order: string;
  isNew: boolean;
};
type DailyBonusConfig = Database['public']['Tables']['daily_bonus_configs']['Row'];
type TableConfig = Database['public']['Tables']['table_configs']['Row'];
type BoardThemeConfig = Database['public']['Tables']['board_theme_configs']['Row'];
type PodiumImage = Database['public']['Tables']['podium_images']['Row'];
type AuditEntry = Database['public']['Tables']['admin_audit_log']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];
type WalletTransaction = Database['public']['Tables']['wallet_transactions']['Row'];
type UserBoardInventory = Database['public']['Tables']['user_board_inventory']['Row'];
type Purchase = Database['public']['Tables']['purchases']['Row'];
type ShopItem = Database['public']['Tables']['shop_items']['Row'];
type ShopKind = ShopItem['kind'];

type AccessState = 'checking' | 'missing-config' | 'migration-missing' | 'denied' | 'allowed';

// Mirrors the DB check constraint on board_theme_configs.id so the
// admin sees a clear inline error instead of a Postgres round-trip
// failure when adding a board.
const BOARD_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
function isValidBoardId(id: string): boolean {
  return BOARD_ID_REGEX.test(id);
}
type Section =
  | 'Dashboard'
  | 'Users'
  | 'Currencies'
  | 'Economy Grants'
  | 'Level System'
  | 'Daily Bonus'
  | 'Hourly Wheel'
  | 'Daily Missions'
  | 'Tables / Rooms'
  | 'Difficulties'
  | 'RTP Analytics'
  | 'Board Themes'
  | 'Lobby Features'
  | 'Shop'
  | 'Admin Access';

interface AdminStats {
  users: number;
  matches: number;
  activeMatches: number;
  configItems: number;
  shopItems: number;
  suspendedUsers: number;
}

interface AdminUser extends ProfileRow {
  wallet?: UserWallet;
}

interface UserDetail {
  wallet: UserWallet | null;
  transactions: WalletTransaction[];
  boards: UserBoardInventory[];
  purchases: Purchase[];
  matches: Database['public']['Tables']['matches']['Row'][];
}

type LevelDraft = {
  level: string;
  xp_required: string;
  status_label: string;
  reward_coins: string;
  reward_gems: string;
  reward_items: string;
  unlock_rules: string;
  is_enabled: boolean;
};

type DailyBonusDraft = {
  day: string;
  reward_coins: string;
  reward_gems: string;
  reward_xp: string;
  reward_items: string;
};

type TableDraft = {
  id: string;
  kind: 'standard' | 'difficulty';
  display_name: string;
  description: string;
  entry_fee_coins: string;
  prize_coins: string;
  prize_coins_loss: string;
  required_level: string;
  match_target: string;
  allow_ai: boolean;
  allow_online: boolean;
  is_enabled: boolean;
  sort_order: string;
  xp_multiplier_pct: string;
  base_xp_win: string;
  turn_seconds: string;
  accent_color: string;
  ai_level: 'easy' | 'medium' | 'hard';
  target_rtp_pct: string;
  metadata: string;
};

type BoardDraft = {
  id: string;
  display_name: string;
  preview_image: string;
  gameplay_image: string;
  lobby_background_image: string;
  gameplay_background_image: string;
  white_checker_image: string;
  black_checker_image: string;
  dice_image: string;
  tray_image: string;
  holder_image: string;
  unlock_level: string;
  price_coins: string;
  price_gems: string;
  is_enabled: boolean;
  is_featured: boolean;
  sort_order: string;
  metadata: string;
};

type ShopDraft = {
  id: string;
  kind: ShopKind;
  display_name: string;
  description: string;
  image_url: string;
  price_cents: string;
  price_coins: string;
  price_gems: string;
  apple_product_id: string;
  google_product_id: string;
  contents: string;
  visibility_rules: string;
  starts_at: string;
  ends_at: string;
  max_purchases_per_user: string;
  is_enabled: boolean;
  sort_order: string;
};

type CurrencyDraft = {
  code: string;
  display_name: string;
  // USD value of one unit, as a free-text decimal string. Converted to
  // micros (USD × 1_000_000) on save so the operator can type e.g.
  // "0.01" without thinking about the storage representation.
  usd_value: string;
  is_enabled: boolean;
  sort_order: string;
};

const sections: readonly Section[] = [
  'Dashboard',
  'Users',
  'Currencies',
  'Economy Grants',
  'Level System',
  'Daily Bonus',
  'Hourly Wheel',
  'Daily Missions',
  'Tables / Rooms',
  'Difficulties',
  'RTP Analytics',
  'Board Themes',
  'Lobby Features',
  'Shop',
  'Admin Access',
];

/**
 * Time-range presets for the RTP dashboard. `since` is the actual
 * timestamp (relative to "now" at click time) that we send to the
 * get_rtp_summary RPC. null = all time.
 */
const RTP_RANGES: ReadonlyArray<{ id: string; label: string; hours: number | null }> = [
  { id: '24h', label: 'Last 24h', hours: 24 },
  { id: '7d', label: 'Last 7d', hours: 24 * 7 },
  { id: '30d', label: 'Last 30d', hours: 24 * 30 },
  { id: 'all', label: 'All time', hours: null },
];

/**
 * Shape returned by public.get_rtp_summary. Column names are prefixed
 * with `out_` server-side to dodge an OUT-parameter / table-column
 * naming collision in plpgsql — that prefix is what the client sees,
 * so it's preserved here. See migration 20260604_rtp_summary_rpc.sql.
 */
interface RtpRow {
  out_table_config_id: string;
  out_display_name: string;
  out_target_rtp_pct: number;
  out_matches_played: number;
  out_matches_won: number;
  out_actual_win_rate_pct: number | null;
  out_coins_wagered: number;
  out_coins_paid_out: number;
  out_coins_house_net: number;
  out_actual_rtp_pct: number | null;
  out_rtp_delta_pct: number | null;
  out_risk_free_count: number;
}

interface RtpPerPlayerRow {
  out_profile_id: string;
  out_display_name: string;
  out_matches_played: number;
  out_matches_won: number;
  out_win_rate_pct: number | null;
  out_coins_wagered: number;
  out_coins_paid_out: number;
  out_coins_house_net: number;
  out_actual_rtp_pct: number | null;
}

/** Accent slugs the DifficultyModal recognises. The BO dropdown is
 *  scoped to these so an operator can't accidentally set an unknown
 *  slug and ship a card with no colour. */
const difficultyAccentColors: readonly string[] = ['green', 'blue', 'purple', 'red', 'gold'];

const shopKinds: readonly ShopKind[] = [
  'coin_pack',
  'gem_pack',
  'board_theme',
  'cosmetic',
  'bundle',
  'special_offer',
];

const roleOptions: readonly AdminRole[] = ['owner', 'admin', 'support', 'viewer'];

const builtInBoardSeeds: readonly Database['public']['Tables']['board_theme_configs']['Insert'][] = [
  {
    id: 'classic-green',
    display_name: 'Classic Green',
    preview_image: '/lobby/board-previews/classic-green.webp',
    gameplay_image: '/themes/classic-green/board.webp',
    lobby_background_image: '/lobby/backgrounds/classic-green.webp',
    unlock_level: 1,
    price_coins: 0,
    is_enabled: true,
    is_featured: true,
    sort_order: 10,
    metadata: {
      accent: '#6dda72',
      subtitle: 'Traditional felt',
      gameplayBackgroundImage: '/lobby/backgrounds/classic-green.webp',
    },
  },
  {
    id: 'ocean-blue',
    display_name: 'Ocean Blue',
    preview_image: '/lobby/board-previews/ocean-blue.webp',
    gameplay_image: '/themes/ocean-blue/board.webp',
    lobby_background_image: '/lobby/backgrounds/ocean-blue.webp',
    unlock_level: 5,
    price_coins: 1500,
    is_enabled: true,
    is_featured: false,
    sort_order: 20,
    metadata: {
      accent: '#39d7ff',
      subtitle: 'Bright coastal wood',
      gameplayBackgroundImage: '/lobby/backgrounds/ocean-blue.webp',
    },
  },
  {
    id: 'royal-purple',
    display_name: 'Royal Purple',
    preview_image: '/lobby/board-previews/royal-purple.webp',
    gameplay_image: '/themes/royal-purple/board.webp',
    lobby_background_image: '/lobby/backgrounds/royal-purple.webp',
    unlock_level: 10,
    price_coins: 5000,
    is_enabled: true,
    is_featured: false,
    sort_order: 30,
    metadata: {
      accent: '#c174ff',
      subtitle: 'Gold tournament trim',
      gameplayBackgroundImage: '/lobby/backgrounds/royal-purple.webp',
    },
  },
];

const initialStats: AdminStats = {
  users: 0,
  matches: 0,
  activeMatches: 0,
  configItems: 0,
  shopItems: 0,
  suspendedUsers: 0,
};

function isMissingMigrationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.message?.includes('Could not find the function') === true ||
    error.message?.includes('Could not find the table') === true ||
    error.message?.includes('relation') === true ||
    error.message?.includes('column') === true
  );
}

function isPolicyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === '42501' || maybeError.message?.toLowerCase().includes('row-level security') === true;
}

function withRequestTimeout<T>(request: PromiseLike<T>, label: string, timeoutMs = 12000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} is taking too long. Please refresh and try again.`));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function accountType(row: ProfileRow): 'Google' | 'Guest' | 'Test/Unknown' {
  if (row.is_guest) return 'Guest';
  if (row.avatar_url) return 'Google';
  return 'Test/Unknown';
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  const message = maybeError.message?.toLowerCase() ?? '';
  const normalizedColumnName = columnName.toLowerCase();
  return (
    message.includes(normalizedColumnName) &&
    (maybeError.code === '42703' ||
      maybeError.code === 'PGRST204' ||
      message.includes('schema cache') ||
      message.includes('could not find'))
  );
}

function isMissingAnyColumnError(error: unknown, columnNames: readonly string[]): boolean {
  return columnNames.some((columnName) => isMissingColumnError(error, columnName));
}

function isDeletedProfile(row: ProfileRow): boolean {
  return (
    Boolean(row.deleted_at) ||
    row.suspension_reason === 'Deleted in Back Office' ||
    row.admin_note?.includes('[Deleted in Back Office]') === true
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function moneyFromCents(value: number | null): string {
  if (value === null) return 'Free';
  return `$${(value / 100).toFixed(2)}`;
}

function jsonToString(value: Json | null | undefined, fallback = '{}'): string {
  if (value === null || value === undefined) return fallback;
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string, label: string, expected: 'object' | 'array'): Json {
  try {
    const parsed = JSON.parse(value || (expected === 'array' ? '[]' : '{}'));
    if (expected === 'array' && !Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`);
    }
    if (expected === 'object' && (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as Json;
  } catch (err) {
    if (err instanceof Error && err.message.includes('must be')) throw err;
    throw new Error(`${label} is not valid JSON.`, { cause: err });
  }
}

function metadataText(metadata: Json | null | undefined, key: string): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

function withGameplayBackgroundMetadata(metadata: Json, value: string): Json {
  const source =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {};
  const next: Record<string, Json> = {};
  Object.entries(source).forEach(([key, metadataValue]) => {
    if (metadataValue !== undefined) next[key] = metadataValue;
  });
  const trimmed = value.trim();
  if (trimmed) {
    next.gameplayBackgroundImage = trimmed;
  } else {
    delete next.gameplayBackgroundImage;
  }
  return next;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Number field is invalid.');
  return parsed;
}

function requiredNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[4.75rem] items-center justify-center rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${
        enabled
          ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30'
          : 'bg-rose-400/15 text-rose-200 ring-1 ring-rose-300/30'
      }`}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/45">
      {text}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  rows?: number;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      {label}
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm font-bold text-white/70">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-amber-300"
      />
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-[#1b1202] shadow-lg shadow-amber-900/20 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
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
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white/75 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-rose-300/30 bg-rose-500/16 px-4 py-2 text-sm font-black text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function levelToDraft(row?: LevelConfig): LevelDraft {
  return {
    level: row?.level.toString() ?? '',
    xp_required: row?.xp_required.toString() ?? '0',
    status_label: row?.status_label ?? 'Rookie',
    reward_coins: row?.reward_coins.toString() ?? '0',
    reward_gems: row?.reward_gems.toString() ?? '0',
    reward_items: jsonToString(row?.reward_items, '[]'),
    unlock_rules: jsonToString(row?.unlock_rules, '{}'),
    is_enabled: row?.is_enabled ?? true,
  };
}

function grantToDraft(row?: EconomyGrant): EconomyGrantDraft {
  return {
    trigger_key: row?.trigger_key ?? '',
    display_name: row?.display_name ?? '',
    description: row?.description ?? '',
    coins: row?.coins.toString() ?? '0',
    gems: row?.gems.toString() ?? '0',
    one_time: row?.one_time ?? true,
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? '0',
    isNew: row === undefined,
  };
}

function dailyBonusToDraft(row?: DailyBonusConfig): DailyBonusDraft {
  return {
    day: row?.day.toString() ?? '1',
    reward_coins: row?.reward_coins.toString() ?? '0',
    reward_gems: row?.reward_gems.toString() ?? '0',
    reward_xp: row?.reward_xp.toString() ?? '0',
    reward_items: jsonToString(row?.reward_items, '[]'),
  };
}

function tableToDraft(row?: TableConfig, defaultKind: 'standard' | 'difficulty' = 'standard'): TableDraft {
  return {
    id: row?.id ?? '',
    kind: row?.kind ?? defaultKind,
    display_name: row?.display_name ?? '',
    description: row?.description ?? '',
    entry_fee_coins: row?.entry_fee_coins.toString() ?? '0',
    prize_coins: row?.prize_coins.toString() ?? '0',
    prize_coins_loss: row?.prize_coins_loss.toString() ?? '0',
    required_level: row?.required_level.toString() ?? '1',
    match_target: row?.match_target.toString() ?? '7',
    allow_ai: row?.allow_ai ?? (defaultKind === 'difficulty'),
    allow_online: row?.allow_online ?? true,
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? '0',
    xp_multiplier_pct: row?.xp_multiplier_pct.toString() ?? '100',
    base_xp_win: row?.base_xp_win.toString() ?? '0',
    turn_seconds: row?.turn_seconds.toString() ?? '45',
    accent_color: row?.accent_color ?? 'gold',
    ai_level: row?.ai_level ?? 'medium',
    target_rtp_pct: row?.target_rtp_pct.toString() ?? '90',
    metadata: jsonToString(row?.metadata, '{}'),
  };
}

function boardToDraft(row?: BoardThemeConfig): BoardDraft {
  return {
    id: row?.id ?? '',
    display_name: row?.display_name ?? '',
    preview_image: row?.preview_image ?? '',
    gameplay_image: row?.gameplay_image ?? '',
    lobby_background_image: row?.lobby_background_image ?? '',
    gameplay_background_image: metadataText(row?.metadata, 'gameplayBackgroundImage'),
    white_checker_image: row?.white_checker_image ?? '',
    black_checker_image: row?.black_checker_image ?? '',
    dice_image: row?.dice_image ?? '',
    tray_image: row?.tray_image ?? '',
    holder_image: row?.holder_image ?? '',
    unlock_level: row?.unlock_level.toString() ?? '1',
    price_coins: row?.price_coins.toString() ?? '0',
    price_gems: row?.price_gems?.toString() ?? '0',
    is_enabled: row?.is_enabled ?? true,
    is_featured: row?.is_featured ?? false,
    sort_order: row?.sort_order.toString() ?? '0',
    metadata: jsonToString(row?.metadata, '{}'),
  };
}

function currencyToDraft(row?: CurrencyConfigRow): CurrencyDraft {
  return {
    code: row?.code ?? '',
    display_name: row?.display_name ?? '',
    // Show the value in plain USD (e.g. "0.01"). Six decimals covers
    // sub-cent rates (1 coin = $0.0001) without scientific notation.
    usd_value: row ? (row.usd_value_micros / 1_000_000).toFixed(6) : '',
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? '0',
  };
}

function shopToDraft(row?: ShopItem): ShopDraft {
  return {
    id: row?.id ?? '',
    kind: row?.kind ?? 'coin_pack',
    display_name: row?.display_name ?? '',
    description: row?.description ?? '',
    image_url: row?.image_url ?? '',
    price_cents: row?.price_cents?.toString() ?? '',
    price_coins: row?.price_coins?.toString() ?? '',
    price_gems: row?.price_gems?.toString() ?? '',
    apple_product_id: row?.apple_product_id ?? '',
    google_product_id: row?.google_product_id ?? '',
    contents: jsonToString(row?.contents, '{}'),
    visibility_rules: jsonToString(row?.visibility_rules, '{}'),
    starts_at: row?.starts_at?.slice(0, 16) ?? '',
    ends_at: row?.ends_at?.slice(0, 16) ?? '',
    max_purchases_per_user: row?.max_purchases_per_user?.toString() ?? '',
    is_enabled: row?.is_enabled ?? false,
    sort_order: row?.sort_order.toString() ?? '0',
  };
}

export default function Admin() {
  const adminAuth = useAdminAuth();
  // Map the admin-auth context into the variables the rest of this
  // page expects. `linkGoogleIdentity` is no longer needed (the BO
  // doesn't link Google to a guest — it just signs in fresh).
  const user = adminAuth.user;
  const profile = adminAuth.profile;
  const isLoading = adminAuth.isLoading;
  const signInWithGoogle = adminAuth.signInWithGoogle;
  const [accessState, setAccessState] = useState<AccessState>(() =>
    isSupabaseConfigured ? 'checking' : 'missing-config'
  );
  const [role, setRole] = useState<AdminRole | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('Dashboard');
  const [stats, setStats] = useState<AdminStats>(initialStats);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [checkedUserIds, setCheckedUserIds] = useState<Set<string>>(() => new Set());
  const [selectedUserDetail, setSelectedUserDetail] = useState<UserDetail | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [profileDraft, setProfileDraft] = useState({ level: '1', xp: '0', rating: '1500', admin_note: '', suspension_reason: '' });
  const [walletDraft, setWalletDraft] = useState({ currency: 'coins', amount: '', reason: '' });
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  const [economyGrants, setEconomyGrants] = useState<EconomyGrant[]>([]);
  const [grantDraft, setGrantDraft] = useState<EconomyGrantDraft>(() => grantToDraft());
  // Bottom-nav feature lock levels (lobby_feature_configs). `level` is kept as
  // a string for the text input; saved as an integer. `tooltip` is the
  // optional override copy ("" → default "Reach level N to unlock").
  const [lobbyFeatures, setLobbyFeatures] = useState<
    { feature_key: string; label: string; level: string; enabled: boolean; tooltip: string }[]
  >([]);
  const [levelStatusTiers, setLevelStatusTiers] = useState<LevelStatusTier[]>([]);
  const [tierDrafts, setTierDrafts] = useState<LevelStatusTierDraft[]>([]);
  const [levelsPageSize, setLevelsPageSize] = useState<LevelsPageSize>(50);
  const [levelsPageIndex, setLevelsPageIndex] = useState(0);
  const [savingTiers, setSavingTiers] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);
  const [tierMessage, setTierMessage] = useState<string | null>(null);
  const [dailyBonusConfigs, setDailyBonusConfigs] = useState<DailyBonusConfig[]>([]);
  const [tables, setTables] = useState<TableConfig[]>([]);
  const [boards, setBoards] = useState<BoardThemeConfig[]>([]);
  const [podiums, setPodiums] = useState<PodiumImage[]>([]);
  const [podiumDraft, setPodiumDraft] = useState<{ name: string; image_url: string }>({
    name: '',
    image_url: '',
  });
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  // Store Sale draft — one global, schedulable promo that boosts coin/gem
  // grants. Numeric/date fields are strings so inputs can be cleared mid-edit.
  const [saleDraft, setSaleDraft] = useState<{
    id: string | null;
    label: string;
    bonus_percent: string;
    is_active: boolean;
    starts_at: string;
    ends_at: string;
  }>({ id: null, label: 'Store Sale', bonus_percent: '0', is_active: false, starts_at: '', ends_at: '' });
  const [currencies, setCurrencies] = useState<CurrencyConfigRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  // RTP dashboard state — fetched lazily when the section is opened so
  // we don't pay the aggregation cost on every BO load.
  const [rtpRange, setRtpRange] = useState<string>('all');
  const [rtpRows, setRtpRows] = useState<RtpRow[]>([]);
  const [rtpLoading, setRtpLoading] = useState(false);
  const [rtpError, setRtpError] = useState<string | null>(null);
  // The currently-expanded tier (per-player drill-down). Null = no
  // tier expanded. Players list is cached per (tier, range) — switching
  // back to an expanded tier shows last-known data instantly while a
  // fresh fetch runs in the background.
  const [rtpExpandedTier, setRtpExpandedTier] = useState<string | null>(null);
  const [rtpPlayerRows, setRtpPlayerRows] = useState<RtpPerPlayerRow[]>([]);
  const [rtpPlayerLoading, setRtpPlayerLoading] = useState(false);
  const [rtpPlayerError, setRtpPlayerError] = useState<string | null>(null);

  // Live online users — subscribes to the shared `online-users`
  // Realtime presence channel that every authenticated game session
  // joins via useOnlinePresence (in AuthProvider). Only active while
  // the operator is on the Users section so the WebSocket isn't kept
  // open BO-wide.
  const onlineUsers = useOnlineUsersWatcher(activeSection === 'Users');
  const [adminRoles, setAdminRoles] = useState<AdminRoleRow[]>([]);
  const [adminEmailRoles, setAdminEmailRoles] = useState<AdminEmailRoleRow[]>([]);
  const [roleDraft, setRoleDraft] = useState({ profile_id: '', role: 'viewer' as AdminRole, note: '' });
  const [emailRoleDraft, setEmailRoleDraft] = useState({
    email: 'contact@yanivos.com',
    role: 'owner' as AdminRole,
    note: 'Initial owner email',
  });
  const [levelDraft, setLevelDraft] = useState<LevelDraft>(() => levelToDraft());
  const [dailyBonusDraft, setDailyBonusDraft] = useState<DailyBonusDraft>(() => dailyBonusToDraft());
  const [tableDraft, setTableDraft] = useState<TableDraft>(() => tableToDraft());
  const [boardDraft, setBoardDraft] = useState<BoardDraft>(() => boardToDraft());
  const [boardEditorOpen, setBoardEditorOpen] = useState(false);
  const [boardEditorMode, setBoardEditorMode] = useState<'add' | 'edit'>('add');
  const [shopDraft, setShopDraft] = useState<ShopDraft>(() => shopToDraft());
  const [currencyDraft, setCurrencyDraft] = useState<CurrencyDraft>(() => currencyToDraft());
  const [dataError, setDataError] = useState<string | null>(null);
  const [boardMessage, setBoardMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const canManage = role === 'owner' || role === 'admin';
  const selectedUser = users.find((row) => row.id === selectedUserId) ?? null;
  // Currency rate map for $ value columns across the reward configs.
  // Disabled currencies are excluded so the operator can hide a code
  // from $ math without dropping its row (XP isn't priced at all — it's
  // not seeded, so it just returns 0 from the helpers).
  const rateMap = useMemo(() => buildCurrencyRateMap(currencies), [currencies]);
  const currentUserEmail = normalizeEmail(user?.email ?? '');
  const selectedEmailRole =
    adminEmailRoles.find((row) => row.email === normalizeEmail(emailRoleDraft.email)) ?? null;

  const setError = useCallback((err: unknown) => {
    if (err instanceof Error) {
      setDataError(err.message);
      return;
    }
    if (err && typeof err === 'object' && 'message' in err) {
      setDataError(String((err as { message: unknown }).message));
      return;
    }
    setDataError(String(err));
  }, []);

  async function loadBoardConfigs(successMessage?: string) {
    const { data, error } = await withRequestTimeout(
      supabase.from('board_theme_configs').select('*').order('sort_order', { ascending: true }),
      'Loading board themes'
    );
    if (error) throw error;

    const nextBoards = data ?? [];
    setBoards(nextBoards);
    setStats((current) => ({
      ...current,
      configItems: levels.length + tables.length + nextBoards.length,
    }));
    if (successMessage) setBoardMessage(successMessage);
  }

  // Podium library (the stand the board sits on in the lobby carousel).
  // Loaded on demand when the Board Themes section opens (see effect
  // below) rather than in the big initial load, to keep that batch lean.
  const loadPodiums = useCallback(async (successMessage?: string) => {
    const { data, error } = await withRequestTimeout(
      supabase
        .from('podium_images')
        .select('*')
        .order('sort_order', { ascending: false })
        .order('created_at', { ascending: false }),
      'Loading podiums'
    );
    if (error) throw error;
    setPodiums(data ?? []);
    if (successMessage) setBoardMessage(successMessage);
  }, []);

  async function addPodium() {
    if (!canManage) return;
    const image_url = podiumDraft.image_url.trim();
    if (!image_url) {
      setDataError('Upload or paste a podium image first.');
      return;
    }
    setSavingKey('podium-add');
    setDataError(null);
    setBoardMessage(null);
    try {
      const { error } = await withRequestTimeout(
        supabase
          .from('podium_images')
          .insert({
            name: podiumDraft.name.trim() || 'Podium',
            image_url,
            updated_by: user?.id ?? null,
          })
          .select('id'),
        'Adding podium'
      );
      if (error) throw error;
      setPodiumDraft({ name: '', image_url: '' });
      await loadPodiums('Podium added.');
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function activatePodium(podium: PodiumImage) {
    if (!canManage || podium.is_active) return;
    setSavingKey(`podium-active-${podium.id}`);
    setDataError(null);
    setBoardMessage(null);
    try {
      const { error } = await withRequestTimeout(
        supabase.rpc('set_active_podium', { p_id: podium.id }),
        'Activating podium'
      );
      if (error) throw error;
      await loadPodiums('Podium activated.');
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function deletePodium(podium: PodiumImage) {
    if (!canManage) return;
    if (podium.is_active) {
      setDataError('Set another podium active before deleting the active one.');
      return;
    }
    const confirmed = window.confirm(`Delete podium "${podium.name}"?`);
    if (!confirmed) return;
    setSavingKey(`podium-delete-${podium.id}`);
    setDataError(null);
    setBoardMessage(null);
    try {
      const { error } = await withRequestTimeout(
        supabase.from('podium_images').delete().eq('id', podium.id).select('id'),
        'Deleting podium'
      );
      if (error) throw error;
      await loadPodiums('Podium deleted.');
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  // Load the podium library when the operator opens Board Themes.
  useEffect(() => {
    if (activeSection !== 'Board Themes') return;
    void loadPodiums().catch(setError);
  }, [activeSection, loadPodiums, setError]);

  // Load bottom-nav feature lock levels when the operator opens Lobby Features.
  useEffect(() => {
    if (activeSection !== 'Lobby Features') return;
    void supabase
      .from('lobby_feature_configs')
      .select('feature_key, label, unlock_level, is_enabled, sort_order, tooltip_text')
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setError(error);
          return;
        }
        setLobbyFeatures(
          (data ?? []).map((r) => ({
            feature_key: r.feature_key,
            label: r.label,
            level: String(r.unlock_level),
            enabled: r.is_enabled,
            tooltip: r.tooltip_text ?? '',
          })),
        );
      });
  }, [activeSection]);

  // Once we've verified the signed-in admin's access once, we don't
  // want to blank the page back to a "Checking access" placeholder on
  // every transient re-run of this effect — token refreshes, tab
  // visibility resumes, etc. The ref records the userId we last
  // verified for. If the effect re-fires with the same userId, we
  // silently skip the work and keep the existing 'allowed' UI on
  // screen. Only a different user (sign-out, switch account) or the
  // first verification ever shows the placeholder.
  const verifiedAccessForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      queueMicrotask(() => {
        setAccessState('missing-config');
        setRole(null);
      });
      return;
    }
    if (isLoading) return;
    if (!user) {
      verifiedAccessForUserRef.current = null;
      queueMicrotask(() => {
        setAccessState('denied');
        setRole(null);
      });
      return;
    }

    // Already verified for this same user — skip the noisy re-check.
    // The effect can re-fire on rare hook-dep churn even with the
    // user?.id dep guard (e.g. when React StrictMode double-invokes
    // in dev, or when adminAuth's value useMemo recomputes around a
    // token refresh). Keep the BO content visible.
    if (verifiedAccessForUserRef.current === user.id) return;

    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setAccessState('checking');
      setDataError(null);

      const { data: adminRole, error } = await withRequestTimeout(
        supabase.rpc('get_my_admin_role', {}),
        'Checking admin access'
      );

      if (cancelled) return;
      if (isMissingMigrationError(error)) {
        setAccessState('migration-missing');
        setRole(null);
        return;
      }
      if (error) {
        setDataError(error.message);
        setAccessState('denied');
        setRole(null);
        return;
      }
      if (!adminRole) {
        setAccessState('denied');
        setRole(null);
        return;
      }

      const [profileReadiness, shopReadiness] = await Promise.all([
        supabase.from('profiles').select('level,xp,is_suspended').limit(1),
        supabase.from('shop_items').select('id').limit(1),
      ]);
      const readinessError = profileReadiness.error ?? shopReadiness.error;
      if (cancelled) return;
      if (isMissingMigrationError(readinessError)) {
        setAccessState('migration-missing');
        setRole(null);
        return;
      }
      if (readinessError) {
        setDataError(readinessError.message);
        setAccessState('denied');
        setRole(null);
        return;
      }

      verifiedAccessForUserRef.current = user.id;
      setRole(adminRole);
      setAccessState('allowed');
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, user?.id]);

  const loadSelectedUser = useCallback(
    async (profileId: string) => {
      try {
        const [wallet, transactions, boardsOwned, purchases, matches] = await Promise.all([
          supabase.from('user_wallets').select('*').eq('profile_id', profileId).maybeSingle(),
          supabase
            .from('wallet_transactions')
            .select('*')
            .eq('profile_id', profileId)
            .order('created_at', { ascending: false })
            .limit(12),
          supabase
            .from('user_board_inventory')
            .select('*')
            .eq('profile_id', profileId)
            .order('created_at', { ascending: false }),
          supabase
            .from('purchases')
            .select('*')
            .eq('profile_id', profileId)
            .order('created_at', { ascending: false })
            .limit(12),
          supabase
            .from('matches')
            .select('*')
            .or(`owner_id.eq.${profileId},opponent_id.eq.${profileId}`)
            .order('started_at', { ascending: false })
            .limit(12),
        ]);

        const firstError =
          wallet.error ?? transactions.error ?? boardsOwned.error ?? purchases.error ?? matches.error;
        if (firstError) throw firstError;

        setSelectedUserDetail({
          wallet: wallet.data,
          transactions: transactions.data ?? [],
          boards: boardsOwned.data ?? [],
          purchases: purchases.data ?? [],
          matches: matches.data ?? [],
        });
      } catch (err) {
        setError(err);
      }
    },
    [setError]
  );

  const loadAdminData = useCallback(async () => {
    if (accessState !== 'allowed') return;
    setRefreshing(true);
    setDataError(null);

    try {
      const [
        userCount,
        suspendedCount,
        matchCount,
        activeMatchCount,
        profilesResult,
        levelResult,
        levelStatusTierResult,
        economyGrantResult,
        dailyBonusResult,
        tableResult,
        boardResult,
        shopResult,
        auditResult,
        roleResult,
        emailRoleResult,
        currencyResult,
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_suspended', true),
        supabase.from('matches').select('id', { count: 'exact', head: true }),
        supabase.from('matches').select('id', { count: 'exact', head: true }).is('finished_at', null),
        supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(120),
        supabase.from('level_configs').select('*').order('level', { ascending: true }),
        supabase
          .from('level_status_tiers')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('level_from', { ascending: true }),
        supabase
          .from('economy_grants')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('trigger_key', { ascending: true }),
        supabase.from('daily_bonus_configs').select('*').order('day', { ascending: true }),
        supabase.from('table_configs').select('*').order('sort_order', { ascending: true }),
        supabase.from('board_theme_configs').select('*').order('sort_order', { ascending: true }),
        supabase.from('shop_items').select('*').order('sort_order', { ascending: true }),
        supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('admin_roles').select('*').order('created_at', { ascending: false }),
        supabase.from('admin_email_allowlist').select('*').order('created_at', { ascending: false }),
        supabase.from('currency_configs').select('*').order('sort_order', { ascending: true }),
      ]);

      const firstError =
        userCount.error ??
        suspendedCount.error ??
        matchCount.error ??
        activeMatchCount.error ??
        profilesResult.error ??
        levelResult.error ??
        levelStatusTierResult.error ??
        economyGrantResult.error ??
        dailyBonusResult.error ??
        tableResult.error ??
        boardResult.error ??
        shopResult.error ??
        auditResult.error ??
        roleResult.error ??
        emailRoleResult.error ??
        currencyResult.error;
      if (firstError) throw firstError;

      const profileRows = (profilesResult.data ?? []).filter((row) => !isDeletedProfile(row));
      const profileIds = profileRows.map((row) => row.id);
      const wallets = profileIds.length
        ? await supabase.from('user_wallets').select('*').in('profile_id', profileIds)
        : { data: [], error: null };
      if (wallets.error) throw wallets.error;

      const walletMap = new Map((wallets.data ?? []).map((wallet) => [wallet.profile_id, wallet]));
      const adminUsers = profileRows.map((row) => ({ ...row, wallet: walletMap.get(row.id) }));

      setUsers(adminUsers);
      setCheckedUserIds((current) => {
        const visibleIds = new Set(adminUsers.map((row) => row.id));
        return new Set([...current].filter((id) => visibleIds.has(id)));
      });
      setLevels(levelResult.data ?? []);
      setEconomyGrants(economyGrantResult.data ?? []);
      const tierRows = levelStatusTierResult.data ?? [];
      setLevelStatusTiers(tierRows);
      // Initialize the editable drafts from the freshly loaded rows.
      // String-ify numerics so the inputs can be cleared without
      // losing form state.
      setTierDrafts(
        tierRows.map((t) => ({
          id: t.id,
          level_from: String(t.level_from),
          level_to: String(t.level_to),
          label: t.label,
          sort_order: String(t.sort_order),
          is_enabled: t.is_enabled,
        })),
      );
      setDailyBonusConfigs(dailyBonusResult.data ?? []);
      setTables(tableResult.data ?? []);
      setBoards(boardResult.data ?? []);
      setShopItems(shopResult.data ?? []);
      // Store Sale (single global row). Loaded here so a save refreshes it too.
      const saleResult = await supabase
        .from('store_sales')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!saleResult.error && saleResult.data) {
        const s = saleResult.data;
        setSaleDraft({
          id: s.id,
          label: s.label,
          bonus_percent: String(s.bonus_percent),
          is_active: s.is_active,
          starts_at: s.starts_at?.slice(0, 16) ?? '',
          ends_at: s.ends_at?.slice(0, 16) ?? '',
        });
      }
      setAudit(auditResult.data ?? []);
      setAdminRoles(roleResult.data ?? []);
      setAdminEmailRoles(emailRoleResult.data ?? []);
      setCurrencies(currencyResult.data ?? []);
      setStats({
        users: profileRows.length || userCount.count || 0,
        matches: matchCount.count ?? 0,
        activeMatches: activeMatchCount.count ?? 0,
        configItems: (levelResult.data ?? []).length + (tableResult.data ?? []).length + (boardResult.data ?? []).length,
        shopItems: shopResult.data?.length ?? 0,
        suspendedUsers: suspendedCount.count ?? 0,
      });

      const nextSelected = selectedUserId ?? adminUsers[0]?.id ?? null;
      if (nextSelected && adminUsers.some((row) => row.id === nextSelected)) {
        setSelectedUserId(nextSelected);
        const selected = adminUsers.find((row) => row.id === nextSelected);
        if (selected) {
          setProfileDraft({
            level: selected.level.toString(),
            xp: selected.xp.toString(),
            rating: selected.rating.toString(),
            admin_note: selected.admin_note ?? '',
            suspension_reason: selected.suspension_reason ?? '',
          });
        }
        await loadSelectedUser(nextSelected);
      } else {
        const fallbackSelected = adminUsers[0] ?? null;
        setSelectedUserId(fallbackSelected?.id ?? null);
        if (fallbackSelected) {
          setProfileDraft({
            level: fallbackSelected.level.toString(),
            xp: fallbackSelected.xp.toString(),
            rating: fallbackSelected.rating.toString(),
            admin_note: fallbackSelected.admin_note ?? '',
            suspension_reason: fallbackSelected.suspension_reason ?? '',
          });
          await loadSelectedUser(fallbackSelected.id);
        } else {
          setSelectedUserDetail(null);
        }
      }
    } catch (err) {
      if (isMissingMigrationError(err as { code?: string; message?: string })) {
        setAccessState('migration-missing');
      }
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [accessState, loadSelectedUser, selectedUserId, setError]);

  useEffect(() => {
    queueMicrotask(() => void loadAdminData());
  }, [loadAdminData]);

  // RTP summary fetch — keyed off the picked range. Lives in its own
  // hook so the rest of the BO doesn't pay for the aggregation when
  // we're elsewhere.
  const loadRtpSummary = useCallback(async () => {
    // No accessState gate — the BO main view only renders when the
    // admin auth check has resolved, and the section is only reachable
    // from the sidebar inside that view. Anonymous + non-admin callers
    // get rejected by the RPC itself (raises not_admin).
    setRtpLoading(true);
    setRtpError(null);
    try {
      const range = RTP_RANGES.find((r) => r.id === rtpRange);
      const since = range && range.hours !== null
        ? new Date(Date.now() - range.hours * 60 * 60 * 1000).toISOString()
        : null;
      const { data, error } = await supabase.rpc('get_rtp_summary', { p_since: since });
      if (error) throw error;
      setRtpRows((data ?? []) as unknown as RtpRow[]);
    } catch (err) {
      setRtpError(err instanceof Error ? err.message : String(err));
    } finally {
      setRtpLoading(false);
    }
  }, [rtpRange]);

  useEffect(() => {
    if (activeSection !== 'RTP Analytics') return;
    void loadRtpSummary();
  }, [activeSection, loadRtpSummary]);

  // Per-player drill-down. Triggered when the user clicks a tier row;
  // re-fetches when the range changes (so the expanded panel stays in
  // sync with the tier table above it).
  const loadRtpPerPlayer = useCallback(
    async (tierId: string) => {
      setRtpPlayerLoading(true);
      setRtpPlayerError(null);
      try {
        const range = RTP_RANGES.find((r) => r.id === rtpRange);
        const since = range && range.hours !== null
          ? new Date(Date.now() - range.hours * 60 * 60 * 1000).toISOString()
          : null;
        const { data, error } = await supabase.rpc('get_rtp_per_player', {
          p_table_config_id: tierId,
          p_since: since,
          p_limit: 50,
        });
        if (error) throw error;
        setRtpPlayerRows((data ?? []) as unknown as RtpPerPlayerRow[]);
      } catch (err) {
        setRtpPlayerError(err instanceof Error ? err.message : String(err));
      } finally {
        setRtpPlayerLoading(false);
      }
    },
    [rtpRange]
  );

  useEffect(() => {
    if (!rtpExpandedTier) return;
    if (activeSection !== 'RTP Analytics') return;
    void loadRtpPerPlayer(rtpExpandedTier);
  }, [activeSection, rtpExpandedTier, loadRtpPerPlayer]);

  function selectUser(nextUser: AdminUser) {
    setSelectedUserId(nextUser.id);
    setProfileDraft({
      level: nextUser.level.toString(),
      xp: nextUser.xp.toString(),
      rating: nextUser.rating.toString(),
      admin_note: nextUser.admin_note ?? '',
      suspension_reason: nextUser.suspension_reason ?? '',
    });
    void loadSelectedUser(nextUser.id);
  }

  function toggleCheckedUser(profileId: string, checked: boolean) {
    setCheckedUserIds((current) => {
      const next = new Set(current);
      if (checked) next.add(profileId);
      else next.delete(profileId);
      return next;
    });
  }

  function toggleAllFilteredUsers(checked: boolean) {
    setCheckedUserIds((current) => {
      const next = new Set(current);
      for (const profileId of selectableFilteredUserIds) {
        if (checked) next.add(profileId);
        else next.delete(profileId);
      }
      return next;
    });
  }

  /** Hard-delete (irreversible) — calls the admin_hard_delete_user RPC
   *  which removes the auth.users row + cascades through everything.
   *  Intended for shell/test users that pile up during dev. Guarded
   *  by a type-to-confirm prompt because there's no undo. */
  async function hardDeleteUsers(profileIds: string[]) {
    if (!canManage) return;
    const uniqueIds = [...new Set(profileIds)].filter((profileId) => profileId !== user?.id);
    if (uniqueIds.length === 0) {
      setDataError('Select at least one user that is not your current admin profile.');
      return;
    }

    const word = window.prompt(
      `HARD DELETE ${uniqueIds.length === 1 ? 'this user' : `${uniqueIds.length} users`}?\n\n` +
        `This is IRREVERSIBLE — the auth.users row is removed and all related ` +
        `wallet / inventory / match data is cascade-deleted from the database.\n\n` +
        `Type DELETE to confirm.`,
      ''
    );
    if (word === null) return;
    if (word.trim().toUpperCase() !== 'DELETE') {
      setDataError('Hard delete aborted — confirmation text did not match.');
      return;
    }

    setSavingKey('user-delete');
    setDataError(null);
    try {
      // Loop sequentially so an error on one row surfaces with the
      // matching id; .rpc() doesn't have a batch form for this.
      for (const id of uniqueIds) {
        const { error } = await supabase.rpc('admin_hard_delete_user', { target_id: id });
        if (error) throw new Error(`${id.slice(0, 8)}…: ${error.message}`);
      }
      setCheckedUserIds(new Set());
      if (selectedUserId && uniqueIds.includes(selectedUserId)) {
        setSelectedUserId(null);
        setSelectedUserDetail(null);
      }
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function softDeleteUsers(profileIds: string[]) {
    if (!canManage) return;
    const uniqueIds = [...new Set(profileIds)].filter((profileId) => profileId !== user?.id);
    if (uniqueIds.length === 0) {
      setDataError('Select at least one user that is not your current admin profile.');
      return;
    }

    const confirmed = window.confirm(
      `Delete ${uniqueIds.length === 1 ? 'this user' : `${uniqueIds.length} users`}? They will be removed from the live user list, but their data will remain recoverable in the database.`
    );
    if (!confirmed) return;

    const note = window.prompt('Delete note', 'Back Office soft delete');
    if (note === null) return;

    setSavingKey('user-delete');
    setDataError(null);
    try {
      const deletePayload: Database['public']['Tables']['profiles']['Update'] = {
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id ?? null,
        delete_note: emptyToNull(note) ?? 'Back Office soft delete',
        is_suspended: true,
        suspended_at: new Date().toISOString(),
        suspension_reason: 'Deleted in Back Office',
        admin_note: `[Deleted in Back Office] ${emptyToNull(note) ?? 'Soft delete'}`,
      };
      const { data: deletedRows, error } = await supabase
        .from('profiles')
        .update(deletePayload)
        .in('id', uniqueIds)
        .is('deleted_at', null)
        .select('id');
      if (isMissingAnyColumnError(error, ['deleted_at', 'deleted_by', 'delete_note'])) {
        const fallbackPayload = { ...deletePayload };
        delete fallbackPayload.deleted_at;
        delete fallbackPayload.deleted_by;
        delete fallbackPayload.delete_note;
        const fallback = await supabase
          .from('profiles')
          .update(fallbackPayload)
          .in('id', uniqueIds)
          .select('id');
        if (fallback.error) throw fallback.error;
        if ((fallback.data ?? []).length === 0) {
          throw new Error('No users were deleted. Check that your admin email has owner/admin permissions.');
        }
      } else if (error) {
        throw error;
      } else if ((deletedRows ?? []).length === 0) {
        throw new Error('No users were deleted. Check that your admin email has owner/admin permissions.');
      }

      setCheckedUserIds(new Set());
      if (selectedUserId && uniqueIds.includes(selectedUserId)) {
        setSelectedUserId(null);
        setSelectedUserDetail(null);
      }
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter((row) =>
      [row.display_name, row.id, row.rating.toString(), row.level.toString(), accountType(row)]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [userSearch, users]);

  const selectableFilteredUserIds = filteredUsers
    .filter((row) => row.id !== user?.id)
    .map((row) => row.id);
  const checkedUserCount = checkedUserIds.size;
  const allFilteredUsersChecked =
    selectableFilteredUserIds.length > 0 &&
    selectableFilteredUserIds.every((id) => checkedUserIds.has(id));

  const dashboardCards = useMemo(
    () => [
      { label: 'Users', value: formatNumber(stats.users), caption: `${stats.suspendedUsers} suspended` },
      { label: 'Matches', value: formatNumber(stats.matches), caption: 'Visible to admins' },
      { label: 'Active matches', value: formatNumber(stats.activeMatches), caption: 'Currently open' },
      { label: 'Game config', value: formatNumber(stats.configItems), caption: 'Levels, rooms, themes' },
      { label: 'Shop items', value: formatNumber(stats.shopItems), caption: 'Products and offers' },
    ],
    [stats]
  );

  function openAddBoard() {
    setBoardMessage(null);
    setBoardDraft(boardToDraft());
    setBoardEditorMode('add');
    setBoardEditorOpen(true);
  }

  function openEditBoard(board: BoardThemeConfig) {
    setBoardMessage(null);
    setBoardDraft(boardToDraft(board));
    setBoardEditorMode('edit');
    setBoardEditorOpen(true);
  }

  async function saveProfile() {
    if (!canManage || !selectedUser) return;
    setSavingKey('profile');
    setDataError(null);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          level: requiredNumber(profileDraft.level, 'Level'),
          xp: requiredNumber(profileDraft.xp, 'XP'),
          rating: requiredNumber(profileDraft.rating, 'Rating'),
          admin_note: emptyToNull(profileDraft.admin_note),
          suspension_reason: selectedUser.is_suspended ? emptyToNull(profileDraft.suspension_reason) : null,
          suspended_at: selectedUser.is_suspended ? (selectedUser.suspended_at ?? new Date().toISOString()) : null,
        })
        .eq('id', selectedUser.id);
      if (error) throw error;
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleSuspension(target: AdminUser) {
    if (!canManage) return;
    setSavingKey(`suspend-${target.id}`);
    setDataError(null);
    try {
      const next = !target.is_suspended;
      const { error } = await supabase
        .from('profiles')
        .update({
          is_suspended: next,
          suspended_at: next ? new Date().toISOString() : null,
          suspension_reason: next ? emptyToNull(profileDraft.suspension_reason) ?? 'Admin suspension' : null,
        })
        .eq('id', target.id);
      if (error) throw error;
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function adjustWallet() {
    if (!canManage || !selectedUser) return;
    setSavingKey('wallet');
    setDataError(null);
    try {
      const amount = requiredNumber(walletDraft.amount, 'Amount');
      const { error } = await supabase.rpc('admin_adjust_wallet', {
        target_profile_id: selectedUser.id,
        currency_code: walletDraft.currency,
        delta_amount: amount,
        adjustment_reason: walletDraft.reason,
      });
      if (error) throw error;
      setWalletDraft({ currency: 'coins', amount: '', reason: '' });
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveLevel() {
    if (!canManage) return;
    setSavingKey('level');
    setDataError(null);
    try {
      const level = requiredNumber(levelDraft.level, 'Level');
      if (!Number.isInteger(level) || level < 1) {
        // The DB enforces `level > 0` on an int PK. A blank Level field
        // resolves to Number('') === 0, which used to hit the database and
        // surface the raw "level_configs_level_check" violation. Validate
        // here so the operator gets a clear message instead.
        throw new Error('Level must be a whole number of 1 or more.');
      }
      const payload: Database['public']['Tables']['level_configs']['Insert'] = {
        level,
        xp_required: requiredNumber(levelDraft.xp_required, 'XP required'),
        status_label: levelDraft.status_label.trim() || 'Rookie',
        reward_coins: requiredNumber(levelDraft.reward_coins, 'Reward coins'),
        reward_gems: requiredNumber(levelDraft.reward_gems, 'Reward gems'),
        reward_items: parseJson(levelDraft.reward_items, 'Reward items', 'array'),
        unlock_rules: parseJson(levelDraft.unlock_rules, 'Unlock rules', 'object'),
        is_enabled: levelDraft.is_enabled,
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase.from('level_configs').upsert(payload);
      if (isMissingColumnError(error, 'status_label')) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.status_label;
        const fallback = await supabase.from('level_configs').upsert(fallbackPayload);
        if (fallback.error) throw fallback.error;
      } else if (error) {
        throw error;
      }
      setLevelDraft(levelToDraft());
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  // --- Status tier helpers --------------------------------------
  //
  // The tier panel is a small inline list. `tierDrafts` is the editable
  // mirror of `levelStatusTiers` (the last loaded snapshot). On Save we
  // diff: any draft.id that no longer exists in drafts gets deleted,
  // any draft with id=null gets inserted, the rest get updated. Then we
  // refetch to get fresh ids + audit timestamps.

  function updateTierDraft(index: number, patch: Partial<LevelStatusTierDraft>) {
    setTierDrafts((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addBlankTier() {
    // Default the new row's level_from to one past the previous row's
    // level_to so a designer adding tiers in order doesn't have to
    // re-type the boundary. Empty list -> start at 1.
    const lastTo = tierDrafts.length
      ? Math.max(
          0,
          Number.parseInt(tierDrafts[tierDrafts.length - 1].level_to, 10) || 0,
        )
      : 0;
    const nextFrom = lastTo > 0 ? lastTo + 1 : 1;
    setTierDrafts((rows) => [
      ...rows,
      {
        id: null,
        level_from: String(nextFrom),
        level_to: '',
        label: '',
        sort_order: String(rows.length + 1),
        is_enabled: true,
      },
    ]);
  }

  function removeTierDraft(index: number) {
    setTierDrafts((rows) => rows.filter((_, i) => i !== index));
  }

  function resetTierDrafts() {
    setTierDrafts(
      levelStatusTiers.map((t) => ({
        id: t.id,
        level_from: String(t.level_from),
        level_to: String(t.level_to),
        label: t.label,
        sort_order: String(t.sort_order),
        is_enabled: t.is_enabled,
      })),
    );
    setTierError(null);
    setTierMessage(null);
  }

  async function saveTiers() {
    if (!canManage || savingTiers) return;
    setSavingTiers(true);
    setTierError(null);
    setTierMessage(null);
    try {
      // Validate before any DB call so we don't end up with a
      // partially-saved set on bad input.
      const validated = tierDrafts.map((draft, i) => {
        const from = Number.parseInt(draft.level_from, 10);
        const to = Number.parseInt(draft.level_to, 10);
        const sort = Number.parseInt(draft.sort_order, 10);
        if (!Number.isFinite(from) || from <= 0) {
          throw new Error(`Tier #${i + 1}: "From" must be a positive integer.`);
        }
        if (!Number.isFinite(to) || to < from) {
          throw new Error(
            `Tier #${i + 1}: "To" must be ≥ "From" (got ${draft.level_to}).`,
          );
        }
        const label = draft.label.trim();
        if (!label) throw new Error(`Tier #${i + 1}: label is required.`);
        return {
          id: draft.id,
          level_from: from,
          level_to: to,
          label,
          sort_order: Number.isFinite(sort) ? sort : i + 1,
          is_enabled: draft.is_enabled,
        };
      });

      const draftIds = new Set(
        validated.map((v) => v.id).filter((id): id is string => !!id),
      );
      const toDelete = levelStatusTiers
        .filter((existing) => !draftIds.has(existing.id))
        .map((t) => t.id);
      const toInsert = validated.filter((v) => v.id === null);
      const toUpdate = validated.filter((v) => v.id !== null);

      if (toDelete.length > 0) {
        const { error } = await supabase
          .from('level_status_tiers')
          .delete()
          .in('id', toDelete);
        if (error) throw error;
      }
      if (toInsert.length > 0) {
        const { error } = await supabase.from('level_status_tiers').insert(
          toInsert.map((row) => ({
            level_from: row.level_from,
            level_to: row.level_to,
            label: row.label,
            sort_order: row.sort_order,
            is_enabled: row.is_enabled,
            updated_by: user?.id ?? null,
          })),
        );
        if (error) throw error;
      }
      if (toUpdate.length > 0) {
        // No bulk update RPC for arbitrary per-row changes, so issue
        // a per-row .update(). The tier table is small (~10 rows
        // max), so this is fine.
        for (const row of toUpdate) {
          if (!row.id) continue;
          const { error } = await supabase
            .from('level_status_tiers')
            .update({
              level_from: row.level_from,
              level_to: row.level_to,
              label: row.label,
              sort_order: row.sort_order,
              is_enabled: row.is_enabled,
              updated_by: user?.id ?? null,
            })
            .eq('id', row.id);
          if (error) throw error;
        }
      }
      setTierMessage(
        `Saved. ${toInsert.length} added · ${toUpdate.length} updated · ${toDelete.length} removed.`,
      );
      await loadAdminData();
    } catch (err) {
      setTierError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTiers(false);
    }
  }

  async function saveGrant() {
    if (!canManage) return;
    setSavingKey('grant');
    setDataError(null);
    try {
      const triggerKey = grantDraft.trigger_key.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]*$/.test(triggerKey)) {
        throw new Error(
          'Trigger key must be lowercase letters/numbers/underscores, starting with a letter (e.g. refer_friend).',
        );
      }
      if (!grantDraft.display_name.trim()) {
        throw new Error('Display name is required.');
      }
      const { error } = await supabase.rpc('admin_upsert_economy_grant', {
        p_trigger_key: triggerKey,
        p_display_name: grantDraft.display_name.trim(),
        p_description: grantDraft.description.trim(),
        p_coins: requiredNumber(grantDraft.coins, 'Coins'),
        p_gems: requiredNumber(grantDraft.gems, 'Gems'),
        p_one_time: grantDraft.one_time,
        p_is_enabled: grantDraft.is_enabled,
        p_sort_order: requiredNumber(grantDraft.sort_order, 'Sort order'),
      });
      if (error) throw error;
      setGrantDraft(grantToDraft());
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveLobbyFeature(featureKey: string) {
    if (!canManage) return;
    setSavingKey(`feature:${featureKey}`);
    setDataError(null);
    try {
      const row = lobbyFeatures.find((f) => f.feature_key === featureKey);
      if (!row) return;
      const level = requiredNumber(row.level, 'Unlock level');
      if (level < 1) throw new Error('Unlock level must be at least 1.');
      const tooltip = row.tooltip.trim();
      const { error } = await supabase
        .from('lobby_feature_configs')
        .update({
          unlock_level: level,
          is_enabled: row.enabled,
          tooltip_text: tooltip === '' ? null : tooltip,
        })
        .eq('feature_key', featureKey);
      if (error) throw error;
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveDailyBonus() {
    if (!canManage) return;
    setSavingKey('daily-bonus');
    setDataError(null);
    try {
      const day = requiredNumber(dailyBonusDraft.day, 'Day');
      if (day < 1 || day > 7) throw new Error('Day must be between 1 and 7.');
      const payload: Database['public']['Tables']['daily_bonus_configs']['Insert'] = {
        day,
        reward_coins: requiredNumber(dailyBonusDraft.reward_coins, 'Reward coins'),
        reward_gems: requiredNumber(dailyBonusDraft.reward_gems, 'Reward gems'),
        reward_xp: requiredNumber(dailyBonusDraft.reward_xp, 'Reward XP'),
        reward_items: parseJson(dailyBonusDraft.reward_items, 'Reward items', 'array'),
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase
        .from('daily_bonus_configs')
        .upsert(payload, { onConflict: 'day' });
      if (error) throw error;
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveCurrency() {
    if (!canManage) return;
    setSavingKey('currency');
    setDataError(null);
    try {
      const code = currencyDraft.code.trim();
      if (!code) throw new Error('Currency code is required.');
      if (!/^[a-z][a-z0-9_]*$/.test(code)) {
        throw new Error(
          'Code must be lowercase letters, digits, or underscores, starting with a letter.',
        );
      }
      const displayName = currencyDraft.display_name.trim();
      if (!displayName) throw new Error('Display name is required.');
      const usd = Number(currencyDraft.usd_value);
      if (!Number.isFinite(usd) || usd < 0) {
        throw new Error('USD value must be a non-negative number (e.g. 0.01).');
      }
      // Convert "$X.YZ" → micros. Round so 0.0001 doesn't drift to 99.
      const micros = Math.round(usd * 1_000_000);
      const sortOrder = requiredNumber(currencyDraft.sort_order, 'Sort order');
      const { error } = await supabase.rpc('admin_upsert_currency_config', {
        p_code: code,
        p_display_name: displayName,
        p_usd_value_micros: micros,
        p_is_enabled: currencyDraft.is_enabled,
        p_sort_order: sortOrder,
      });
      if (error) throw error;
      setCurrencyDraft(currencyToDraft());
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveTable() {
    if (!canManage) return;
    setSavingKey('table');
    setDataError(null);
    try {
      const xpMult = requiredNumber(tableDraft.xp_multiplier_pct, 'XP multiplier');
      if (xpMult < 0 || xpMult > 10000) {
        throw new Error('XP multiplier must be between 0 and 10000.');
      }
      const turnSec = requiredNumber(tableDraft.turn_seconds, 'Turn seconds');
      if (turnSec < 5 || turnSec > 600) {
        throw new Error('Turn seconds must be between 5 and 600.');
      }
      const targetRtp = requiredNumber(tableDraft.target_rtp_pct, 'Target RTP');
      if (targetRtp < 0 || targetRtp > 200) {
        throw new Error('Target RTP must be between 0 and 200.');
      }
      const payload: Database['public']['Tables']['table_configs']['Insert'] = {
        id: tableDraft.id.trim(),
        kind: tableDraft.kind,
        display_name: tableDraft.display_name.trim(),
        description: tableDraft.description.trim(),
        entry_fee_coins: requiredNumber(tableDraft.entry_fee_coins, 'Entry fee'),
        prize_coins: requiredNumber(tableDraft.prize_coins, 'Prize'),
        prize_coins_loss: requiredNumber(tableDraft.prize_coins_loss, 'Lose prize'),
        required_level: requiredNumber(tableDraft.required_level, 'Required level'),
        match_target: requiredNumber(tableDraft.match_target, 'Match target'),
        allow_ai: tableDraft.allow_ai,
        allow_online: tableDraft.allow_online,
        is_enabled: tableDraft.is_enabled,
        sort_order: requiredNumber(tableDraft.sort_order, 'Sort order'),
        xp_multiplier_pct: xpMult,
        base_xp_win: requiredNumber(tableDraft.base_xp_win, 'Base XP'),
        turn_seconds: turnSec,
        accent_color: tableDraft.accent_color.trim() || 'gold',
        ai_level: tableDraft.ai_level,
        target_rtp_pct: targetRtp,
        metadata: parseJson(tableDraft.metadata, 'Metadata', 'object'),
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase.from('table_configs').upsert(payload);
      if (error) throw error;
      setTableDraft(tableToDraft());
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveBoard() {
    if (!canManage) return;
    setSavingKey('board');
    setDataError(null);
    setBoardMessage(null);
    try {
      const metadata = withGameplayBackgroundMetadata(
        parseJson(boardDraft.metadata, 'Metadata', 'object'),
        boardDraft.gameplay_background_image
      );
      const payload: Database['public']['Tables']['board_theme_configs']['Insert'] = {
        id: boardDraft.id.trim(),
        display_name: boardDraft.display_name.trim(),
        preview_image: boardDraft.preview_image.trim(),
        gameplay_image: boardDraft.gameplay_image.trim(),
        lobby_background_image: emptyToNull(boardDraft.lobby_background_image),
        white_checker_image: emptyToNull(boardDraft.white_checker_image),
        black_checker_image: emptyToNull(boardDraft.black_checker_image),
        dice_image: emptyToNull(boardDraft.dice_image),
        tray_image: emptyToNull(boardDraft.tray_image),
        holder_image: emptyToNull(boardDraft.holder_image),
        unlock_level: requiredNumber(boardDraft.unlock_level, 'Unlock level'),
        price_coins: requiredNumber(boardDraft.price_coins, 'Price coins'),
        price_gems: requiredNumber(boardDraft.price_gems, 'Gems cost'),
        is_enabled: boardDraft.is_enabled,
        is_featured: boardDraft.is_featured,
        sort_order: requiredNumber(boardDraft.sort_order, 'Sort order'),
        metadata,
        updated_by: user?.id ?? null,
      };
      const { error } = await withRequestTimeout(
        supabase.from('board_theme_configs').upsert(payload, { onConflict: 'id' }).select('id'),
        'Saving board theme'
      );
      if (error) throw error;
      setBoardDraft(boardToDraft());
      setBoardEditorOpen(false);
      await loadBoardConfigs('Board theme saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteBoard(board: BoardThemeConfig) {
    if (!canManage) return;
    const confirmed = window.confirm(`Delete ${board.display_name}? This removes it from the live board list.`);
    if (!confirmed) return;
    setSavingKey(`board-delete-${board.id}`);
    setDataError(null);
    setBoardMessage(null);
    try {
      const { error } = await withRequestTimeout(
        supabase.from('board_theme_configs').delete().eq('id', board.id).select('id'),
        'Deleting board theme'
      );
      if (error) throw error;
      if (boardDraft.id === board.id) {
        setBoardDraft(boardToDraft());
        setBoardEditorOpen(false);
      }
      await loadBoardConfigs('Board theme deleted.');
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function seedBuiltInBoards() {
    if (!canManage) return;
    setSavingKey('board-seed');
    setDataError(null);
    setBoardMessage('Adding the current game boards...');
    try {
      const payload = builtInBoardSeeds.map((board) => ({ ...board, updated_by: user?.id ?? null }));
      const { data, error } = await withRequestTimeout(
        supabase.from('board_theme_configs').upsert(payload, { onConflict: 'id' }).select('id'),
        'Populating current boards'
      );
      if (error) throw error;
      await loadBoardConfigs(`Current boards populated: ${data?.length ?? builtInBoardSeeds.length} boards are ready.`);
    } catch (err) {
      setBoardMessage(null);
      if (isPolicyError(err)) {
        setDataError(
          'Supabase blocked the board write. Please run the latest board_theme_admin_write_policy migration in the Supabase SQL editor, then try again.'
        );
      } else {
        setError(err);
      }
    } finally {
      setSavingKey(null);
    }
  }

  async function saveShop() {
    if (!canManage) return;
    setSavingKey('shop');
    setDataError(null);
    try {
      const payload: Database['public']['Tables']['shop_items']['Insert'] = {
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
        contents: parseJson(shopDraft.contents, 'Contents', 'object'),
        visibility_rules: parseJson(shopDraft.visibility_rules, 'Visibility rules', 'object'),
        starts_at: shopDraft.starts_at ? new Date(shopDraft.starts_at).toISOString() : null,
        ends_at: shopDraft.ends_at ? new Date(shopDraft.ends_at).toISOString() : null,
        max_purchases_per_user: numberOrNull(shopDraft.max_purchases_per_user),
        is_enabled: shopDraft.is_enabled,
        sort_order: requiredNumber(shopDraft.sort_order, 'Sort order'),
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase.from('shop_items').upsert(payload);
      if (error) throw error;
      setShopDraft(shopToDraft());
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveStoreSale() {
    if (!canManage) return;
    setSavingKey('store-sale');
    setDataError(null);
    try {
      const payload = {
        label: saleDraft.label.trim() || 'Store Sale',
        bonus_percent: requiredNumber(saleDraft.bonus_percent, 'Bonus %'),
        is_active: saleDraft.is_active,
        starts_at: saleDraft.starts_at ? new Date(saleDraft.starts_at).toISOString() : null,
        ends_at: saleDraft.ends_at ? new Date(saleDraft.ends_at).toISOString() : null,
      };
      const { error } = saleDraft.id
        ? await supabase.from('store_sales').update(payload).eq('id', saleDraft.id)
        : await supabase.from('store_sales').insert(payload);
      if (error) throw error;
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function saveAdminRole() {
    if (!canManage) return;
    setSavingKey('role');
    setDataError(null);
    try {
      const { error } = await supabase.from('admin_roles').upsert({
        profile_id: roleDraft.profile_id.trim(),
        role: roleDraft.role,
        note: emptyToNull(roleDraft.note),
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      setRoleDraft({ profile_id: '', role: 'viewer', note: '' });
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function signInToAdmin() {
    setSavingKey('admin-login');
    setDataError(null);
    try {
      // adminAuth.signInWithGoogle bakes in the /admin/auth/callback
      // redirect — no need to compute it here. The BO session lives
      // in its own storageKey, so the game's session (if any) is
      // untouched by this flow.
      await signInWithGoogle();
    } catch (err) {
      setError(err);
      setSavingKey(null);
    }
  }

  async function saveAdminEmailRole() {
    if (!canManage) return;
    const email = normalizeEmail(emailRoleDraft.email);
    if (!email.includes('@')) {
      setDataError('Enter a valid email address.');
      return;
    }

    setSavingKey('email-role');
    setDataError(null);
    try {
      const payload: Database['public']['Tables']['admin_email_allowlist']['Insert'] = {
        email,
        role: emailRoleDraft.role,
        note: emptyToNull(emailRoleDraft.note),
        created_by: user?.id ?? null,
      };
      const { error } = await supabase
        .from('admin_email_allowlist')
        .upsert(payload, { onConflict: 'email' });
      if (error) throw error;
      setEmailRoleDraft({ email: '', role: 'viewer', note: '' });
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteAdminEmailRole(row: AdminEmailRoleRow) {
    if (!canManage) return;
    if (row.email === currentUserEmail) {
      setDataError("You can't remove the admin email you are currently using.");
      return;
    }
    const confirmed = window.confirm(`Remove admin access for ${row.email}?`);
    if (!confirmed) return;

    setSavingKey(`email-role-delete-${row.email}`);
    setDataError(null);
    try {
      const { error } = await supabase.from('admin_email_allowlist').delete().eq('email', row.email);
      if (error) throw error;
      setEmailRoleDraft({ email: '', role: 'viewer', note: '' });
      await loadAdminData();
    } catch (err) {
      setError(err);
    } finally {
      setSavingKey(null);
    }
  }

  if (accessState !== 'allowed') {
    const needsGoogleSignIn =
      accessState === 'denied' && (!user || user.is_anonymous || currentUserEmail.length === 0);
    const title =
      accessState === 'missing-config'
        ? 'Supabase is not configured'
        : accessState === 'migration-missing'
          ? 'Back Office database is not ready'
          : needsGoogleSignIn
            ? 'Back Office sign-in required'
            : accessState === 'denied'
            ? 'Admin access required'
            : 'Checking admin access';
    const message =
      accessState === 'migration-missing'
        ? 'Apply the latest Back Office migration to add email-based admin access and the required management tables.'
        : needsGoogleSignIn
          ? 'Sign in with Google using an allowlisted admin email to unlock the Back Office.'
          : accessState === 'denied'
            ? 'This Google account is not on the Back Office admin email list.'
            : accessState === 'missing-config'
              ? 'Add the Supabase URL and publishable key to your local environment to use Back Office.'
              : 'One moment while the access check finishes.';

    return (
      <main className="min-h-screen bg-[#061225] text-white">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-5 px-5 text-center">
          <Link to="/play" className="text-sm font-semibold text-amber-200/80 hover:text-amber-100">
            ← Back to lobby
          </Link>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
            <div className="text-xs font-bold uppercase tracking-[0.28em] text-amber-200/70">
              Gammon Rivals
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-white/60">
              {message}
            </p>
            {accessState === 'denied' && isSupabaseConfigured && (
              <div className="mt-5">
                <PrimaryButton onClick={() => void signInToAdmin()} disabled={savingKey === 'admin-login'}>
                  {savingKey === 'admin-login'
                    ? 'Opening Google…'
                    : user?.is_anonymous
                      ? 'Link Google account'
                      : 'Continue with Google'}
                </PrimaryButton>
              </div>
            )}
            {user && accessState !== 'checking' && (
              <div className="mt-4 space-y-2 rounded-lg bg-black/25 px-3 py-2 text-left text-xs text-white/55">
                <div>
                  <div className="text-white/35">Current email</div>
                  <div className="mt-1 break-all font-mono text-amber-100">{user.email ?? 'No verified email'}</div>
                </div>
                <div>
                  <div className="text-white/35">Current profile id</div>
                  <div className="mt-1 break-all font-mono text-amber-100">{user.id}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#061225] text-white">
      <header className="border-b border-white/10 bg-[#08182f]/90 px-4 py-3 shadow-lg shadow-black/20">
        <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-4">
          <div>
            <Link to="/play" className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/75">
              ← Lobby
            </Link>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Back Office</h1>
          </div>
          <div className="text-right text-xs text-white/55">
            <div className="text-sm font-bold text-white">{profile?.display_name ?? user?.email ?? 'Admin'}</div>
            <div className="capitalize text-amber-200">{role}</div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[96rem] gap-5 px-4 py-5 lg:grid-cols-[14rem_1fr]">
        <aside className="rounded-xl border border-white/10 bg-white/[0.045] p-2 lg:sticky lg:top-5 lg:h-fit">
          {sections.map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition ${
                activeSection === section
                  ? 'bg-amber-300 text-[#1b1202] shadow-lg shadow-amber-900/20'
                  : 'text-white/65 hover:bg-white/10 hover:text-white'
              }`}
            >
              {section}
            </button>
          ))}
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">
                {activeSection}
              </div>
              <div className="mt-1 text-sm text-white/55">
                {canManage ? 'Owner/admin mode' : 'Read-only admin role'}
              </div>
            </div>
            <SecondaryButton onClick={() => void loadAdminData()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </SecondaryButton>
          </div>

          {dataError && (
            <div className="mb-4 rounded-lg border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {dataError}
            </div>
          )}

          {activeSection === 'Dashboard' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {dashboardCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.035] p-4 shadow-xl shadow-black/20"
                  >
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/40">
                      {card.label}
                    </div>
                    <div className="mt-3 text-3xl font-black text-amber-100">{card.value}</div>
                    <div className="mt-1 text-xs text-white/45">{card.caption}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
                <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                  <h2 className="text-lg font-black">Operations readiness</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-black/15 p-3 text-sm text-white/60">
                      Wallets and ledger are ready for admin grants, match rewards, purchases, refunds,
                      and daily bonuses.
                    </div>
                    <div className="rounded-lg bg-black/15 p-3 text-sm text-white/60">
                      Shop config is ready before the game shop exists, so the gameplay UI can plug into
                      live products later.
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                  <h2 className="text-lg font-black">Recent changes</h2>
                  <div className="mt-3 space-y-2">
                    {audit.length === 0 ? (
                      <div className="text-sm text-white/45">No admin changes yet.</div>
                    ) : (
                      audit.slice(0, 6).map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs">
                          <div className="font-bold capitalize text-white/80">{entry.action}</div>
                          <div className="text-white/45">
                            {entry.entity_table} · {entry.entity_id}
                          </div>
                          <div className="text-white/35">{formatDate(entry.created_at)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Users' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                {/* Live online users widget. The dot pulses to make
                  * "live" obvious; counts come straight from the
                  * Realtime presence channel so the moment a player
                  * closes their tab the WebSocket drops and the
                  * count ticks down within a few seconds. */}
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="relative grid h-2.5 w-2.5 place-items-center">
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70" />
                      <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/90">
                      Live online
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-2xl font-black tabular-nums text-emerald-100">
                      {onlineUsers.total}
                    </span>
                    <span className="text-xs font-bold text-emerald-200/60">total</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 border-l border-emerald-500/30 pl-3">
                    <span className="font-display text-lg font-black tabular-nums text-emerald-100">
                      {onlineUsers.registered}
                    </span>
                    <span className="text-xs font-bold text-emerald-200/60">registered</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 border-l border-emerald-500/30 pl-3">
                    <span className="font-display text-lg font-black tabular-nums text-emerald-100">
                      {onlineUsers.guests}
                    </span>
                    <span className="text-xs font-bold text-emerald-200/60">guests</span>
                  </div>
                </div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black">Users</h2>
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search name, id, level, rating"
                    className="w-full max-w-sm rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-200/60"
                  />
                </div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/16 px-3 py-2 text-xs text-white/55">
                  <span>
                    {checkedUserCount > 0
                      ? `${checkedUserCount} selected`
                      : `${filteredUsers.length} live users shown`}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <DangerButton
                      onClick={() => void softDeleteUsers([...checkedUserIds])}
                      disabled={!canManage || checkedUserCount === 0 || savingKey === 'user-delete'}
                    >
                      Delete selected
                    </DangerButton>
                    {/* Hard delete — purges auth.users + cascades. Used to
                        clear shell/test users that pile up during dev.
                        Type-DELETE confirm is inside hardDeleteUsers. */}
                    <DangerButton
                      onClick={() => void hardDeleteUsers([...checkedUserIds])}
                      disabled={!canManage || checkedUserCount === 0 || savingKey === 'user-delete'}
                    >
                      Hard delete (irreversible)
                    </DangerButton>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-white/10 text-sm">
                    <thead className="bg-black/20 text-left text-xs uppercase tracking-wider text-white/35">
                      <tr>
                        <th className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={allFilteredUsersChecked}
                            disabled={selectableFilteredUserIds.length === 0}
                            onChange={(event) => toggleAllFilteredUsers(event.target.checked)}
                            className="h-4 w-4 accent-amber-300"
                            aria-label="Select all visible users"
                          />
                        </th>
                        <th className="px-4 py-3">Player</th>
                        <th className="px-4 py-3">Account</th>
                        <th className="px-4 py-3">Level</th>
                        <th className="px-4 py-3">Wallet</th>
                        <th className="px-4 py-3">Rating</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredUsers.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => selectUser(row)}
                          className={`cursor-pointer text-white/75 transition hover:bg-white/[0.055] ${
                            row.id === selectedUserId ? 'bg-amber-300/10' : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={checkedUserIds.has(row.id)}
                              disabled={row.id === user?.id}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => toggleCheckedUser(row.id, event.target.checked)}
                              className="h-4 w-4 accent-amber-300"
                              aria-label={`Select ${row.display_name}`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-white">{row.display_name}</div>
                            <div className="max-w-[16rem] truncate font-mono text-xs text-white/35">{row.id}</div>
                          </td>
                          <td className="px-4 py-3">{accountType(row)}</td>
                          <td className="px-4 py-3">L{row.level} · {formatNumber(row.xp)} XP</td>
                          <td className="px-4 py-3">
                            {formatNumber(row.wallet?.coins)} coins · {formatNumber(row.wallet?.gems)} gems
                          </td>
                          <td className="px-4 py-3">{formatNumber(row.rating)}</td>
                          <td className="px-4 py-3">
                            {row.is_suspended ? <StatusPill enabled={false} /> : <StatusPill enabled />}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void softDeleteUsers([row.id]);
                                }}
                                disabled={!canManage || row.id === user?.id || savingKey === 'user-delete'}
                                className="rounded-md border border-rose-300/25 px-2 py-1 text-xs font-bold text-rose-100 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                title="Hard delete (irreversible)"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void hardDeleteUsers([row.id]);
                                }}
                                disabled={!canManage || row.id === user?.id || savingKey === 'user-delete'}
                                className="rounded-md border border-rose-500/50 bg-rose-700/15 px-2 py-1 text-xs font-bold text-rose-200 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                Hard
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                {!selectedUser ? (
                  <EmptyState text="Select a user to inspect their profile, wallet, inventory, and match history." />
                ) : (
                  <>
                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xl font-black">{selectedUser.display_name}</h2>
                          <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-amber-200/70">
                            {accountType(selectedUser)}
                          </div>
                          <div className="mt-1 break-all font-mono text-xs text-white/35">{selectedUser.id}</div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <StatusPill enabled={!selectedUser.is_suspended} />
                          <DangerButton
                            onClick={() => void softDeleteUsers([selectedUser.id])}
                            disabled={!canManage || selectedUser.id === user?.id || savingKey === 'user-delete'}
                          >
                            Delete user
                          </DangerButton>
                          <DangerButton
                            onClick={() => void hardDeleteUsers([selectedUser.id])}
                            disabled={!canManage || selectedUser.id === user?.id || savingKey === 'user-delete'}
                          >
                            Hard delete (irreversible)
                          </DangerButton>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-white/55">
                        <div className="rounded-lg bg-black/18 p-2">
                          <div className="text-white/35">Coins</div>
                          <div className="font-bold text-white">{formatNumber(selectedUserDetail?.wallet?.coins)}</div>
                        </div>
                        <div className="rounded-lg bg-black/18 p-2">
                          <div className="text-white/35">Gems</div>
                          <div className="font-bold text-white">{formatNumber(selectedUserDetail?.wallet?.gems)}</div>
                        </div>
                        <div className="rounded-lg bg-black/18 p-2">
                          <div className="text-white/35">Created</div>
                          <div className="font-bold text-white">{formatDate(selectedUser.created_at)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-black">Profile controls</h3>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Field label="Level" value={profileDraft.level} onChange={(level) => setProfileDraft((d) => ({ ...d, level }))} />
                        <Field label="XP" value={profileDraft.xp} onChange={(xp) => setProfileDraft((d) => ({ ...d, xp }))} />
                        <Field label="Rating" value={profileDraft.rating} onChange={(rating) => setProfileDraft((d) => ({ ...d, rating }))} />
                      </div>
                      <div className="mt-3">
                        <TextArea label="Admin note" value={profileDraft.admin_note} onChange={(admin_note) => setProfileDraft((d) => ({ ...d, admin_note }))} rows={3} />
                      </div>
                      <div className="mt-3">
                        <TextArea label="Suspension reason" value={profileDraft.suspension_reason} onChange={(suspension_reason) => setProfileDraft((d) => ({ ...d, suspension_reason }))} rows={2} />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <PrimaryButton onClick={() => void saveProfile()} disabled={!canManage || savingKey === 'profile'}>
                          Save profile
                        </PrimaryButton>
                        <SecondaryButton onClick={() => void toggleSuspension(selectedUser)} disabled={!canManage}>
                          {selectedUser.is_suspended ? 'Unsuspend' : 'Suspend'}
                        </SecondaryButton>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-black">Grant / remove currency</h3>
                      <div className="mt-3 grid grid-cols-[7rem_1fr] gap-2">
                        <select
                          value={walletDraft.currency}
                          onChange={(event) => setWalletDraft((d) => ({ ...d, currency: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                          <option value="coins">Coins</option>
                          <option value="gems">Gems</option>
                        </select>
                        <Field label="Amount (+ or -)" value={walletDraft.amount} onChange={(amount) => setWalletDraft((d) => ({ ...d, amount }))} />
                      </div>
                      <div className="mt-3">
                        <Field label="Reason" value={walletDraft.reason} onChange={(reason) => setWalletDraft((d) => ({ ...d, reason }))} />
                      </div>
                      <div className="mt-3">
                        <PrimaryButton onClick={() => void adjustWallet()} disabled={!canManage || savingKey === 'wallet'}>
                          Apply wallet change
                        </PrimaryButton>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-black">Inventory</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedUserDetail?.boards.length ? (
                          selectedUserDetail.boards.map((item) => (
                            <span key={item.board_theme_id} className="rounded-full bg-black/25 px-3 py-1 text-xs text-white/65">
                              {item.board_theme_id} · {item.source}
                            </span>
                          ))
                        ) : (
                          <div className="text-sm text-white/45">No owned boards.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-black">Wallet ledger</h3>
                      <div className="mt-2 space-y-2">
                        {selectedUserDetail?.transactions.length ? (
                          selectedUserDetail.transactions.map((tx) => (
                            <div key={tx.id} className="rounded-lg bg-black/18 px-3 py-2 text-xs text-white/60">
                              <div className="font-bold text-white">
                                {tx.amount > 0 ? '+' : ''}{formatNumber(tx.amount)} {tx.currency}
                              </div>
                              <div>{tx.reason}</div>
                              <div className="text-white/35">After: {formatNumber(tx.balance_after)} · {formatDate(tx.created_at)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-white/45">No wallet transactions yet.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-black">Purchases</h3>
                      <div className="mt-2 space-y-2">
                        {selectedUserDetail?.purchases.length ? (
                          selectedUserDetail.purchases.map((purchase) => (
                            <div key={purchase.id} className="rounded-lg bg-black/18 px-3 py-2 text-xs text-white/60">
                              <div className="font-bold text-white">{purchase.product_id}</div>
                              <div>{purchase.product_type} · {purchase.provider} · {purchase.status}</div>
                              <div className="text-white/35">{moneyFromCents(purchase.price_cents)} · {formatDate(purchase.created_at)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-white/45">No purchases yet.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-black">Match history</h3>
                      <div className="mt-2 space-y-2">
                        {selectedUserDetail?.matches.length ? (
                          selectedUserDetail.matches.map((match) => (
                            <div key={match.id} className="rounded-lg bg-black/18 px-3 py-2 text-xs text-white/60">
                              <div className="font-bold text-white">{match.mode} · to {match.target}</div>
                              <div>Score {match.white_score}-{match.black_score} · winner {match.winner ?? 'open'}</div>
                              <div className="text-white/35">{formatDate(match.started_at)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-white/45">No matches yet.</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeSection === 'Currencies' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
              <ConfigTable
                title="Currencies"
                rows={currencies.map((row) => [
                  row.code,
                  row.display_name,
                  `$${(row.usd_value_micros / 1_000_000).toFixed(6)} / unit`,
                  `100 = ${formatUsdMicros(row.usd_value_micros * 100)}`,
                  row.is_enabled ? 'Enabled' : 'Disabled',
                ])}
                onRowClick={(index) =>
                  setCurrencyDraft(currencyToDraft(currencies[index]))
                }
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit currency</h2>
                <p className="mt-1 text-xs text-white/55">
                  USD value per single unit. The Hourly Wheel, Daily
                  Bonus, Level Rewards, and Tables / Rooms sections use
                  these rates to show a $ value column. Add a new code
                  (e.g. <code className="font-mono">chips</code>) when
                  introducing a new currency. Disable instead of
                  deleting — existing reward configs reference codes by
                  name and would render as $0 if the code disappears.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field
                    label="Code"
                    value={currencyDraft.code}
                    onChange={(code) => setCurrencyDraft((d) => ({ ...d, code }))}
                  />
                  <Field
                    label="Display name"
                    value={currencyDraft.display_name}
                    onChange={(display_name) =>
                      setCurrencyDraft((d) => ({ ...d, display_name }))
                    }
                  />
                  <Field
                    label="USD value per unit"
                    value={currencyDraft.usd_value}
                    onChange={(usd_value) =>
                      setCurrencyDraft((d) => ({ ...d, usd_value }))
                    }
                  />
                  <Field
                    label="Sort order"
                    value={currencyDraft.sort_order}
                    onChange={(sort_order) =>
                      setCurrencyDraft((d) => ({ ...d, sort_order }))
                    }
                  />
                </div>
                <p className="mt-2 text-[10px] normal-case tracking-normal text-white/40">
                  Examples — 1 gem = $0.01 → type{' '}
                  <code className="font-mono">0.01</code>. 1 coin =
                  $0.0001 → type{' '}
                  <code className="font-mono">0.0001</code>.
                </p>
                <div className="mt-3 space-y-3">
                  <Toggle
                    label="Enabled"
                    checked={currencyDraft.is_enabled}
                    onChange={(is_enabled) =>
                      setCurrencyDraft((d) => ({ ...d, is_enabled }))
                    }
                  />
                  <div className="flex gap-2">
                    <PrimaryButton
                      onClick={() => void saveCurrency()}
                      disabled={!canManage || savingKey === 'currency'}
                    >
                      Save currency
                    </PrimaryButton>
                    <SecondaryButton onClick={() => setCurrencyDraft(currencyToDraft())}>
                      New
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Economy Grants' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
              <ConfigTable
                title="Economy grants"
                rows={economyGrants.map((row) => [
                  row.trigger_key,
                  row.display_name,
                  `${formatNumber(row.coins)} coins · ${row.gems} gems`,
                  row.one_time ? 'One-time' : 'Repeatable',
                  row.is_enabled ? 'Enabled' : 'Disabled',
                ])}
                onRowClick={(index) => setGrantDraft(grantToDraft(economyGrants[index]))}
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit grant</h2>
                <p className="mt-1 text-xs text-white/55">
                  Coin / gem grants fired by a trigger.{' '}
                  <code className="font-mono">signup</code> is the
                  starting balance every new player receives. Add a new
                  key (e.g. <code className="font-mono">refer_friend</code>,{' '}
                  <code className="font-mono">link_google</code>) to define
                  a future tap — the value is configurable here today;
                  firing it is a one-line server call when that feature
                  ships. Disable rather than delete. One-time grants are
                  credited at most once per player.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field
                    label="Trigger key"
                    value={grantDraft.trigger_key}
                    disabled={!grantDraft.isNew}
                    onChange={(trigger_key) => setGrantDraft((d) => ({ ...d, trigger_key }))}
                  />
                  <Field
                    label="Display name"
                    value={grantDraft.display_name}
                    onChange={(display_name) => setGrantDraft((d) => ({ ...d, display_name }))}
                  />
                  <Field
                    label="Coins"
                    value={grantDraft.coins}
                    onChange={(coins) => setGrantDraft((d) => ({ ...d, coins }))}
                  />
                  <Field
                    label="Gems"
                    value={grantDraft.gems}
                    onChange={(gems) => setGrantDraft((d) => ({ ...d, gems }))}
                  />
                  <Field
                    label="Sort order"
                    value={grantDraft.sort_order}
                    onChange={(sort_order) => setGrantDraft((d) => ({ ...d, sort_order }))}
                  />
                </div>
                <div className="mt-3 space-y-3">
                  <Field
                    label="Description"
                    value={grantDraft.description}
                    onChange={(description) => setGrantDraft((d) => ({ ...d, description }))}
                  />
                  <Toggle
                    label="One-time (max once per player)"
                    checked={grantDraft.one_time}
                    onChange={(one_time) => setGrantDraft((d) => ({ ...d, one_time }))}
                  />
                  <Toggle
                    label="Enabled"
                    checked={grantDraft.is_enabled}
                    onChange={(is_enabled) => setGrantDraft((d) => ({ ...d, is_enabled }))}
                  />
                  {!grantDraft.isNew ? (
                    <p className="text-[10px] normal-case tracking-normal text-white/40">
                      Trigger key is the primary key and can't be changed on
                      an existing grant. Click "New" to create one with a
                      different key.
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => void saveGrant()} disabled={!canManage || savingKey === 'grant'}>
                      Save grant
                    </PrimaryButton>
                    <SecondaryButton onClick={() => setGrantDraft(grantToDraft())}>New</SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Level System' && (() => {
            // Pagination math. `levels` is already sorted ascending by
            // level in loadAdminData. The page index is clamped to the
            // valid range so changing pageSize doesn't strand the user
            // on a phantom page.
            const totalLevels = levels.length;
            const effectivePageSize =
              levelsPageSize === 'all' ? Math.max(totalLevels, 1) : levelsPageSize;
            const totalPages = Math.max(1, Math.ceil(totalLevels / effectivePageSize));
            const clampedPageIndex = Math.min(Math.max(0, levelsPageIndex), totalPages - 1);
            const pageStart = clampedPageIndex * effectivePageSize;
            const pageEnd = Math.min(pageStart + effectivePageSize, totalLevels);
            const pagedLevels = levels.slice(pageStart, pageEnd);
            const pageSizeOptions: LevelsPageSize[] = [25, 50, 100, 'all'];

            // Each level's status is DERIVED from the tier ranges (the same
            // way the lobby derives it) — NOT from a per-row column. The old
            // list read `level_configs.status_label`, which doesn't exist, so
            // every level showed the "Rookie" fallback regardless of the
            // configured tiers. Built from the live tier drafts so the column
            // reflects edits in the panel above before they're even saved.
            const parsedTierRanges = tierDrafts
              .map((d, i) => ({
                level_from: Number.parseInt(d.level_from, 10),
                level_to: Number.parseInt(d.level_to, 10),
                label: d.label.trim(),
                sort_order: Number.parseInt(d.sort_order, 10) || i,
                is_enabled: d.is_enabled,
              }))
              .filter(
                (t) =>
                  Number.isFinite(t.level_from) &&
                  Number.isFinite(t.level_to) &&
                  t.label.length > 0,
              );

            return (
              <>
                {/* Status Tiers — declarative level → rank label. The
                    lobby derives status from these rows in real time,
                    so changes here propagate without re-applying the
                    curve or touching individual level rows. */}
                <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-lg font-black">Status tiers</h2>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">
                      declarative level → rank label
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-white/55">
                    Map level ranges to a rank label (Rookie, Veteran, etc.).
                    The lobby derives a player's displayed status from these
                    tiers — so changing a range updates every level without
                    re-applying the curve. Ranges may overlap; the lowest
                    sort_order wins.
                  </p>
                  <div className="mt-4 space-y-2">
                    {tierDrafts.length === 0 ? (
                      <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-6 text-center text-xs text-white/45">
                        No tiers configured. Click "+ Add tier" to define your first range.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-[5rem_5rem_minmax(0,1fr)_5rem_5rem_2rem] gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                          <span>From</span>
                          <span>To</span>
                          <span>Label</span>
                          <span>Sort</span>
                          <span>Enabled</span>
                          <span></span>
                        </div>
                        {tierDrafts.map((draft, i) => (
                          <div
                            key={`tier-${draft.id ?? `new-${i}`}`}
                            className="grid grid-cols-[5rem_5rem_minmax(0,1fr)_5rem_5rem_2rem] items-center gap-2"
                          >
                            <input
                              type="number"
                              min="1"
                              value={draft.level_from}
                              onChange={(e) => updateTierDraft(i, { level_from: e.target.value })}
                              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
                            />
                            <input
                              type="number"
                              min="1"
                              value={draft.level_to}
                              onChange={(e) => updateTierDraft(i, { level_to: e.target.value })}
                              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
                            />
                            <input
                              type="text"
                              value={draft.label}
                              placeholder="Rookie"
                              onChange={(e) => updateTierDraft(i, { label: e.target.value })}
                              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none placeholder:text-white/20 focus:border-amber-200/60"
                            />
                            <input
                              type="number"
                              value={draft.sort_order}
                              onChange={(e) => updateTierDraft(i, { sort_order: e.target.value })}
                              className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-200/60"
                            />
                            <label className="flex h-9 items-center justify-center rounded-lg border border-white/10 bg-black/20">
                              <input
                                type="checkbox"
                                checked={draft.is_enabled}
                                onChange={(e) => updateTierDraft(i, { is_enabled: e.target.checked })}
                                className="h-4 w-4 accent-amber-300"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeTierDraft(i)}
                              title="Remove tier"
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-300/30 bg-rose-300/10 text-base font-black text-rose-200/80 transition hover:bg-rose-300/20"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <SecondaryButton onClick={addBlankTier}>+ Add tier</SecondaryButton>
                    <PrimaryButton
                      onClick={() => void saveTiers()}
                      disabled={!canManage || savingTiers}
                    >
                      {savingTiers ? 'Saving…' : 'Save tiers'}
                    </PrimaryButton>
                    <SecondaryButton onClick={resetTierDrafts}>Discard changes</SecondaryButton>
                    {tierError ? (
                      <span className="rounded-lg border border-rose-300/40 bg-rose-300/10 px-3 py-1 text-xs font-bold text-rose-100">
                        {tierError}
                      </span>
                    ) : null}
                    {tierMessage ? (
                      <span className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-100">
                        {tierMessage}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Levels grid: paginated table on the left, sticky
                    editor on the right. `items-start` lets the sticky
                    child stop at the top of the column instead of
                    stretching to match the table's height. */}
                <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
                  <div>
                    {/* Pagination controls */}
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-white/40 uppercase tracking-[0.14em] font-bold">
                        Rows per page:
                      </span>
                      {pageSizeOptions.map((option) => (
                        <button
                          key={`page-size-${option}`}
                          type="button"
                          onClick={() => {
                            setLevelsPageSize(option);
                            setLevelsPageIndex(0);
                          }}
                          className={`rounded-md px-2.5 py-1 font-bold transition ${
                            levelsPageSize === option
                              ? 'bg-amber-300/20 text-amber-100 border border-amber-200/40'
                              : 'bg-white/[0.04] text-white/55 border border-white/10 hover:border-white/25'
                          }`}
                        >
                          {option === 'all' ? 'All' : option}
                        </button>
                      ))}
                      <span className="ml-auto flex items-center gap-2 text-white/55">
                        <button
                          type="button"
                          onClick={() => setLevelsPageIndex(Math.max(0, clampedPageIndex - 1))}
                          disabled={clampedPageIndex === 0}
                          className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 disabled:opacity-40"
                        >
                          ‹ Prev
                        </button>
                        <span className="font-mono text-white/70">
                          {totalLevels === 0
                            ? 'no rows'
                            : `${pageStart + 1}–${pageEnd} of ${totalLevels}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLevelsPageIndex(Math.min(totalPages - 1, clampedPageIndex + 1))}
                          disabled={clampedPageIndex >= totalPages - 1}
                          className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 disabled:opacity-40"
                        >
                          Next ›
                        </button>
                      </span>
                    </div>
                    <ConfigTable
                      title="Levels"
                      rows={pagedLevels.map((row) => {
                        const rowMicros =
                          usdMicrosFor(rateMap, 'coins', row.reward_coins) +
                          usdMicrosFor(rateMap, 'gems', row.reward_gems);
                        return [
                          `Level ${row.level}`,
                          resolveStatusLabel(row.level, parsedTierRanges, null),
                          `${formatNumber(row.xp_required)} XP`,
                          `${formatNumber(row.reward_coins)} coins · ${row.reward_gems} gems`,
                          formatUsdMicros(rowMicros),
                          row.is_enabled ? 'Enabled' : 'Disabled',
                        ];
                      })}
                      onRowClick={(index) =>
                        setLevelDraft(levelToDraft(pagedLevels[index]))
                      }
                    />
                  </div>
                  <div className="sticky top-4 rounded-xl border border-white/10 bg-white/[0.045] p-4">
                    <h2 className="text-lg font-black">Edit level</h2>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Level" value={levelDraft.level} onChange={(level) => setLevelDraft((d) => ({ ...d, level }))} />
                      <Field label="XP required" value={levelDraft.xp_required} onChange={(xp_required) => setLevelDraft((d) => ({ ...d, xp_required }))} />
                      <Field label="Status label (legacy)" value={levelDraft.status_label} onChange={(status_label) => setLevelDraft((d) => ({ ...d, status_label }))} />
                      <Field label="Reward coins" value={levelDraft.reward_coins} onChange={(reward_coins) => setLevelDraft((d) => ({ ...d, reward_coins }))} />
                      <Field label="Reward gems" value={levelDraft.reward_gems} onChange={(reward_gems) => setLevelDraft((d) => ({ ...d, reward_gems }))} />
                    </div>
                    <p className="mt-2 text-[10px] text-white/35">
                      "Status label" on a level row is legacy — the Status
                      tiers panel above takes precedence in the lobby.
                    </p>
                    <div className="mt-3 space-y-3">
                      <TextArea label="Reward items JSON array" value={levelDraft.reward_items} onChange={(reward_items) => setLevelDraft((d) => ({ ...d, reward_items }))} />
                      <TextArea label="Unlock rules JSON object" value={levelDraft.unlock_rules} onChange={(unlock_rules) => setLevelDraft((d) => ({ ...d, unlock_rules }))} />
                      <Toggle label="Enabled" checked={levelDraft.is_enabled} onChange={(is_enabled) => setLevelDraft((d) => ({ ...d, is_enabled }))} />
                      <div className="flex gap-2">
                        <PrimaryButton onClick={() => void saveLevel()} disabled={!canManage || savingKey === 'level'}>Save level</PrimaryButton>
                        <SecondaryButton
                          onClick={() => {
                            // Pre-fill the next free level so "New" on a packed
                            // 1..N table proposes N+1 instead of a blank field
                            // (blank saved as level 0 and tripped the `level > 0`
                            // check constraint). Operator can still overwrite it.
                            const nextLevel =
                              levels.reduce((max, row) => Math.max(max, row.level), 0) + 1;
                            setLevelDraft({ ...levelToDraft(), level: String(nextLevel) });
                          }}
                        >
                          New
                        </SecondaryButton>
                      </div>
                    </div>
                  </div>
                </div>
                <LevelCurveProposal
                  canManage={canManage}
                  currentLevels={levels}
                  currentUserId={user?.id ?? null}
                  onApplied={loadAdminData}
                  coinValueMicros={rateMap.get('coins') ?? 100}
                  gemValueMicros={rateMap.get('gems') ?? 10000}
                />
              </>
            );
          })()}

          {activeSection === 'Daily Bonus' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
              <ConfigTable
                title="Daily bonus (7 days)"
                rows={dailyBonusConfigs.map((row) => {
                  const rowMicros =
                    usdMicrosFor(rateMap, 'coins', row.reward_coins) +
                    usdMicrosFor(rateMap, 'gems', row.reward_gems);
                  return [
                    `Day ${row.day}`,
                    `${formatNumber(row.reward_coins)} coins`,
                    `${formatNumber(row.reward_gems)} gems`,
                    `${formatNumber(row.reward_xp)} XP`,
                    formatUsdMicros(rowMicros),
                  ];
                })}
                onRowClick={(index) => setDailyBonusDraft(dailyBonusToDraft(dailyBonusConfigs[index]))}
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit daily bonus</h2>
                <p className="mt-1 text-xs text-white/55">
                  Day 1–7 of the rotating weekly cycle. Streak resets to day 1
                  if a player misses a day (ET calendar). After day 7 the cycle
                  loops back to day 1.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field
                    label="Day (1–7)"
                    value={dailyBonusDraft.day}
                    onChange={(day) => setDailyBonusDraft((d) => ({ ...d, day }))}
                  />
                  <Field
                    label="Reward coins"
                    value={dailyBonusDraft.reward_coins}
                    onChange={(reward_coins) => setDailyBonusDraft((d) => ({ ...d, reward_coins }))}
                  />
                  <Field
                    label="Reward gems"
                    value={dailyBonusDraft.reward_gems}
                    onChange={(reward_gems) => setDailyBonusDraft((d) => ({ ...d, reward_gems }))}
                  />
                  <Field
                    label="Reward XP"
                    value={dailyBonusDraft.reward_xp}
                    onChange={(reward_xp) => setDailyBonusDraft((d) => ({ ...d, reward_xp }))}
                  />
                </div>
                <div className="mt-3 space-y-3">
                  <TextArea
                    label="Reward items JSON array"
                    value={dailyBonusDraft.reward_items}
                    onChange={(reward_items) => setDailyBonusDraft((d) => ({ ...d, reward_items }))}
                  />
                  <div className="flex gap-2">
                    <PrimaryButton
                      onClick={() => void saveDailyBonus()}
                      disabled={!canManage || savingKey === 'daily-bonus'}
                    >
                      Save day
                    </PrimaryButton>
                    <SecondaryButton onClick={() => setDailyBonusDraft(dailyBonusToDraft())}>
                      Reset form
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Hourly Wheel' && (
            <WheelAdmin canManage={canManage} />
          )}

          {activeSection === 'Daily Missions' && (
            <MissionsAdmin canManage={canManage} />
          )}

          {activeSection === 'Tables / Rooms' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
              {/* Filters to kind='standard' — the five difficulty tiers
                * live in the dedicated "Difficulties" section to keep
                * the two surfaces independent. */}
              <ConfigTable title="Rooms" rows={tables.filter((row) => row.kind !== 'difficulty').map((row) => {
                const entryMicros = usdMicrosFor(rateMap, 'coins', row.entry_fee_coins);
                const prizeMicros = usdMicrosFor(rateMap, 'coins', row.prize_coins);
                return [
                  row.display_name,
                  `${formatNumber(row.entry_fee_coins)} entry`,
                  `Prize ${formatNumber(row.prize_coins)}`,
                  `Entry ${formatUsdMicros(entryMicros)} · Prize ${formatUsdMicros(prizeMicros)}`,
                  row.is_enabled ? 'Enabled' : 'Disabled',
                ];
              })} onRowClick={(index) => {
                const standardRows = tables.filter((row) => row.kind !== 'difficulty');
                setTableDraft(tableToDraft(standardRows[index]));
              }} />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit room</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Room id" value={tableDraft.id} onChange={(id) => setTableDraft((d) => ({ ...d, id }))} />
                  <Field label="Name" value={tableDraft.display_name} onChange={(display_name) => setTableDraft((d) => ({ ...d, display_name }))} />
                  <Field label="Entry fee" value={tableDraft.entry_fee_coins} onChange={(entry_fee_coins) => setTableDraft((d) => ({ ...d, entry_fee_coins }))} />
                  <Field label="Prize" value={tableDraft.prize_coins} onChange={(prize_coins) => setTableDraft((d) => ({ ...d, prize_coins }))} />
                  <Field label="Required level" value={tableDraft.required_level} onChange={(required_level) => setTableDraft((d) => ({ ...d, required_level }))} />
                  <Field label="Match target" value={tableDraft.match_target} onChange={(match_target) => setTableDraft((d) => ({ ...d, match_target }))} />
                  <Field label="Sort order" value={tableDraft.sort_order} onChange={(sort_order) => setTableDraft((d) => ({ ...d, sort_order }))} />
                </div>
                <div className="mt-3 space-y-3">
                  <Field label="Description" value={tableDraft.description} onChange={(description) => setTableDraft((d) => ({ ...d, description }))} />
                  <TextArea label="Metadata JSON object" value={tableDraft.metadata} onChange={(metadata) => setTableDraft((d) => ({ ...d, metadata }))} />
                  <div className="grid grid-cols-3 gap-2">
                    <Toggle label="AI" checked={tableDraft.allow_ai} onChange={(allow_ai) => setTableDraft((d) => ({ ...d, allow_ai }))} />
                    <Toggle label="Online" checked={tableDraft.allow_online} onChange={(allow_online) => setTableDraft((d) => ({ ...d, allow_online }))} />
                    <Toggle label="Enabled" checked={tableDraft.is_enabled} onChange={(is_enabled) => setTableDraft((d) => ({ ...d, is_enabled }))} />
                  </div>
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => void saveTable()} disabled={!canManage || savingKey === 'table'}>Save room</PrimaryButton>
                    <SecondaryButton onClick={() => setTableDraft(tableToDraft())}>New</SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Difficulties' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
              {/* Difficulty-tier table. These rows surface in the
                * lobby's "Select Room Difficulty" modal (filtered by
                * kind='difficulty' + is_enabled). XP boost % drives
                * both the card display and the actual XP grant at
                * match end via finish_match(). */}
              <ConfigTable
                title="Difficulty tiers"
                rows={tables.filter((row) => row.kind === 'difficulty').map((row) => {
                  const feeMicros = usdMicrosFor(rateMap, 'coins', row.entry_fee_coins);
                  const winMicros = usdMicrosFor(rateMap, 'coins', row.prize_coins);
                  const lossMicros = usdMicrosFor(rateMap, 'coins', row.prize_coins_loss);
                  return [
                    row.display_name,
                    `${row.xp_multiplier_pct}% XP`,
                    `Fee ${formatNumber(row.entry_fee_coins)}`,
                    `W ${formatNumber(row.prize_coins)} / L ${formatNumber(row.prize_coins_loss)}`,
                    `AI ${row.ai_level}`,
                    `RTP ${row.target_rtp_pct}%`,
                    `Fee ${formatUsdMicros(feeMicros)} · W ${formatUsdMicros(winMicros)} · L ${formatUsdMicros(lossMicros)}`,
                    row.is_enabled ? 'Enabled' : 'Disabled',
                  ];
                })}
                onRowClick={(index) => {
                  const diffRows = tables.filter((row) => row.kind === 'difficulty');
                  setTableDraft(tableToDraft(diffRows[index], 'difficulty'));
                }}
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit difficulty</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Tier id" value={tableDraft.id} onChange={(id) => setTableDraft((d) => ({ ...d, id }))} />
                  <Field label="Display name" value={tableDraft.display_name} onChange={(display_name) => setTableDraft((d) => ({ ...d, display_name }))} />
                  <Field label="Entry fee (coins)" value={tableDraft.entry_fee_coins} onChange={(entry_fee_coins) => setTableDraft((d) => ({ ...d, entry_fee_coins }))} />
                  <Field label="Prize coins (on win)" value={tableDraft.prize_coins} onChange={(prize_coins) => setTableDraft((d) => ({ ...d, prize_coins }))} />
                  <Field label="Lose prize (consolation)" value={tableDraft.prize_coins_loss} onChange={(prize_coins_loss) => setTableDraft((d) => ({ ...d, prize_coins_loss }))} />
                  <Field label="Target RTP (%)" value={tableDraft.target_rtp_pct} onChange={(target_rtp_pct) => setTableDraft((d) => ({ ...d, target_rtp_pct }))} />
                  <Field label="XP boost (%)" value={tableDraft.xp_multiplier_pct} onChange={(xp_multiplier_pct) => setTableDraft((d) => ({ ...d, xp_multiplier_pct }))} />
                  <Field label="Base XP per match" value={tableDraft.base_xp_win} onChange={(base_xp_win) => setTableDraft((d) => ({ ...d, base_xp_win }))} />
                  <Field label="Turn seconds" value={tableDraft.turn_seconds} onChange={(turn_seconds) => setTableDraft((d) => ({ ...d, turn_seconds }))} />
                  <Field label="Required level" value={tableDraft.required_level} onChange={(required_level) => setTableDraft((d) => ({ ...d, required_level }))} />
                  <Field label="Match target" value={tableDraft.match_target} onChange={(match_target) => setTableDraft((d) => ({ ...d, match_target }))} />
                  <Field label="Sort order" value={tableDraft.sort_order} onChange={(sort_order) => setTableDraft((d) => ({ ...d, sort_order }))} />
                </div>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                      AI strength
                      <select
                        value={tableDraft.ai_level}
                        onChange={(event) => setTableDraft((d) => ({ ...d, ai_level: event.target.value as 'easy' | 'medium' | 'hard' }))}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition focus:border-amber-200/60"
                      >
                        <option value="easy">easy</option>
                        <option value="medium">medium</option>
                        <option value="hard">hard</option>
                      </select>
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                      Accent color
                      <select
                        value={tableDraft.accent_color}
                        onChange={(event) => setTableDraft((d) => ({ ...d, accent_color: event.target.value }))}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition focus:border-amber-200/60"
                      >
                        {difficultyAccentColors.map((slug) => (
                          <option key={slug} value={slug}>{slug}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Field label="Description" value={tableDraft.description} onChange={(description) => setTableDraft((d) => ({ ...d, description }))} />
                  <TextArea label="Metadata JSON object" value={tableDraft.metadata} onChange={(metadata) => setTableDraft((d) => ({ ...d, metadata }))} />
                  <div className="grid grid-cols-3 gap-2">
                    <Toggle label="AI" checked={tableDraft.allow_ai} onChange={(allow_ai) => setTableDraft((d) => ({ ...d, allow_ai }))} />
                    <Toggle label="Online" checked={tableDraft.allow_online} onChange={(allow_online) => setTableDraft((d) => ({ ...d, allow_online }))} />
                    <Toggle label="Enabled" checked={tableDraft.is_enabled} onChange={(is_enabled) => setTableDraft((d) => ({ ...d, is_enabled }))} />
                  </div>
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => void saveTable()} disabled={!canManage || savingKey === 'table'}>Save tier</PrimaryButton>
                    <SecondaryButton onClick={() => setTableDraft(tableToDraft(undefined, 'difficulty'))}>New</SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'RTP Analytics' && (
            <div className="space-y-4">
              {/* Header: range selector + refresh. The summary is
                * fetched lazily when the section opens (see
                * loadRtpSummary effect above); changing the range
                * re-fires the RPC. Numbers are computed server-side
                * by get_rtp_summary against matches +
                * wallet_transactions, so this view stays cheap on the
                * client even when match count grows. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <div>
                  <h2 className="text-lg font-black">RTP Analytics</h2>
                  <p className="mt-1 text-sm text-white/50">
                    Per-tier wagered, paid out, house take, and actual vs target RTP. Drives the
                    economy tuning loop — re-balance W / L / fee in the Difficulties tab when delta
                    drifts away from zero.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {RTP_RANGES.map((range) => (
                    <button
                      key={range.id}
                      type="button"
                      onClick={() => setRtpRange(range.id)}
                      className={
                        'rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition ' +
                        (rtpRange === range.id
                          ? 'border-amber-300/60 bg-amber-300/15 text-amber-200'
                          : 'border-white/15 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]')
                      }
                    >
                      {range.label}
                    </button>
                  ))}
                  <SecondaryButton onClick={() => void loadRtpSummary()} disabled={rtpLoading}>
                    {rtpLoading ? 'Loading…' : 'Refresh'}
                  </SecondaryButton>
                </div>
              </div>

              {rtpError ? (
                <div className="rounded-md border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
                  {rtpError}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.045]">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-white/10 bg-white/[0.04] text-left text-[0.65rem] font-bold uppercase tracking-[0.14em] text-white/45">
                    <tr>
                      <th className="px-3 py-2">Tier</th>
                      <th className="px-3 py-2 text-right">Matches</th>
                      <th className="px-3 py-2 text-right">Win rate</th>
                      <th className="px-3 py-2 text-right">Wagered</th>
                      <th className="px-3 py-2 text-right">Paid out</th>
                      <th className="px-3 py-2 text-right">House net</th>
                      <th className="px-3 py-2 text-right">Target RTP</th>
                      <th className="px-3 py-2 text-right">Actual RTP</th>
                      <th className="px-3 py-2 text-right">Delta</th>
                      <th className="px-3 py-2 text-right">Risk-free</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rtpRows.length === 0 && !rtpLoading ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-white/40">
                          No difficulty matches in this window yet.
                        </td>
                      </tr>
                    ) : (
                      rtpRows.map((row) => {
                        const delta = row.out_rtp_delta_pct;
                        const deltaColor =
                          delta === null
                            ? 'text-white/30'
                            : delta > 3
                              ? 'text-rose-300'
                              : delta < -3
                                ? 'text-emerald-300'
                                : 'text-amber-200';
                        const isExpanded = rtpExpandedTier === row.out_table_config_id;
                        const hasTraffic = row.out_matches_played > 0 || row.out_coins_wagered > 0;
                        return (
                          <Fragment key={row.out_table_config_id}>
                            <tr
                              className={`border-b border-white/5 last:border-b-0 ${
                                hasTraffic ? 'cursor-pointer hover:bg-white/[0.03]' : ''
                              } ${isExpanded ? 'bg-white/[0.04]' : ''}`}
                              onClick={() => {
                                if (!hasTraffic) return;
                                setRtpExpandedTier(isExpanded ? null : row.out_table_config_id);
                              }}
                            >
                              <td className="px-3 py-2 font-bold text-white/85">
                                <span className="mr-1 inline-block w-3 text-white/40">
                                  {hasTraffic ? (isExpanded ? '▾' : '▸') : ''}
                                </span>
                                {row.out_display_name}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">
                                {formatNumber(row.out_matches_played)}
                                {row.out_matches_played > 0 ? (
                                  <span className="ml-1 text-white/40">({formatNumber(row.out_matches_won)}W)</span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">
                                {row.out_actual_win_rate_pct !== null ? `${row.out_actual_win_rate_pct}%` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">
                                {formatNumber(row.out_coins_wagered)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">
                                {formatNumber(row.out_coins_paid_out)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">
                                {formatNumber(row.out_coins_house_net)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/55">
                                {row.out_target_rtp_pct}%
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/85">
                                {row.out_actual_rtp_pct !== null ? `${row.out_actual_rtp_pct}%` : '—'}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums font-bold ${deltaColor}`}>
                                {delta !== null ? `${delta > 0 ? '+' : ''}${delta}` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/55">
                                {formatNumber(row.out_risk_free_count)}
                              </td>
                            </tr>
                            {isExpanded ? (
                              <tr className="border-b border-white/5 bg-black/30">
                                <td colSpan={10} className="px-3 py-3">
                                  {rtpPlayerError ? (
                                    <div className="rounded-md border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
                                      {rtpPlayerError}
                                    </div>
                                  ) : rtpPlayerLoading && rtpPlayerRows.length === 0 ? (
                                    <div className="px-3 py-4 text-center text-xs text-white/40">Loading players…</div>
                                  ) : rtpPlayerRows.length === 0 ? (
                                    <div className="px-3 py-4 text-center text-xs text-white/40">
                                      No player data in this window.
                                    </div>
                                  ) : (
                                    <table className="min-w-full text-xs">
                                      <thead className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/40">
                                        <tr>
                                          <th className="px-2 py-1.5 text-left">Player</th>
                                          <th className="px-2 py-1.5 text-right">Matches</th>
                                          <th className="px-2 py-1.5 text-right">Win rate</th>
                                          <th className="px-2 py-1.5 text-right">Wagered</th>
                                          <th className="px-2 py-1.5 text-right">Paid out</th>
                                          <th className="px-2 py-1.5 text-right">House net</th>
                                          <th className="px-2 py-1.5 text-right">RTP</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rtpPlayerRows.map((pr) => {
                                          // Per-player RTP colouring is opposite of the
                                          // tier-level delta: here, high RTP means this
                                          // specific player is winning more than the tier
                                          // target — possibly a streaking expert or a bot.
                                          // Low RTP just means they're unlucky / new.
                                          const rtp = pr.out_actual_rtp_pct;
                                          const playerRtpColor =
                                            rtp === null
                                              ? 'text-white/40'
                                              : rtp > 110
                                                ? 'text-rose-300'
                                                : rtp > 95
                                                  ? 'text-amber-200'
                                                  : 'text-white/70';
                                          return (
                                            <tr key={pr.out_profile_id} className="border-t border-white/5">
                                              <td className="px-2 py-1.5">
                                                <button
                                                  type="button"
                                                  className="text-white/85 hover:text-amber-200"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveSection('Users');
                                                    setSelectedUserId(pr.out_profile_id);
                                                  }}
                                                >
                                                  {pr.out_display_name}
                                                </button>
                                              </td>
                                              <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                                                {formatNumber(pr.out_matches_played)}
                                                {pr.out_matches_played > 0 ? (
                                                  <span className="ml-1 text-white/40">({pr.out_matches_won}W)</span>
                                                ) : null}
                                              </td>
                                              <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                                                {pr.out_win_rate_pct !== null ? `${pr.out_win_rate_pct}%` : '—'}
                                              </td>
                                              <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                                                {formatNumber(pr.out_coins_wagered)}
                                              </td>
                                              <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                                                {formatNumber(pr.out_coins_paid_out)}
                                              </td>
                                              <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                                                {formatNumber(pr.out_coins_house_net)}
                                              </td>
                                              <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${playerRtpColor}`}>
                                                {rtp !== null ? `${rtp}%` : '—'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
                <strong className="text-white/70">How to read this:</strong> Delta = Actual RTP − Target RTP. Negative means
                players are losing more than you targeted (house overshooting). Positive means players are winning more (house
                bleeding). Wait for ~50 matches per tier before re-tuning — anything below that is dice variance, not signal.
                Risk-free is the count of payouts upgraded to full entry-fee refund under the first-10-matches onboarding rule.
              </div>
            </div>
          )}

          {activeSection === 'Board Themes' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <div>
                  <h2 className="text-lg font-black">Board Themes</h2>
                  <p className="mt-1 text-sm text-white/50">
                    Visual list of live and draft boards used by the lobby and gameplay.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SecondaryButton
                    onClick={() => void seedBuiltInBoards()}
                    disabled={!canManage || savingKey === 'board-seed'}
                  >
                    {savingKey === 'board-seed' ? 'Populating...' : 'Populate Current Boards'}
                  </SecondaryButton>
                  <PrimaryButton onClick={openAddBoard} disabled={!canManage}>
                    Add Board
                  </PrimaryButton>
                </div>
              </div>

              {boardMessage && (
                <div className="rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-100">
                  {boardMessage}
                </div>
              )}

              {/* Podium — the stand the board sits on in the lobby
                  carousel. A small library; exactly one is active. */}
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <div>
                  <h3 className="text-base font-black">Podium</h3>
                  <p className="mt-1 text-sm text-white/50">
                    The stand the board sits on in the lobby carousel. Upload options and pick
                    the one that&apos;s live. Wide transparent PNG/WebP works best.
                  </p>
                </div>

                {podiums.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {podiums.map((p) => (
                      <div
                        key={p.id}
                        className={`overflow-hidden rounded-lg border p-3 transition ${
                          p.is_active
                            ? 'border-amber-300/60 bg-amber-300/[0.06]'
                            : 'border-white/10 bg-black/20'
                        }`}
                      >
                        <div className="grid aspect-[16/9] place-items-center overflow-hidden rounded bg-black/40">
                          <img
                            src={p.image_url}
                            alt={p.name}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold">{p.name}</span>
                          {p.is_active && (
                            <span className="shrink-0 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-100">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={!canManage || p.is_active || savingKey === `podium-active-${p.id}`}
                            onClick={() => void activatePodium(p)}
                            className="flex-1 rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {p.is_active
                              ? 'Active'
                              : savingKey === `podium-active-${p.id}`
                              ? 'Activating...'
                              : 'Set active'}
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || p.is_active || savingKey === `podium-delete-${p.id}`}
                            onClick={() => void deletePodium(p)}
                            className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-black/20 p-3">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                    Add a podium
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="space-y-3">
                      <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                        Name
                        <input
                          type="text"
                          value={podiumDraft.name}
                          disabled={!canManage}
                          onChange={(event) =>
                            setPodiumDraft((draft) => ({ ...draft, name: event.target.value }))
                          }
                          placeholder="e.g. Royal Holder"
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-white/20 focus:border-amber-200/60 disabled:opacity-50"
                        />
                      </label>
                      <ImageField
                        label="Podium image"
                        value={podiumDraft.image_url}
                        onChange={(url) =>
                          setPodiumDraft((draft) => ({ ...draft, image_url: url }))
                        }
                        folder="podiums"
                        disabled={!canManage}
                      />
                    </div>
                    <PrimaryButton
                      onClick={() => void addPodium()}
                      disabled={!canManage || !podiumDraft.image_url.trim() || savingKey === 'podium-add'}
                    >
                      {savingKey === 'podium-add' ? 'Adding...' : 'Add podium'}
                    </PrimaryButton>
                  </div>
                </div>
              </div>

              {boards.length === 0 ? (
                <EmptyState text="No board themes yet. Use Populate Current Boards or Add Board to create one." />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {boards.map((row) => (
                    <article
                      key={row.id}
                      onClick={() => openEditBoard(row)}
                      className="group cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] shadow-xl shadow-black/15 transition hover:-translate-y-0.5 hover:border-amber-200/45"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden bg-black/25">
                        {row.lobby_background_image ? (
                          <img
                            src={row.lobby_background_image}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover opacity-40 blur-sm transition group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : null}
                        <img
                          src={row.preview_image}
                          alt={`${row.display_name} lobby preview`}
                          className="relative z-10 h-full w-full object-contain p-4 drop-shadow-[0_18px_16px_rgba(0,0,0,0.45)]"
                          loading="lazy"
                        />
                        <div className="absolute left-3 top-3 z-20">
                          <StatusPill enabled={row.is_enabled} />
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-lg font-black">{row.display_name}</h3>
                            <p className="mt-1 truncate font-mono text-xs text-white/40">{row.id}</p>
                          </div>
                          <div className="flex shrink-0 gap-2" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => openEditBoard(row)}
                              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/75 transition hover:bg-white/15"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteBoard(row)}
                              disabled={!canManage || savingKey === `board-delete-${row.id}`}
                              className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/18 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-white/55">
                          <div className="rounded-lg bg-black/18 p-2">
                            <div className="text-white/35">Level</div>
                            <div className="font-bold text-white">{row.unlock_level}</div>
                          </div>
                          <div className="rounded-lg bg-black/18 p-2">
                            <div className="text-white/35">Coins</div>
                            <div className="font-bold text-white">{formatNumber(row.price_coins)}</div>
                          </div>
                          <div className="rounded-lg bg-black/18 p-2">
                            <div className="text-white/35">Gems</div>
                            <div className="font-bold text-white">{formatNumber(row.price_gems ?? 0)}</div>
                          </div>
                          <div className="rounded-lg bg-black/18 p-2">
                            <div className="text-white/35">Sort</div>
                            <div className="font-bold text-white">{row.sort_order}</div>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {boardEditorOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                  <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/12 bg-[#0b1930] p-5 shadow-2xl shadow-black/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/65">
                          {boardEditorMode === 'add' ? 'Add Board' : 'Edit Board'}
                        </div>
                        <h2 className="mt-1 text-2xl font-black">
                          {boardEditorMode === 'add' ? 'New board theme' : boardDraft.display_name || 'Board theme'}
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBoardEditorOpen(false)}
                        className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white/70 transition hover:bg-white/15"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div>
                        <Field
                          label="Board id"
                          value={boardDraft.id}
                          disabled={boardEditorMode === 'edit'}
                          onChange={(id) => setBoardDraft((d) => ({ ...d, id }))}
                        />
                        {boardEditorMode === 'add' && boardDraft.id !== '' && !isValidBoardId(boardDraft.id) && (
                          <div className="mt-1 text-[10px] font-bold normal-case tracking-normal text-rose-300">
                            Must be lowercase letters/digits, separated by - or _.
                            Start with a letter or digit. Examples: caribbean-full, zen-garden, classic_purple.
                          </div>
                        )}
                      </div>
                      <Field label="Display name" value={boardDraft.display_name} onChange={(display_name) => setBoardDraft((d) => ({ ...d, display_name }))} />
                      <Field label="Unlock level" value={boardDraft.unlock_level} onChange={(unlock_level) => setBoardDraft((d) => ({ ...d, unlock_level }))} />
                      <Field label="Price coins" value={boardDraft.price_coins} onChange={(price_coins) => setBoardDraft((d) => ({ ...d, price_coins }))} />
                      <Field label="Gems cost" value={boardDraft.price_gems} onChange={(price_gems) => setBoardDraft((d) => ({ ...d, price_gems }))} />
                      <Field label="Sort order" value={boardDraft.sort_order} onChange={(sort_order) => setBoardDraft((d) => ({ ...d, sort_order }))} />
                    </div>
                    <div className="mt-3 space-y-3">
                      <ImageField label="Lobby image" folder={boardDraft.id} kind="preview" value={boardDraft.preview_image} onChange={(preview_image) => setBoardDraft((d) => ({ ...d, preview_image }))} />
                      <ImageField label="Gameplay image" folder={boardDraft.id} kind="gameplay" value={boardDraft.gameplay_image} onChange={(gameplay_image) => setBoardDraft((d) => ({ ...d, gameplay_image }))} />
                      <FeltCornersField
                        gameplayImage={boardDraft.gameplay_image}
                        metadata={boardDraft.metadata}
                        onMetadataChange={(metadata) => setBoardDraft((d) => ({ ...d, metadata }))}
                      />
                      <BearOffTraysField
                        gameplayImage={boardDraft.gameplay_image}
                        metadata={boardDraft.metadata}
                        onMetadataChange={(metadata) => setBoardDraft((d) => ({ ...d, metadata }))}
                      />
                      <BoardTuningField
                        metadata={boardDraft.metadata}
                        onMetadataChange={(metadata) => setBoardDraft((d) => ({ ...d, metadata }))}
                      />
                      <BoardPreview
                        gameplayImage={boardDraft.gameplay_image}
                        whiteChecker={boardDraft.white_checker_image}
                        blackChecker={boardDraft.black_checker_image}
                        metadata={boardDraft.metadata}
                      />
                      <ImageField label="Lobby background image" folder={boardDraft.id} kind="lobby-bg" value={boardDraft.lobby_background_image} onChange={(lobby_background_image) => setBoardDraft((d) => ({ ...d, lobby_background_image }))} />
                      <ImageField label="Gameplay background image" folder={boardDraft.id} kind="gameplay-bg" value={boardDraft.gameplay_background_image} onChange={(gameplay_background_image) => setBoardDraft((d) => ({ ...d, gameplay_background_image }))} />
                      <ImageField label="White checker image" folder={boardDraft.id} kind="checker-white" value={boardDraft.white_checker_image} onChange={(white_checker_image) => setBoardDraft((d) => ({ ...d, white_checker_image }))} />
                      <ImageField label="Black checker image" folder={boardDraft.id} kind="checker-black" value={boardDraft.black_checker_image} onChange={(black_checker_image) => setBoardDraft((d) => ({ ...d, black_checker_image }))} />
                      <ImageField label="Dice sprite (3 cols × 2 rows: face 1 top-left → face 6 bottom-right)" folder={boardDraft.id} kind="dice" value={boardDraft.dice_image} onChange={(dice_image) => setBoardDraft((d) => ({ ...d, dice_image }))} />
                      <ImageField label="Tray image" folder={boardDraft.id} kind="tray" value={boardDraft.tray_image} onChange={(tray_image) => setBoardDraft((d) => ({ ...d, tray_image }))} />
                      <ImageField label="Holder image" folder={boardDraft.id} kind="holder" value={boardDraft.holder_image} onChange={(holder_image) => setBoardDraft((d) => ({ ...d, holder_image }))} />
                      <TextArea label="Metadata JSON object" value={boardDraft.metadata} onChange={(metadata) => setBoardDraft((d) => ({ ...d, metadata }))} />
                      <div className="grid grid-cols-2 gap-2">
                        <Toggle label="Enabled" checked={boardDraft.is_enabled} onChange={(is_enabled) => setBoardDraft((d) => ({ ...d, is_enabled }))} />
                        <Toggle label="Featured" checked={boardDraft.is_featured} onChange={(is_featured) => setBoardDraft((d) => ({ ...d, is_featured }))} />
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <SecondaryButton onClick={() => setBoardEditorOpen(false)}>Cancel</SecondaryButton>
                        <PrimaryButton
                          onClick={() => void saveBoard()}
                          disabled={
                            !canManage ||
                            savingKey === 'board' ||
                            (boardEditorMode === 'add' && !isValidBoardId(boardDraft.id))
                          }
                        >
                          {boardEditorMode === 'add' ? 'Add board' : 'Save changes'}
                        </PrimaryButton>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === 'Lobby Features' && (
            <div className="max-w-2xl rounded-xl border border-white/10 bg-white/[0.045] p-4">
              <h2 className="text-lg font-black">Bottom-nav feature locks</h2>
              <p className="mt-1 text-xs text-white/55">
                Gate each bottom-nav feature behind a player level, like boards.
                A player below the level sees a padlock; tapping it pops a
                tooltip. Level 1 = always open (set a high level to keep a
                feature locked for everyone). Leave the tooltip text blank for
                the default "Reach level X to unlock", or set custom copy like
                "Coming soon". The center Hourly Bonus wheel is never gated.
                Disabling a feature hides its action (reserved for future use).
              </p>
              <div className="mt-4 space-y-3">
                {lobbyFeatures.length === 0 ? (
                  <p className="text-xs text-white/40">Loading…</p>
                ) : (
                  lobbyFeatures.map((f) => (
                    <div
                      key={f.feature_key}
                      className="flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="min-w-[8rem] flex-1">
                        <div className="text-sm font-black">{f.label}</div>
                        <div className="font-mono text-[10px] text-white/40">{f.feature_key}</div>
                      </div>
                      <div className="w-28">
                        <Field
                          label="Unlock level"
                          value={f.level}
                          onChange={(level) =>
                            setLobbyFeatures((rows) =>
                              rows.map((r) =>
                                r.feature_key === f.feature_key ? { ...r, level } : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <Toggle
                        label="Enabled"
                        checked={f.enabled}
                        onChange={(enabled) =>
                          setLobbyFeatures((rows) =>
                            rows.map((r) =>
                              r.feature_key === f.feature_key ? { ...r, enabled } : r,
                            ),
                          )
                        }
                      />
                      <div className="basis-full">
                        <Field
                          label="Tooltip text (optional)"
                          value={f.tooltip}
                          placeholder={`Reach level ${f.level || 'N'} to unlock`}
                          onChange={(tooltip) =>
                            setLobbyFeatures((rows) =>
                              rows.map((r) =>
                                r.feature_key === f.feature_key ? { ...r, tooltip } : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <PrimaryButton
                        onClick={() => void saveLobbyFeature(f.feature_key)}
                        disabled={!canManage || savingKey === `feature:${f.feature_key}`}
                      >
                        Save
                      </PrimaryButton>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeSection === 'Shop' && (
            <div className="space-y-4">
              {/* Store Sale — one global bonus added to every pack's coin/gem
                  grants. Players see a "+X% EXTRA" badge + the boosted amount;
                  the boost is applied server-side at purchase. */}
              <div className="rounded-xl border border-[#ffc93d]/30 bg-[#ffc93d]/[0.06] p-4">
                <h2 className="text-lg font-black text-[#ffd16f]">Store Sale</h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
                  Adds extra coins &amp; gems to every pack. Players see a “+{saleDraft.bonus_percent || '0'}% EXTRA” badge and the boosted amount; the boost is enforced server-side at purchase. Leave the dates blank for a manual on/off sale.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Label" value={saleDraft.label} onChange={(label) => setSaleDraft((d) => ({ ...d, label }))} />
                  <Field label="Bonus %" value={saleDraft.bonus_percent} onChange={(bonus_percent) => setSaleDraft((d) => ({ ...d, bonus_percent }))} />
                  <Field type="datetime-local" label="Starts at (optional)" value={saleDraft.starts_at} onChange={(starts_at) => setSaleDraft((d) => ({ ...d, starts_at }))} />
                  <Field type="datetime-local" label="Ends at (optional)" value={saleDraft.ends_at} onChange={(ends_at) => setSaleDraft((d) => ({ ...d, ends_at }))} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <Toggle label="Sale active" checked={saleDraft.is_active} onChange={(is_active) => setSaleDraft((d) => ({ ...d, is_active }))} />
                  <PrimaryButton onClick={() => void saveStoreSale()} disabled={!canManage || savingKey === 'store-sale'}>Save sale</PrimaryButton>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]">
                <ConfigTable title="Shop items" rows={shopItems.map((row) => [
                row.display_name,
                row.kind,
                moneyFromCents(row.price_cents),
                row.is_enabled ? 'Enabled' : 'Disabled',
              ])} onRowClick={(index) => setShopDraft(shopToDraft(shopItems[index]))} />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit shop item</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Product id" value={shopDraft.id} onChange={(id) => setShopDraft((d) => ({ ...d, id }))} />
                  <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                    Kind
                    <select
                      value={shopDraft.kind}
                      onChange={(event) => setShopDraft((d) => ({ ...d, kind: event.target.value as ShopKind }))}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                    >
                      {shopKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                  </label>
                  <Field label="Name" value={shopDraft.display_name} onChange={(display_name) => setShopDraft((d) => ({ ...d, display_name }))} />
                  <Field label="Sort order" value={shopDraft.sort_order} onChange={(sort_order) => setShopDraft((d) => ({ ...d, sort_order }))} />
                  <Field label="Price cents" value={shopDraft.price_cents} onChange={(price_cents) => setShopDraft((d) => ({ ...d, price_cents }))} />
                  <Field label="Price coins" value={shopDraft.price_coins} onChange={(price_coins) => setShopDraft((d) => ({ ...d, price_coins }))} />
                  <Field label="Price gems" value={shopDraft.price_gems} onChange={(price_gems) => setShopDraft((d) => ({ ...d, price_gems }))} />
                  <Field label="Max purchases" value={shopDraft.max_purchases_per_user} onChange={(max_purchases_per_user) => setShopDraft((d) => ({ ...d, max_purchases_per_user }))} />
                </div>
                <div className="mt-3 space-y-3">
                  <Field label="Description" value={shopDraft.description} onChange={(description) => setShopDraft((d) => ({ ...d, description }))} />
                  <Field label="Image URL" value={shopDraft.image_url} onChange={(image_url) => setShopDraft((d) => ({ ...d, image_url }))} />
                  <Field label="Apple product id" value={shopDraft.apple_product_id} onChange={(apple_product_id) => setShopDraft((d) => ({ ...d, apple_product_id }))} />
                  <Field label="Google product id" value={shopDraft.google_product_id} onChange={(google_product_id) => setShopDraft((d) => ({ ...d, google_product_id }))} />
                  <TextArea label="Contents JSON object" value={shopDraft.contents} onChange={(contents) => setShopDraft((d) => ({ ...d, contents }))} />
                  <TextArea label="Visibility rules JSON object" value={shopDraft.visibility_rules} onChange={(visibility_rules) => setShopDraft((d) => ({ ...d, visibility_rules }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field type="datetime-local" label="Starts at" value={shopDraft.starts_at} onChange={(starts_at) => setShopDraft((d) => ({ ...d, starts_at }))} />
                    <Field type="datetime-local" label="Ends at" value={shopDraft.ends_at} onChange={(ends_at) => setShopDraft((d) => ({ ...d, ends_at }))} />
                  </div>
                  <Toggle label="Enabled" checked={shopDraft.is_enabled} onChange={(is_enabled) => setShopDraft((d) => ({ ...d, is_enabled }))} />
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => void saveShop()} disabled={!canManage || savingKey === 'shop'}>Save shop item</PrimaryButton>
                    <SecondaryButton onClick={() => setShopDraft(shopToDraft())}>New</SecondaryButton>
                  </div>
                </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Admin Access' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
              <div className="space-y-4">
                <ConfigTable title="Admin emails" rows={adminEmailRoles.map((row) => [
                  row.email,
                  row.role,
                  row.note ?? '',
                  formatDate(row.created_at),
                ])} onRowClick={(index) => setEmailRoleDraft({
                  email: adminEmailRoles[index].email,
                  role: adminEmailRoles[index].role,
                  note: adminEmailRoles[index].note ?? '',
                })} />
                <ConfigTable title="Admin roles" rows={adminRoles.map((row) => [
                  row.profile_id,
                  row.role,
                  row.note ?? '',
                  formatDate(row.created_at),
                ])} onRowClick={(index) => setRoleDraft({
                  profile_id: adminRoles[index].profile_id,
                  role: adminRoles[index].role,
                  note: adminRoles[index].note ?? '',
                })} />
                <ConfigTable title="Audit log" rows={audit.map((entry) => [
                  formatDate(entry.created_at),
                  entry.action,
                  `${entry.entity_table} · ${entry.entity_id}`,
                  entry.actor_profile_id ?? 'system',
                ])} />
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                  <h2 className="text-lg font-black">Grant admin email</h2>
                  <div className="mt-3 space-y-3">
                    <Field label="Email" value={emailRoleDraft.email} onChange={(email) => setEmailRoleDraft((d) => ({ ...d, email }))} />
                    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                      Role
                      <select
                        value={emailRoleDraft.role}
                        onChange={(event) => setEmailRoleDraft((d) => ({ ...d, role: event.target.value as AdminRole }))}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                      >
                        {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <Field label="Note" value={emailRoleDraft.note} onChange={(note) => setEmailRoleDraft((d) => ({ ...d, note }))} />
                    <div className="flex flex-wrap gap-2">
                      <PrimaryButton onClick={() => void saveAdminEmailRole()} disabled={!canManage || savingKey === 'email-role'}>
                        Save email
                      </PrimaryButton>
                      <SecondaryButton onClick={() => setEmailRoleDraft({ email: '', role: 'viewer', note: '' })}>
                        New
                      </SecondaryButton>
                      <DangerButton
                        onClick={() => {
                          if (selectedEmailRole) void deleteAdminEmailRole(selectedEmailRole);
                        }}
                        disabled={
                          !canManage ||
                          !selectedEmailRole ||
                          selectedEmailRole.email === currentUserEmail ||
                          savingKey === `email-role-delete-${selectedEmailRole?.email ?? ''}`
                        }
                      >
                        Remove
                      </DangerButton>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                  <h2 className="text-lg font-black">Grant profile role</h2>
                  <div className="mt-3 space-y-3">
                    <Field label="Profile id" value={roleDraft.profile_id} onChange={(profile_id) => setRoleDraft((d) => ({ ...d, profile_id }))} />
                    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                      Role
                      <select
                        value={roleDraft.role}
                        onChange={(event) => setRoleDraft((d) => ({ ...d, role: event.target.value as AdminRole }))}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none"
                      >
                        {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <Field label="Note" value={roleDraft.note} onChange={(note) => setRoleDraft((d) => ({ ...d, note }))} />
                    <PrimaryButton onClick={() => void saveAdminRole()} disabled={!canManage || savingKey === 'role'}>
                      Save role
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ConfigTable({
  title,
  rows,
  onRowClick,
}: {
  title: string;
  rows: string[][];
  onRowClick?(index: number): void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.045]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState text={`No ${title.toLowerCase()} found.`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <tbody className="divide-y divide-white/10">
              {rows.map((row, index) => (
                <tr
                  key={`${title}-${index}`}
                  onClick={() => onRowClick?.(index)}
                  className={`${onRowClick ? 'cursor-pointer hover:bg-white/[0.055]' : ''} text-white/70 transition`}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${title}-${index}-${cellIndex}`}
                      className={`px-4 py-3 ${cellIndex === 0 ? 'font-bold text-white' : 'text-white/55'}`}
                    >
                      <div className="max-w-[18rem] truncate">{cell}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
