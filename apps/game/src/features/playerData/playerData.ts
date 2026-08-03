import type { PostgrestError, User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../../../../packages/shared/src/database';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type UserWallet = Database['public']['Tables']['user_wallets']['Row'];
export type LevelConfig = Database['public']['Tables']['level_configs']['Row'];
export type LevelStatusTier = Database['public']['Tables']['level_status_tiers']['Row'];

/**
 * Active XP boost summary shown in the lobby + applied by the server.
 * `multiplier` is the highest across all active boost rows (matches the
 * SQL helper); `expiresAt` is the matching row's expiry. We don't track
 * per-row data on the client — the audit trail lives in the DB.
 */
export interface ActiveXpBoost {
  readonly multiplier: number;
  readonly expiresAt: string;
}

/**
 * A freshly signed-in player may not have a profile/wallet row yet while
 * the DB provisioning trigger runs. Wait one 250 ms tick before giving
 * up, exactly once, and only when the query succeeded but found nothing.
 */
const PROVISION_RETRY_DELAY_MS = 250;

async function maybeSingleWithProvisionRetry<T>(
  runQuery: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>
): Promise<T | null> {
  let { data, error } = await runQuery();
  if (!data && !error) {
    await new Promise((resolve) => setTimeout(resolve, PROVISION_RETRY_DELAY_MS));
    ({ data, error } = await runQuery());
  }
  if (error) throw error;
  return data;
}

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  return maybeSingleWithProvisionRetry(() =>
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  );
}

export async function fetchWallet(userId: string): Promise<UserWallet | null> {
  return maybeSingleWithProvisionRetry(() =>
    supabase.from('user_wallets').select('*').eq('profile_id', userId).maybeSingle()
  );
}

export async function fetchLevelConfigs(): Promise<LevelConfig[]> {
  const { data, error } = await supabase
    .from('level_configs')
    .select('*')
    .order('level', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchLevelStatusTiers(): Promise<LevelStatusTier[]> {
  const { data, error } = await supabase
    .from('level_status_tiers')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('level_from', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchActiveXpBoost(userId: string): Promise<ActiveXpBoost | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_xp_boosts')
    .select('multiplier, expires_at')
    .eq('profile_id', userId)
    .gt('expires_at', nowIso)
    .order('multiplier', { ascending: false })
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { multiplier: data.multiplier, expiresAt: data.expires_at } : null;
}

function googleName(user: User): string | null {
  const metadata = user.user_metadata as Record<string, unknown>;
  const value = metadata.full_name ?? metadata.name;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (user.email?.includes('@')) return user.email.split('@')[0]!;
  return null;
}

function googleAvatar(user: User): string | null {
  const metadata = user.user_metadata as Record<string, unknown>;
  const value = metadata.avatar_url ?? metadata.picture;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function baseProfileInsert(user: User): Database['public']['Tables']['profiles']['Insert'] {
  return {
    id: user.id,
    display_name: googleName(user) ?? 'Player',
    is_guest: user.is_anonymous ?? false,
    avatar_seed: user.id.replaceAll('-', '').slice(0, 12),
    avatar_url: googleAvatar(user),
    level: 1,
    xp: 0,
  };
}

/**
 * Finish an (usually OAuth) sign-in by upserting the matching profile
 * row. Throws on deleted accounts after signing the user out, and keeps
 * the legacy avatar_url-column fallback so a DB without that column
 * still completes sign-in. Returns the canonical profile row.
 */
export async function completeOAuthProfile(user: User): Promise<ProfileRow> {
  const hasGoogleIdentity =
    user.app_metadata.provider === 'google' ||
    user.identities?.some((identity) => identity.provider === 'google') === true;
  const avatarUrl = googleAvatar(user);
  const displayName = googleName(user);
  const update: Database['public']['Tables']['profiles']['Update'] = {
    is_guest: hasGoogleIdentity ? false : user.is_anonymous ?? false,
    last_seen_at: new Date().toISOString(),
  };
  if (avatarUrl) update.avatar_url = avatarUrl;
  if (displayName) update.display_name = displayName;
  if (!user.is_anonymous || hasGoogleIdentity) update.is_guest = false;

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (existingProfileError) throw existingProfileError;
  if (existingProfile?.deleted_at) {
    await supabase.auth.signOut();
    throw new Error('This player account was removed in the Back Office.');
  }

  let updated: ProfileRow | null;
  if (existingProfile) {
    let { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', user.id)
      .select()
      .single();
    if (updateError && updateError.message.toLowerCase().includes('avatar_url')) {
      const fallbackUpdate = { ...update };
      delete fallbackUpdate.avatar_url;
      const retry = await supabase
        .from('profiles')
        .update(fallbackUpdate)
        .eq('id', user.id)
        .select()
        .single();
      updatedProfile = retry.data;
      updateError = retry.error;
    }
    if (updateError) throw updateError;
    updated = updatedProfile;
  } else {
    let insertPayload: Database['public']['Tables']['profiles']['Insert'] = {
      ...baseProfileInsert(user),
      is_guest: hasGoogleIdentity ? false : user.is_anonymous ?? false,
    };
    let { data: insertedProfile, error: insertError } = await supabase
      .from('profiles')
      .insert(insertPayload)
      .select()
      .single();
    if (insertError && insertError.message.toLowerCase().includes('avatar_url')) {
      insertPayload = { ...insertPayload };
      delete insertPayload.avatar_url;
      const retry = await supabase
        .from('profiles')
        .insert(insertPayload)
        .select()
        .single();
      insertedProfile = retry.data;
      insertError = retry.error;
    }
    if (insertError) throw insertError;
    updated = insertedProfile;
  }
  if (!updated) throw new Error('Could not load your player profile after sign-in.');
  return updated;
}

export async function updateDisplayName(userId: string, name: string): Promise<ProfileRow> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('name cannot be empty');
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: trimmed })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Profile update returned no row.');
  return data;
}
