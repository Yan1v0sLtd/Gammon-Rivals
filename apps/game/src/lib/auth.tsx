import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { skipToken } from '@reduxjs/toolkit/query';
import { isSupabaseConfigured, supabase } from './supabase';
import type { ProfileProgression } from '../../../../packages/shared/src/progression';
import { useOnlinePresence } from './useOnlinePresence';
import { isNativePlatform, openAuthInBrowser, pickOAuthRedirectTo } from './nativeAuth';
import { signInWithGoogleNative } from './nativeGoogleAuth';
import {
  type ActiveXpBoost,
  type LevelConfig,
  type LevelStatusTier,
  type ProfileRow,
  type UserWallet,
} from '../features/playerData/playerData';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  authInitializationStarted,
  authSessionResolved,
  authSignedOut,
  type AuthIdentity,
} from '../features/auth/authSlice';
import {
  selectActiveXpBoost,
  selectAuthInitializing,
  selectAuthUserId,
  selectCurrentProfile,
  selectCurrentWallet,
  selectIsAnonymous,
  selectIsGuest,
  selectLevelConfigs,
  selectLevelStatusTiers,
  selectProfileProgression,
} from '../features/auth/authSelectors';
import {
  useCompleteOAuthProfileMutation,
  useGetActiveXpBoostQuery,
  useGetLevelConfigsQuery,
  useGetLevelStatusTiersQuery,
  useGetProfileQuery,
  useGetWalletQuery,
  useUpdateDisplayNameMutation,
} from '../features/playerData/playerDataApi';

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

/**
 * Project a Supabase User into the serializable identity the auth slice
 * stores. Session/User objects and tokens never cross the Redux boundary.
 */
function projectAuthUser(user: User | null) {
  if (!user) return authSignedOut();
  const identity: AuthIdentity = {
    userId: user.id,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? false,
  };
  return authSessionResolved(identity);
}

export interface AuthContextValue {
  readonly session: Session | null;
  readonly user: User | null;
  readonly profile: ProfileRow | null;
  readonly wallet: UserWallet | null;
  readonly levelConfigs: readonly LevelConfig[];
  /** Declarative level → rank label config (e.g. L1-15 = Rookie,
   *  L16-40 = Skilled). Consumed by getProfileProgression to derive
   *  statusLabel without coupling to the per-row level_configs.status_label. */
  readonly levelStatusTiers: readonly LevelStatusTier[];
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
  const dispatch = useAppDispatch();

  // Supabase stays the session/token authority. The Session lives here
  // only so useAuth() can expose it for compatibility and existing auth
  // operations can read it; Redux stores just the normalized identity.
  const [session, setSession] = useState<Session | null>(null);

  const userId = useAppSelector(selectAuthUserId);
  const profile = useAppSelector(selectCurrentProfile);
  const wallet = useAppSelector(selectCurrentWallet);
  const levelConfigs = useAppSelector(selectLevelConfigs);
  const levelStatusTiers = useAppSelector(selectLevelStatusTiers);
  const activeXpBoost = useAppSelector(selectActiveXpBoost);
  const progression = useAppSelector(selectProfileProgression);
  const isAnonymous = useAppSelector(selectIsAnonymous);
  const isGuest = useAppSelector(selectIsGuest);
  const isAuthInitializing = useAppSelector(selectAuthInitializing);

  const profileQuery = useGetProfileQuery(userId ?? skipToken, {
    skip: !isSupabaseConfigured,
  });
  const walletQuery = useGetWalletQuery(userId ?? skipToken, {
    skip: !isSupabaseConfigured,
  });
  const xpBoostQuery = useGetActiveXpBoostQuery(userId ?? skipToken, {
    skip: !isSupabaseConfigured,
  });
  const levelConfigsQuery = useGetLevelConfigsQuery(undefined, {
    skip: !isSupabaseConfigured,
  });
  const levelStatusTiersQuery = useGetLevelStatusTiersQuery(undefined, {
    skip: !isSupabaseConfigured,
  });

  // The hook refetch callbacks are stable (memoized per subscription);
  // aliasing them lets the refresh helpers await the same fetch the
  // active hooks would trigger without creating extra subscriptions.
  const { refetch: refetchProfile } = profileQuery;
  const { refetch: refetchWallet } = walletQuery;
  const { refetch: refetchXpBoost } = xpBoostQuery;

