import {isSupabaseConfigured, supabase} from '../../lib/supabase';
import {isNativePlatform, pickOAuthRedirectTo} from '../../lib/nativeAuth';
import {signInWithGoogleNative} from '../../lib/nativeGoogleAuth';
import type {Session, User} from '@supabase/supabase-js';
import type {Database} from '../../../../../packages/shared/src/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

const missingConfigMessage = 'Supabase is not configured. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.';

function makeAuthRedirect(nextPath?: string): string {
  if (typeof window === 'undefined') return '/auth/callback';
  nextPath ??= `${window.location.pathname}${window.location.search}`;
  const next = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';
  return `${window.location.origin}/auth/callback?${new URLSearchParams({next}).toString()}`;
}

function requireSupabase(): void {
  if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
}

export async function getSupabaseSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null;
  const {data, error} = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signInWithGoogle(redirectTo = makeAuthRedirect()): Promise<void> {
  requireSupabase();
  if (isNativePlatform()) {
    await signInWithGoogleNative();
    return;
  }
  const {data, error} = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {redirectTo: pickOAuthRedirectTo(redirectTo), queryParams: {prompt: 'select_account'}, skipBrowserRedirect: true},
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in did not return a redirect URL.');
  window.location.assign(data.url);
}

export async function linkGoogleIdentity(redirectTo = makeAuthRedirect('/profile')): Promise<void> {
  requireSupabase();
  const session = await getSupabaseSession();
  if (!session?.user) {
    await signInWithGoogle(redirectTo);
    return;
  }
  if (isNativePlatform()) {
    await signInWithGoogleNative();
    return;
  }
  const {data, error} = await supabase.auth.linkIdentity({
    provider: 'google',
    options: {redirectTo: pickOAuthRedirectTo(redirectTo, '/profile'), queryParams: {prompt: 'select_account'}, skipBrowserRedirect: true},
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in did not return a redirect URL.');
  window.location.assign(data.url);
}

export async function signInAnonymously(): Promise<void> {
  requireSupabase();
  if ((await getSupabaseSession())?.user) return;
  const {error} = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

export async function sendMagicLink(email: string): Promise<void> {
  requireSupabase();
  const {error} = await supabase.auth.signInWithOtp({email, options: {emailRedirectTo: makeAuthRedirect('/profile')}});
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const {error} = await supabase.auth.signOut();
  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  requireSupabase();
  const {error} = await supabase.auth.signInWithPassword({email, password});
  if (error) throw error;
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
  const hasGoogleIdentity = user.app_metadata.provider === 'google' || user.identities?.some((identity) => identity.provider === 'google') === true;
  const avatarUrl = googleAvatar(user);
  const displayName = googleName(user);
  const update: Database['public']['Tables']['profiles']['Update'] = {
    is_guest: hasGoogleIdentity ? false : user.is_anonymous ?? false,
    last_seen_at: new Date().toISOString(),
  };
  if (avatarUrl) update.avatar_url = avatarUrl;
  if (displayName) update.display_name = displayName;
  if (!user.is_anonymous || hasGoogleIdentity) update.is_guest = false;

  const {
    data: existingProfile,
    error: existingProfileError
  } = await supabase
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
    let {
      data: updatedProfile,
      error: updateError
    } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', user.id)
      .select()
      .single();
    if (updateError && updateError.message.toLowerCase().includes('avatar_url')) {
      const fallbackUpdate = {...update};
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
  }
  else {
    let insertPayload: Database['public']['Tables']['profiles']['Insert'] = {
      ...baseProfileInsert(user),
      is_guest: hasGoogleIdentity ? false : user.is_anonymous ?? false,
    };
    let {
      data: insertedProfile,
      error: insertError
    } = await supabase
      .from('profiles')
      .insert(insertPayload)
      .select()
      .single();
    if (insertError && insertError.message.toLowerCase().includes('avatar_url')) {
      insertPayload = {...insertPayload};
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

/**
 * Permanently delete the signed-in user's account and all their data via the
 * self-scoped delete_my_account RPC (server-side cascade through profiles to
 * every player_ and user_ table). Irreversible. The caller should sign out after.
 * delete_my_account isn't in the generated Database types yet, so the rpc call
 * goes through a narrow cast.
 */
export async function deleteMyAccount(): Promise<void> {
  const rpc = supabase.rpc as unknown as (fn: 'delete_my_account') => PromiseLike<{
    error: { message?: string } | null
  }>;
  const {error} = await rpc('delete_my_account');
  if (error) throw new Error(error.message ?? 'Account deletion failed');
}
