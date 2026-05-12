import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { Database, Json } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AdminRoleRow = Database['public']['Tables']['admin_roles']['Row'];
type AdminRole = AdminRoleRow['role'];
type LevelConfig = Database['public']['Tables']['level_configs']['Row'];
type TableConfig = Database['public']['Tables']['table_configs']['Row'];
type BoardThemeConfig = Database['public']['Tables']['board_theme_configs']['Row'];
type AuditEntry = Database['public']['Tables']['admin_audit_log']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];
type WalletTransaction = Database['public']['Tables']['wallet_transactions']['Row'];
type UserBoardInventory = Database['public']['Tables']['user_board_inventory']['Row'];
type Purchase = Database['public']['Tables']['purchases']['Row'];
type ShopItem = Database['public']['Tables']['shop_items']['Row'];
type ShopKind = ShopItem['kind'];

type AccessState = 'checking' | 'missing-config' | 'migration-missing' | 'denied' | 'allowed';
type Section =
  | 'Dashboard'
  | 'Users'
  | 'Level System'
  | 'Tables / Rooms'
  | 'Board Themes'
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
  reward_coins: string;
  reward_gems: string;
  reward_items: string;
  unlock_rules: string;
  is_enabled: boolean;
};

type TableDraft = {
  id: string;
  display_name: string;
  description: string;
  entry_fee_coins: string;
  prize_coins: string;
  required_level: string;
  match_target: string;
  allow_ai: boolean;
  allow_online: boolean;
  is_enabled: boolean;
  sort_order: string;
  metadata: string;
};

type BoardDraft = {
  id: string;
  display_name: string;
  preview_image: string;
  gameplay_image: string;
  lobby_background_image: string;
  white_checker_image: string;
  black_checker_image: string;
  dice_image: string;
  tray_image: string;
  holder_image: string;
  unlock_level: string;
  price_coins: string;
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

const sections: readonly Section[] = [
  'Dashboard',
  'Users',
  'Level System',
  'Tables / Rooms',
  'Board Themes',
  'Shop',
  'Admin Access',
];

const shopKinds: readonly ShopKind[] = [
  'coin_pack',
  'gem_pack',
  'board_theme',
  'cosmetic',
  'bundle',
  'special_offer',
];

const roleOptions: readonly AdminRole[] = ['owner', 'admin', 'support', 'viewer'];

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
    error.code === 'PGRST205' ||
    error.message?.includes('Could not find the table') === true ||
    error.message?.includes('relation') === true ||
    error.message?.includes('column') === true
  );
}

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
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
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-white/40">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
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

function levelToDraft(row?: LevelConfig): LevelDraft {
  return {
    level: row?.level.toString() ?? '',
    xp_required: row?.xp_required.toString() ?? '0',
    reward_coins: row?.reward_coins.toString() ?? '0',
    reward_gems: row?.reward_gems.toString() ?? '0',
    reward_items: jsonToString(row?.reward_items, '[]'),
    unlock_rules: jsonToString(row?.unlock_rules, '{}'),
    is_enabled: row?.is_enabled ?? true,
  };
}

