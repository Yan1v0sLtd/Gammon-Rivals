import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';
import { getProfileProgression, type ProfileProgression } from './progression';
import { useOnlinePresence } from './useOnlinePresence';
import { isNativePlatform, openAuthInBrowser, pickOAuthRedirectTo } from './nativeAuth';
import type { Database } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];
type LevelConfig = Database['public']['Tables']['level_configs']['Row'];

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

const missingConfigMessage =
  'Supabase is not configured. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.';

function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

function makeAuthRedirect(nextPath = currentRoutePath()): string {
  if (typeof window === 'undefined') return '/auth/callback';
  const next = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';
  const params = new URLSearchParams({ next });
  return `${window.location.origin}/auth/callback?${params.toString()}`;
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

/**
 * Dispatch the Supabase OAuth URL to the right surface for the
 * current platform.
 *
 *   - Web: navigate the current tab to the OAuth URL (same-page
 *     redirect → Google → Supabase callback → back to /auth/callback).
 *   - Native (Capacitor): open the URL in Chrome Custom Tabs via
 *     `@capacitor/browser`. We can't navigate the WebView itself —
 *     Google's OAuth endpoint refuses to render inside an embedded
 *     WebView (security policy / phishing prevention). The deep-link
 *     handler in src/lib/nativeAuth.ts installs the session when
 *     Supabase redirects back to gammonrivals://auth/callback.
 */
async function dispatchOAuthForPlatform(url: string | null): Promise<void> {
  if (!url) throw new Error('Google sign-in did not return a redirect URL.');
  if (isNativePlatform()) {
    await openAuthInBrowser(url);
    return;
  }
  window.location.assign(url);
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

export interface AuthContextValue {
  readonly session: Session | null;
  readonly user: User | null;
  readonly profile: ProfileRow | null;
  readonly wallet: UserWallet | null;
  readonly levelConfigs: LevelConfig[];
  readonly progression: ProfileProgression;
  /** Highest currently-active XP multiplier and its expiry, or null if
   *  no boost is active. Read by the top-bar badge; refreshed after a
   *  successful purchase via refreshXpBoost(). */
  readonly activeXpBoost: ActiveXpBoost | null;
  readonly isLoading: boolean;
  readonly isAnonymous: boolean;
  readonly isGuest: boolean;
  signInWithGoogle(options?: { redirectTo?: string }): Promise<void>;
  linkGoogleIdentity(options?: { redirectTo?: string }): Promise<void>;
  signInAnonymously(): Promise<void>;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  setDisplayName(name: string): Promise<void>;
  refreshProfile(): Promise<void>;
  /** Force a fresh fetch of the wallet row. Use after an RPC that mutates
   *  user_wallets (e.g. claim_daily_bonus, purchase_board_with_gems) so
   *  the top-bar coin/gem counters reflect the new balance. */
  refreshWallet(): Promise<void>;
  /** Re-read user_xp_boosts after a purchase that may have added one.
   *  Called from Shop.tsx; cheap (single indexed query). */
  refreshXpBoost(): Promise<void>;
  completeOAuthProfile(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [levelConfigs, setLevelConfigs] = useState<LevelConfig[]>([]);
  const [activeXpBoost, setActiveXpBoost] = useState<ActiveXpBoost | null>(null);
  const [isLoading, setLoading] = useState(isSupabaseConfigured);
  const profileFetchRef = useRef<string | null>(null);
  const walletFetchRef = useRef<string | null>(null);

  const fetchLevelConfigs = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase
      .from('level_configs')
      .select('*')
      .order('level', { ascending: true });
    if (error) {
      console.warn('level config fetch error', error);
      return;
    }
    setLevelConfigs(data ?? []);
  }, []);

  const fetchWallet = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured) return;
    if (walletFetchRef.current === userId) return;
    walletFetchRef.current = userId;
    let { data, error } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('profile_id', userId)
      .maybeSingle();
    if (!data && !error) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const retry = await supabase
        .from('user_wallets')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.warn('wallet fetch error', error);
      walletFetchRef.current = null;
      return;
    }
    if (!data) walletFetchRef.current = null;
    setWallet(data);
  }, []);

  // Read the highest-multiplier active boost. Resolved to a plain
  // {multiplier, expiresAt} so the top-bar badge can render directly
  // without filtering an array. Empty result -> null so the badge can
  // do a falsy check.
  const fetchXpBoost = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured) return;
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
    if (error) {
      console.warn('xp boost fetch error', error);
      return;
    }
    setActiveXpBoost(
      data ? { multiplier: data.multiplier, expiresAt: data.expires_at } : null
    );
  }, []);

  const fetchProfile = useCallback(
    async (userId: string) => {
      if (!isSupabaseConfigured) return;
      if (profileFetchRef.current === userId) return;
      profileFetchRef.current = userId;
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (!data && !error) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const retry = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        data = retry.data;
        error = retry.error;
      }
      if (error) {
        console.warn('profile fetch error', error);
        profileFetchRef.current = null;
        return;
      }
      if (!data) profileFetchRef.current = null;
      if (data?.deleted_at) {
        profileFetchRef.current = null;
        walletFetchRef.current = null;
        setProfile(null);
        setWallet(null);
        await supabase.auth.signOut();
        return;
      }
      setProfile(data);
      await fetchWallet(userId);
      await fetchXpBoost(userId);
    },
    [fetchWallet, fetchXpBoost]
  );

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    profileFetchRef.current = null;
    walletFetchRef.current = null;
    await fetchProfile(session.user.id);
  }, [session, fetchProfile]);

  const refreshWallet = useCallback(async () => {
    if (!session?.user) return;
    walletFetchRef.current = null;
    await fetchWallet(session.user.id);
  }, [session, fetchWallet]);

  const refreshXpBoost = useCallback(async () => {
    if (!session?.user) return;
    await fetchXpBoost(session.user.id);
  }, [session, fetchXpBoost]);

  const completeOAuthProfile = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const currentUser = data.session?.user;
    if (!currentUser) {
      throw new Error('Google sign-in completed without an active session. Please try again.');
    }

    const hasGoogleIdentity =
      currentUser.app_metadata.provider === 'google' ||
      currentUser.identities?.some((identity) => identity.provider === 'google') === true;
    const avatarUrl = googleAvatar(currentUser);
    const displayName = googleName(currentUser);
    const update: Database['public']['Tables']['profiles']['Update'] = {
      is_guest: hasGoogleIdentity ? false : currentUser.is_anonymous ?? false,
      last_seen_at: new Date().toISOString(),
    };
    if (avatarUrl) update.avatar_url = avatarUrl;
    if (displayName) update.display_name = displayName;
    if (!currentUser.is_anonymous || hasGoogleIdentity) update.is_guest = false;

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
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
        .eq('id', currentUser.id)
        .select()
        .single();
      if (updateError && updateError.message.toLowerCase().includes('avatar_url')) {
        const fallbackUpdate = { ...update };
        delete fallbackUpdate.avatar_url;
        const retry = await supabase
          .from('profiles')
          .update(fallbackUpdate)
          .eq('id', currentUser.id)
          .select()
          .single();
        updatedProfile = retry.data;
        updateError = retry.error;
      }
      if (updateError) throw updateError;
      updated = updatedProfile;
    } else {
      let insertPayload = {
        ...baseProfileInsert(currentUser),
        is_guest: hasGoogleIdentity ? false : currentUser.is_anonymous ?? false,
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

    profileFetchRef.current = currentUser.id;
    walletFetchRef.current = null;
    setSession(data.session);
    setProfile(updated);
    await fetchWallet(currentUser.id);
  }, [fetchWallet]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      await fetchLevelConfigs();
      if (data.session?.user) await fetchProfile(data.session.user.id);
      if (cancelled) return;
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        profileFetchRef.current = null;
        walletFetchRef.current = null;
        void fetchProfile(s.user.id);
      } else {
        setProfile(null);
        setWallet(null);
        setActiveXpBoost(null);
        profileFetchRef.current = null;
        walletFetchRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [fetchLevelConfigs, fetchProfile]);

  const signInWithGoogle = useCallback(async (options?: { redirectTo?: string }) => {
    if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
    // On native, swap the web redirect for our deep-link
    // `gammonrivals://auth/callback`. The native deep-link handler
    // (src/lib/nativeAuth.ts) installs the session when Supabase
    // redirects back. On web this returns the caller's URL
    // unchanged.
    const redirectTo = pickOAuthRedirectTo(options?.redirectTo ?? makeAuthRedirect());
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    await dispatchOAuthForPlatform(data.url);
  }, []);

  const linkGoogleIdentity = useCallback(
    async (options?: { redirectTo?: string }) => {
      if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
      if (!session?.user) {
        await signInWithGoogle(options);
        return;
      }
      // Same native/web split as signInWithGoogle. The `next=/profile`
      // is preserved through the deep link's query string so the
      // native handler could route back there if we wire navigation
      // into the completion listener later.
      const redirectTo = pickOAuthRedirectTo(
        options?.redirectTo ?? makeAuthRedirect('/profile'),
        '/profile'
      );
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      await dispatchOAuthForPlatform(data.url);
    },
    [session, signInWithGoogle]
  );

  const signInAnonymously = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session?.user) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: makeAuthRedirect('/profile') },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  const setDisplayName = useCallback(
    async (name: string) => {
      if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
      if (!session?.user) throw new Error('not signed in');
      const trimmed = name.trim();
      if (trimmed.length === 0) throw new Error('name cannot be empty');
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: trimmed })
        .eq('id', session.user.id)
        .select()
        .single();
      if (error) throw error;
      setProfile(data);
    },
    [session]
  );

  const isAnonymous = isSupabaseConfigured ? (session?.user?.is_anonymous ?? false) : false;
  const isGuest = profile?.is_guest ?? isAnonymous;
  const progression = useMemo(
    () => getProfileProgression(profile, levelConfigs),
    [profile, levelConfigs]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      wallet,
      levelConfigs,
      progression,
      activeXpBoost,
      isLoading,
      isAnonymous,
      isGuest,
      signInWithGoogle,
      linkGoogleIdentity,
      signInAnonymously,
      sendMagicLink,
      signOut,
      setDisplayName,
      refreshProfile,
      refreshWallet,
      refreshXpBoost,
      completeOAuthProfile,
    }),
    [
      session,
      profile,
      wallet,
      levelConfigs,
      progression,
      activeXpBoost,
      isLoading,
      isAnonymous,
      isGuest,
      signInWithGoogle,
      linkGoogleIdentity,
      signInAnonymously,
      sendMagicLink,
      signOut,
      setDisplayName,
      refreshProfile,
      refreshWallet,
      refreshXpBoost,
      completeOAuthProfile,
    ]
  );

  // Broadcast presence on the shared online-users channel whenever a
  // profile is loaded. The hook handles join/leave/rejoin on userId
  // change and tears down on tab close (WebSocket disconnect). The BO
  // online-users widget subscribes to the same channel to render the
  // live count.
  useOnlinePresence({
    profileId: profile?.id ?? null,
    isGuest,
  });

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
