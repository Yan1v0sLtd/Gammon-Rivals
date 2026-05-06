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
import { supabase } from './supabase';
import type { Database } from '../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface AuthContextValue {
  readonly session: Session | null;
  readonly user: User | null;
  readonly profile: ProfileRow | null;
  readonly isLoading: boolean;
  readonly isAnonymous: boolean;
  signInAnonymously(): Promise<void>;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  setDisplayName(name: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [isLoading, setLoading] = useState(true);
  const profileFetchRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    if (profileFetchRef.current === userId) return;
    profileFetchRef.current = userId;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('profile fetch error', error);
      profileFetchRef.current = null;
      return;
    }
    setProfile(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) await fetchProfile(data.session.user.id);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        profileFetchRef.current = null;
        fetchProfile(s.user.id);
      } else {
        setProfile(null);
        profileFetchRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // Auto-create an anonymous session if none exists. Guest-by-default.
  useEffect(() => {
    if (isLoading) return;
    if (session) return;
    (async () => {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('signInAnonymously failed', error);
      }
    })();
  }, [isLoading, session]);

  const signInAnonymously = useCallback(async () => {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const setDisplayName = useCallback(
    async (name: string) => {
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

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isLoading,
      isAnonymous: session?.user?.is_anonymous ?? false,
      signInAnonymously,
      sendMagicLink,
      signOut,
      setDisplayName,
    }),
    [session, profile, isLoading, signInAnonymously, sendMagicLink, signOut, setDisplayName]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