function tableToDraft(row?: TableConfig): TableDraft {
  return {
    id: row?.id ?? '',
    display_name: row?.display_name ?? '',
    description: row?.description ?? '',
    entry_fee_coins: row?.entry_fee_coins.toString() ?? '0',
    prize_coins: row?.prize_coins.toString() ?? '0',
    required_level: row?.required_level.toString() ?? '1',
    match_target: row?.match_target.toString() ?? '7',
    allow_ai: row?.allow_ai ?? false,
    allow_online: row?.allow_online ?? true,
    is_enabled: row?.is_enabled ?? true,
    sort_order: row?.sort_order.toString() ?? '0',
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
    white_checker_image: row?.white_checker_image ?? '',
    black_checker_image: row?.black_checker_image ?? '',
    dice_image: row?.dice_image ?? '',
    tray_image: row?.tray_image ?? '',
    holder_image: row?.holder_image ?? '',
    unlock_level: row?.unlock_level.toString() ?? '1',
    price_coins: row?.price_coins.toString() ?? '0',
    is_enabled: row?.is_enabled ?? true,
    is_featured: row?.is_featured ?? false,
    sort_order: row?.sort_order.toString() ?? '0',
    metadata: jsonToString(row?.metadata, '{}'),
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
  const { user, profile, isLoading } = useAuth();
  const [accessState, setAccessState] = useState<AccessState>(() =>
    isSupabaseConfigured ? 'checking' : 'missing-config'
  );
  const [role, setRole] = useState<AdminRole | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('Dashboard');
  const [stats, setStats] = useState<AdminStats>(initialStats);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserDetail, setSelectedUserDetail] = useState<UserDetail | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [profileDraft, setProfileDraft] = useState({ level: '1', xp: '0', rating: '1500', admin_note: '', suspension_reason: '' });
  const [walletDraft, setWalletDraft] = useState({ currency: 'coins', amount: '', reason: '' });
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  const [tables, setTables] = useState<TableConfig[]>([]);
  const [boards, setBoards] = useState<BoardThemeConfig[]>([]);
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [adminRoles, setAdminRoles] = useState<AdminRoleRow[]>([]);
  const [roleDraft, setRoleDraft] = useState({ profile_id: '', role: 'viewer' as AdminRole, note: '' });
  const [levelDraft, setLevelDraft] = useState<LevelDraft>(() => levelToDraft());
  const [tableDraft, setTableDraft] = useState<TableDraft>(() => tableToDraft());
  const [boardDraft, setBoardDraft] = useState<BoardDraft>(() => boardToDraft());
  const [shopDraft, setShopDraft] = useState<ShopDraft>(() => shopToDraft());
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const canManage = role === 'owner' || role === 'admin';
  const selectedUser = users.find((row) => row.id === selectedUserId) ?? null;

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

  useEffect(() => {
    if (!isSupabaseConfigured || isLoading || !user) return;

    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setAccessState('checking');

      const { data, error } = await supabase
        .from('admin_roles')
        .select('role')
        .eq('profile_id', user.id)
        .maybeSingle();

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
      if (!data) {
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

      setRole(data.role);
      setAccessState('allowed');
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, user]);

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
        tableResult,
        boardResult,
        shopResult,
        auditResult,
        roleResult,
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', true),
        supabase.from('matches').select('id', { count: 'exact', head: true }),
        supabase.from('matches').select('id', { count: 'exact', head: true }).is('finished_at', null),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(120),
        supabase.from('level_configs').select('*').order('level', { ascending: true }),
        supabase.from('table_configs').select('*').order('sort_order', { ascending: true }),
        supabase.from('board_theme_configs').select('*').order('sort_order', { ascending: true }),
        supabase.from('shop_items').select('*').order('sort_order', { ascending: true }),
        supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('admin_roles').select('*').order('created_at', { ascending: false }),
      ]);

      const firstError =
        userCount.error ??
        suspendedCount.error ??
        matchCount.error ??
        activeMatchCount.error ??
        profilesResult.error ??
        levelResult.error ??
        tableResult.error ??
        boardResult.error ??
        shopResult.error ??
        auditResult.error ??
        roleResult.error;
      if (firstError) throw firstError;

      const profileRows = profilesResult.data ?? [];
      const profileIds = profileRows.map((row) => row.id);
      const wallets = profileIds.length
        ? await supabase.from('user_wallets').select('*').in('profile_id', profileIds)
        : { data: [], error: null };
      if (wallets.error) throw wallets.error;

      const walletMap = new Map((wallets.data ?? []).map((wallet) => [wallet.profile_id, wallet]));
      const adminUsers = profileRows.map((row) => ({ ...row, wallet: walletMap.get(row.id) }));

      setUsers(adminUsers);
      setLevels(levelResult.data ?? []);
      setTables(tableResult.data ?? []);
      setBoards(boardResult.data ?? []);
      setShopItems(shopResult.data ?? []);
      setAudit(auditResult.data ?? []);
      setAdminRoles(roleResult.data ?? []);
      setStats({
        users: userCount.count ?? 0,
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

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter((row) =>
      [row.display_name, row.id, row.rating.toString(), row.level.toString()]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [userSearch, users]);

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
      const payload: Database['public']['Tables']['level_configs']['Insert'] = {
        level: requiredNumber(levelDraft.level, 'Level'),
        xp_required: requiredNumber(levelDraft.xp_required, 'XP required'),
        reward_coins: requiredNumber(levelDraft.reward_coins, 'Reward coins'),
        reward_gems: requiredNumber(levelDraft.reward_gems, 'Reward gems'),
        reward_items: parseJson(levelDraft.reward_items, 'Reward items', 'array'),
        unlock_rules: parseJson(levelDraft.unlock_rules, 'Unlock rules', 'object'),
        is_enabled: levelDraft.is_enabled,
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase.from('level_configs').upsert(payload);
      if (error) throw error;
      setLevelDraft(levelToDraft());
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
      const payload: Database['public']['Tables']['table_configs']['Insert'] = {
        id: tableDraft.id.trim(),
        display_name: tableDraft.display_name.trim(),
        description: tableDraft.description.trim(),
        entry_fee_coins: requiredNumber(tableDraft.entry_fee_coins, 'Entry fee'),
        prize_coins: requiredNumber(tableDraft.prize_coins, 'Prize'),
        required_level: requiredNumber(tableDraft.required_level, 'Required level'),
        match_target: requiredNumber(tableDraft.match_target, 'Match target'),
        allow_ai: tableDraft.allow_ai,
        allow_online: tableDraft.allow_online,
        is_enabled: tableDraft.is_enabled,
        sort_order: requiredNumber(tableDraft.sort_order, 'Sort order'),
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
    try {
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
        is_enabled: boardDraft.is_enabled,
        is_featured: boardDraft.is_featured,
        sort_order: requiredNumber(boardDraft.sort_order, 'Sort order'),
        metadata: parseJson(boardDraft.metadata, 'Metadata', 'object'),
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase.from('board_theme_configs').upsert(payload);
      if (error) throw error;
      setBoardDraft(boardToDraft());
      await loadAdminData();
    } catch (err) {
      setError(err);
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

  if (accessState !== 'allowed') {
    const title =
      accessState === 'missing-config'
        ? 'Supabase is not configured'
        : accessState === 'migration-missing'
          ? 'Back Office database is not ready'
          : accessState === 'denied'
            ? 'Admin access required'
            : 'Checking admin access';

    return (
      <main className="min-h-screen bg-[#061225] text-white">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-5 px-5 text-center">
          <Link to="/" className="text-sm font-semibold text-amber-200/80 hover:text-amber-100">
            ← Back to lobby
          </Link>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
            <div className="text-xs font-bold uppercase tracking-[0.28em] text-amber-200/70">
              Gammon Rivals
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-white/60">
              {accessState === 'migration-missing'
                ? 'Apply the Back Office V1 migration to add users, wallets, inventory, purchases, and shop tables.'
                : accessState === 'denied'
                  ? 'This area is protected. Add your profile to admin_roles to unlock the Back Office.'
                  : accessState === 'missing-config'
                    ? 'Add the Supabase URL and publishable key to your local environment to use Back Office.'
                    : 'One moment while the access check finishes.'}
            </p>
            {user && accessState !== 'checking' && (
              <div className="mt-4 rounded-lg bg-black/25 px-3 py-2 text-left text-xs text-white/55">
                <div className="text-white/35">Current profile id</div>
                <div className="mt-1 break-all font-mono text-amber-100">{user.id}</div>
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
            <Link to="/" className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/75">
              ← Lobby
            </Link>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Back Office</h1>
          </div>
          <div className="text-right text-xs text-white/55">
            <div className="text-sm font-bold text-white">{profile?.display_name ?? 'Admin'}</div>
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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black">Users</h2>
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search name, id, level, rating"
                    className="w-full max-w-sm rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-200/60"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-white/10 text-sm">
                    <thead className="bg-black/20 text-left text-xs uppercase tracking-wider text-white/35">
                      <tr>
                        <th className="px-4 py-3">Player</th>
                        <th className="px-4 py-3">Level</th>
                        <th className="px-4 py-3">Wallet</th>
                        <th className="px-4 py-3">Rating</th>
                        <th className="px-4 py-3">Status</th>
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
                            <div className="font-bold text-white">{row.display_name}</div>
                            <div className="max-w-[16rem] truncate font-mono text-xs text-white/35">{row.id}</div>
                          </td>
                          <td className="px-4 py-3">L{row.level} · {formatNumber(row.xp)} XP</td>
                          <td className="px-4 py-3">
                            {formatNumber(row.wallet?.coins)} coins · {formatNumber(row.wallet?.gems)} gems
                          </td>
                          <td className="px-4 py-3">{formatNumber(row.rating)}</td>
                          <td className="px-4 py-3">
                            {row.is_suspended ? <StatusPill enabled={false} /> : <StatusPill enabled />}
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
                          <div className="mt-1 break-all font-mono text-xs text-white/35">{selectedUser.id}</div>
                        </div>
                        <StatusPill enabled={!selectedUser.is_suspended} />
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

          {activeSection === 'Level System' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
              <ConfigTable title="Levels" rows={levels.map((row) => [
                `Level ${row.level}`,
                `${formatNumber(row.xp_required)} XP`,
                `${formatNumber(row.reward_coins)} coins · ${row.reward_gems} gems`,
                row.is_enabled ? 'Enabled' : 'Disabled',
              ])} onRowClick={(index) => setLevelDraft(levelToDraft(levels[index]))} />
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit level</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Level" value={levelDraft.level} onChange={(level) => setLevelDraft((d) => ({ ...d, level }))} />
                  <Field label="XP required" value={levelDraft.xp_required} onChange={(xp_required) => setLevelDraft((d) => ({ ...d, xp_required }))} />
                  <Field label="Reward coins" value={levelDraft.reward_coins} onChange={(reward_coins) => setLevelDraft((d) => ({ ...d, reward_coins }))} />
                  <Field label="Reward gems" value={levelDraft.reward_gems} onChange={(reward_gems) => setLevelDraft((d) => ({ ...d, reward_gems }))} />
                </div>
                <div className="mt-3 space-y-3">
                  <TextArea label="Reward items JSON array" value={levelDraft.reward_items} onChange={(reward_items) => setLevelDraft((d) => ({ ...d, reward_items }))} />
                  <TextArea label="Unlock rules JSON object" value={levelDraft.unlock_rules} onChange={(unlock_rules) => setLevelDraft((d) => ({ ...d, unlock_rules }))} />
                  <Toggle label="Enabled" checked={levelDraft.is_enabled} onChange={(is_enabled) => setLevelDraft((d) => ({ ...d, is_enabled }))} />
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => void saveLevel()} disabled={!canManage || savingKey === 'level'}>Save level</PrimaryButton>
                    <SecondaryButton onClick={() => setLevelDraft(levelToDraft())}>New</SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Tables / Rooms' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
              <ConfigTable title="Rooms" rows={tables.map((row) => [
                row.display_name,
                `${formatNumber(row.entry_fee_coins)} entry`,
                `Prize ${formatNumber(row.prize_coins)}`,
                row.is_enabled ? 'Enabled' : 'Disabled',
              ])} onRowClick={(index) => setTableDraft(tableToDraft(tables[index]))} />
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

          {activeSection === 'Board Themes' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_32rem]">
              <div className="grid gap-3 md:grid-cols-2">
                {boards.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => setBoardDraft(boardToDraft(row))}
                    className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] text-left shadow-xl shadow-black/15 transition hover:border-amber-200/40"
                  >
                    <div className="aspect-[16/10] bg-black/20">
                      <img src={row.preview_image} alt="" className="h-full w-full object-contain p-3" loading="lazy" />
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-black">{row.display_name}</h2>
                          <p className="mt-1 text-xs text-white/45">{row.id}</p>
                        </div>
                        <StatusPill enabled={row.is_enabled} />
                      </div>
                      <div className="mt-3 text-xs text-white/55">
                        Level {row.unlock_level} · {formatNumber(row.price_coins)} coins
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Edit board theme</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Board id" value={boardDraft.id} onChange={(id) => setBoardDraft((d) => ({ ...d, id }))} />
                  <Field label="Display name" value={boardDraft.display_name} onChange={(display_name) => setBoardDraft((d) => ({ ...d, display_name }))} />
                  <Field label="Unlock level" value={boardDraft.unlock_level} onChange={(unlock_level) => setBoardDraft((d) => ({ ...d, unlock_level }))} />
                  <Field label="Price coins" value={boardDraft.price_coins} onChange={(price_coins) => setBoardDraft((d) => ({ ...d, price_coins }))} />
                  <Field label="Sort order" value={boardDraft.sort_order} onChange={(sort_order) => setBoardDraft((d) => ({ ...d, sort_order }))} />
                </div>
                <div className="mt-3 space-y-3">
                  <Field label="Lobby image" value={boardDraft.preview_image} onChange={(preview_image) => setBoardDraft((d) => ({ ...d, preview_image }))} />
                  <Field label="Gameplay image" value={boardDraft.gameplay_image} onChange={(gameplay_image) => setBoardDraft((d) => ({ ...d, gameplay_image }))} />
                  <Field label="Lobby background image" value={boardDraft.lobby_background_image} onChange={(lobby_background_image) => setBoardDraft((d) => ({ ...d, lobby_background_image }))} />
                  <Field label="White checker image" value={boardDraft.white_checker_image} onChange={(white_checker_image) => setBoardDraft((d) => ({ ...d, white_checker_image }))} />
                  <Field label="Black checker image" value={boardDraft.black_checker_image} onChange={(black_checker_image) => setBoardDraft((d) => ({ ...d, black_checker_image }))} />
                  <Field label="Dice image" value={boardDraft.dice_image} onChange={(dice_image) => setBoardDraft((d) => ({ ...d, dice_image }))} />
                  <Field label="Tray image" value={boardDraft.tray_image} onChange={(tray_image) => setBoardDraft((d) => ({ ...d, tray_image }))} />
                  <Field label="Holder image" value={boardDraft.holder_image} onChange={(holder_image) => setBoardDraft((d) => ({ ...d, holder_image }))} />
                  <TextArea label="Metadata JSON object" value={boardDraft.metadata} onChange={(metadata) => setBoardDraft((d) => ({ ...d, metadata }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Toggle label="Enabled" checked={boardDraft.is_enabled} onChange={(is_enabled) => setBoardDraft((d) => ({ ...d, is_enabled }))} />
                    <Toggle label="Featured" checked={boardDraft.is_featured} onChange={(is_featured) => setBoardDraft((d) => ({ ...d, is_featured }))} />
                  </div>
                  <div className="flex gap-2">
                    <PrimaryButton onClick={() => void saveBoard()} disabled={!canManage || savingKey === 'board'}>Save board</PrimaryButton>
                    <SecondaryButton onClick={() => setBoardDraft(boardToDraft())}>New</SecondaryButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'Shop' && (
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
          )}

          {activeSection === 'Admin Access' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
              <div className="space-y-4">
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
              <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                <h2 className="text-lg font-black">Grant admin role</h2>
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
