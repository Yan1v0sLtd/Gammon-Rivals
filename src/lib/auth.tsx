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
import type { Database } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type UserWallet = Database['public']['Tables']['user_wallets']['Row'];
type LevelConfig = Database['public']['Tables']['level_configs']['Row'];

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

function redirectToOAuthProvider(url: string | null): void {
  if (!url) throw new Error('Google sign-in did not return a redirect URL.');
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
  completeOAuthProfile(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [levelConfigs, setLevelConfigs] = useState<LevelConfig[]>([]);
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
    },
    [fetchWallet]
  );

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    profileFetchRef.current = null;
    walletFetchRef.current = null;
    await fetchProfile(session.user.id);
  }, [session, fetchProfile]);

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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: options?.redirectTo ?? makeAuthRedirect(),
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    redirectToOAuthProvider(data.url);
  }, []);

  const linkGoogleIdentity = useCallback(
    async (options?: { redirectTo?: string }) => {
      if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
      if (!session?.user) {
        await signInWithGoogle(options);
        return;
      }
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          redirectTo: options?.redirectTo ?? makeAuthRedirect('/profile'),
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      redirectToOAuthProvider(data.url);
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
      completeOAuthProfile,
    }),
    [
      session,
      profile,
      wallet,
      levelConfigs,
      progression,
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
      completeOAuthProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