  const userDataLoading =
    profileQuery.isLoading ||
    walletQuery.isLoading ||
    xpBoostQuery.isLoading ||
    profileQuery.isUninitialized ||
    walletQuery.isUninitialized ||
    xpBoostQuery.isUninitialized;

  // Config rows only gate the initial hydration; once auth + the first
  // query attempts have settled they stop contributing to isLoading so
  // a later cache reset (identity change) cannot leave AuthGate spinning.
  const [hydrationSettled, setHydrationSettled] = useState(!isSupabaseConfigured);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (isAuthInitializing) return;
    if (levelConfigsQuery.isLoading || levelStatusTiersQuery.isLoading) return;
    if (userId !== null && userDataLoading) return;
    setHydrationSettled(true);
  }, [
    isAuthInitializing,
    levelConfigsQuery.isLoading,
    levelStatusTiersQuery.isLoading,
    userId,
    userDataLoading,
  ]);

  const isLoading =
    !isSupabaseConfigured
      ? false
      : isAuthInitializing || !hydrationSettled || (userId !== null && userDataLoading);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      dispatch(authSignedOut());
      return;
    }
    dispatch(authInitializationStarted());
    let cancelled = false;
    // Once the auth subscription emits, its event is newer than any
    // still-pending getSession result, so the hydration read must stand down.
    let authEventSeen = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled || authEventSeen) return;
        setSession(data.session);
        dispatch(projectAuthUser(data.session?.user ?? null));
      } catch (err) {
        // A thrown getSession (e.g. network) must not leave auth status
        // initializing forever; settle as signed out.
        if (cancelled || authEventSeen) return;
        console.error('Failed to restore the Supabase session:', err);
        setSession(null);
        dispatch(authSignedOut());
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      authEventSeen = true;
      setSession(s);
      dispatch(projectAuthUser(s?.user ?? null));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [dispatch]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    await Promise.all([refetchProfile(), refetchWallet(), refetchXpBoost()]);
  }, [refetchProfile, refetchWallet, refetchXpBoost, userId]);

  const refreshWallet = useCallback(async () => {
    if (!userId) return;
    await refetchWallet();
  }, [refetchWallet, userId]);

  const refreshXpBoost = useCallback(async () => {
    if (!userId) return;
    await refetchXpBoost();
  }, [refetchXpBoost, userId]);

  const [completeOAuthMutation] = useCompleteOAuthProfileMutation();
  const [updateDisplayNameMutation] = useUpdateDisplayNameMutation();

  const completeOAuthProfile = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const currentUser = data.session?.user;
    if (!currentUser) {
      throw new Error('Google sign-in completed without an active session. Please try again.');
    }
    setSession(data.session);
    dispatch(projectAuthUser(currentUser));
    const result = await completeOAuthMutation(currentUser);
    if (result.error) {
      throw new Error(result.error.message);
    }
    // Post-success cache orchestration (profile upsert + wallet refresh)
    // lives in completeOAuthProfile.onQueryStarted, guarded by the
    // current Redux identity so stale user data cannot re-enter the cache.
  }, [completeOAuthMutation, dispatch]);

  const signInWithGoogle = useCallback(async (options?: { redirectTo?: string }) => {
    if (!isSupabaseConfigured) throw new Error(missingConfigMessage);
    // Native (Android): use the in-app Google account picker (Credential
    // Manager) — no browser tab — and exchange the ID token with Supabase.
    // This is what keeps the app looking like a real native app; the old
    // Custom-Tab redirect flow left the user stranded in a browser. Web
    // keeps the redirect-based OAuth flow below.
    if (isNativePlatform()) {
      await signInWithGoogleNative();
      return;
    }
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
      // Native: no browser — use the native picker + ID token, same as
      // sign-in. NOTE: Supabase has no idToken-based linkIdentity, so on
      // native this signs the user in AS the Google account rather than
      // linking it to the current guest; a guest's local progress isn't
      // carried over. Proper guest→Google migration on native is a
      // separate follow-up.
      if (isNativePlatform()) {
        await signInWithGoogleNative();
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
      const result = await updateDisplayNameMutation({
        userId: session.user.id,
        name: trimmed,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      // Post-success cache propagation (canonical row upsert into
      // getProfile) lives in updateDisplayName.onQueryStarted, guarded
      // by the current Redux identity.
    },
    [session, updateDisplayNameMutation]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      wallet,
      levelConfigs,
      levelStatusTiers,
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
      levelStatusTiers,
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
