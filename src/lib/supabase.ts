import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const missingConfigMessage =
  'Supabase is not configured. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use auth, profiles, online play, lobby, and replays.';

type StorageValueKind = 'guest-session' | 'persistent-session' | 'other';

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be blocked in private modes. Supabase will still keep the
    // in-memory session for the current page lifetime.
  }
}

function removeStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort cleanup.
  }
}

function isPkceCodeVerifierKey(key: string): boolean {
  return key.endsWith('-code-verifier') || key.includes('code-verifier');
}

function classifySupabaseStorageValue(value: string): StorageValueKind {
  try {
    const parsed = JSON.parse(value) as {
      currentSession?: { user?: { is_anonymous?: boolean } };
      session?: { user?: { is_anonymous?: boolean } };
      user?: { is_anonymous?: boolean };
    };
    const user =
      parsed.currentSession?.user ??
      parsed.session?.user ??
      parsed.user;
    if (!user) return 'other';
    return user.is_anonymous ? 'guest-session' : 'persistent-session';
  } catch {
    return 'other';
  }
}

function createHybridAuthStorage() {
  return {
    getItem(key: string): string | null {
      if (typeof window === 'undefined') return null;
      if (isPkceCodeVerifierKey(key)) {
        return readStorage(window.localStorage, key) ?? readStorage(window.sessionStorage, key);
      }

      // sessionStorage is the tab-local source of truth. If we have a
      // session here it's ours.
      const sessionValue = readStorage(window.sessionStorage, key);
      if (sessionValue !== null) return sessionValue;

      const localValue = readStorage(window.localStorage, key);
      if (localValue === null) return null;

      // A guest session in localStorage shouldn't exist with the new
      // setItem rules. If we find one (legacy data from before the
      // fix, or some path I haven't audited), nuke it and return null
      // instead of adopting it as our session. Adopting would re-
      // create the very cross-tab leak we just plugged: tab A signs
      // in as guest, tab B reads here, finds the leaked guest in
      // localStorage, and "switches" to A's user.
      if (classifySupabaseStorageValue(localValue) === 'guest-session') {
        removeStorage(window.localStorage, key);
        return null;
      }
      // Persistent sessions in localStorage are intentional — they're
      // how a Google sign-in survives a browser restart and stays in
      // sync across tabs.
      return localValue;
    },
    setItem(key: string, value: string): void {
      if (typeof window === 'undefined') return;
      if (isPkceCodeVerifierKey(key)) {
        // PKCE verifiers need to survive the OAuth round-trip even if
        // it lands in a new tab, so keep the dual write.
        writeStorage(window.localStorage, key, value);
        writeStorage(window.sessionStorage, key, value);
        return;
      }

      const kind = classifySupabaseStorageValue(value);
      if (kind === 'guest-session') {
        writeStorage(window.sessionStorage, key, value);
        removeStorage(window.localStorage, key);
        return;
      }
      if (kind === 'persistent-session') {
        writeStorage(window.localStorage, key, value);
        removeStorage(window.sessionStorage, key);
        return;
      }

      // Unclassified value (no user yet, or partial state mid-init).
      // CRITICAL: do NOT touch localStorage here. supabase-js fires a
      // brief intermediate write before the full user is attached;
      // that write would otherwise land in localStorage and trigger a
      // storage event in every other tab, whose supabase listeners
      // would pick the value up and switch to the new session. Even
      // though the next classified write cleans it up, the damage is
      // done — the cross-tab leak the user reported. Keep it confined
      // to sessionStorage so the leak path doesn't exist.
      writeStorage(window.sessionStorage, key, value);
    },
    removeItem(key: string): void {
      if (typeof window === 'undefined') return;
      removeStorage(window.sessionStorage, key);
      removeStorage(window.localStorage, key);
    },
  };
}

function createMissingSupabaseClient(): SupabaseClient<Database> {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(missingConfigMessage);
      },
    }
  ) as SupabaseClient<Database>;
}

export const isSupabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient<Database> = isSupabaseConfigured
  ? createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storage: createHybridAuthStorage(),
      },
    })
  : createMissingSupabaseClient();
