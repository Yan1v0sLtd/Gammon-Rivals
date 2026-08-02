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
import { adminSupabase, isAdminSupabaseConfigured } from './adminSupabase';
import type { Database } from '../../../../packages/shared/src/database';

/**
 * Auth context for the Back Office. Mirrors the shape of the game's
 * AuthContext but uses adminSupabase (separate session storage) so the
 * BO's signed-in identity is independent of whatever the game tab is
 * doing.
 *
 * Two things this context resolves up front and exposes to Admin.tsx:
 *   1. session / user from adminSupabase.auth — the Google-signed-in
 *      operator (or null if they haven't signed in yet).
 *   2. profile + role — the matching public.profiles row + their
 *      admin_roles entry. Together they answer "can this person manage
 *      content?" without Admin.tsx having to duplicate the lookup.
 */

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AdminRole = 'owner' | 'admin' | 'support' | 'viewer';

export interface AdminAuthContextValue {
  readonly session: Session | null;
  readonly user: User | null;
  readonly profile: ProfileRow | null;
  readonly role: AdminRole | null;
  readonly isLoading: boolean;
  readonly canManage: boolean;
  readonly isReady: boolean;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const missingConfigMessage =
  'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use the back office.';

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [isLoading, setLoading] = useState(isAdminSupabaseConfigured);

  const fetchProfileAndRole = useCallback(async (userId: string) => {
    if (!isAdminSupabaseConfigured) return;
    const [profileRes, roleRes] = await Promise.all([
      adminSupabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      adminSupabase.from('admin_roles').select('role').eq('profile_id', userId).maybeSingle(),
    ]);
    if (profileRes.error) {
      console.warn('admin profile fetch error', profileRes.error);
    }
    setProfile(profileRes.data ?? null);
    setRole((roleRes.data?.role as AdminRole | undefined) ?? null);
  }, []);

  useEffect(() => {
    if (!isAdminSupabaseConfigured) return;
    let cancelled = false;
    // Remember the last userId we fetched profile/role for so token
    // refreshes (which fire onAuthStateChange with a fresh session
    // object but the same user) don't trigger a noisy refetch.
    // Without this guard, every TOKEN_REFRESHED event re-ran
    // fetchProfileAndRole, causing extra renders downstream that
    // could chain into Admin.tsx flipping back to its access-check
    // placeholder.
    let lastFetchedUserId: string | null = null;
    (async () => {
      const { data } = await adminSupabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) {
        await fetchProfileAndRole(data.session.user.id);
        lastFetchedUserId = data.session.user.id;
      }
      if (cancelled) return;
      setLoading(false);
    })();

    const { data: sub } = adminSupabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      const nextUserId = s?.user?.id ?? null;
      if (nextUserId && nextUserId !== lastFetchedUserId) {
        lastFetchedUserId = nextUserId;
        void fetchProfileAndRole(nextUserId);
      } else if (!nextUserId) {
        lastFetchedUserId = null;
        setProfile(null);
        setRole(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfileAndRole]);

  const signInWithGoogle = useCallback(async () => {
    if (!isAdminSupabaseConfigured) throw new Error(missingConfigMessage);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { data, error } = await adminSupabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (!data.url) throw new Error('Google sign-in did not return a redirect URL.');
    window.location.assign(data.url);
  }, []);

  const signOut = useCallback(async () => {
    if (!isAdminSupabaseConfigured) return;
    await adminSupabase.auth.signOut();
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) return;
    await fetchProfileAndRole(session.user.id);
  }, [session, fetchProfileAndRole]);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role,
      isLoading,
      canManage: role === 'owner' || role === 'admin',
      isReady: !isLoading,
      signInWithGoogle,
      signOut,
      refresh,
    }),
    [session, profile, role, isLoading, signInWithGoogle, signOut, refresh]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
