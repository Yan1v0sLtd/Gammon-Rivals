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

      const sessionValue = readStorage(window.sessionStorage, key);
      if (sessionValue !== null) return sessionValue;

      const localValue = readStorage(window.localStorage, key);
      if (localValue === null) return null;

      if (classifySupabaseStorageValue(localValue) === 'guest-session') {
        writeStorage(window.sessionStorage, key, localValue);
        removeStorage(window.localStorage, key);
      }
      return localValue;
    },
    setItem(key: string, value: string): void {
      if (typeof window === 'undefined') return;
      if (isPkceCodeVerifierKey(key)) {
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

      writeStorage(window.sessionStorage, key, value);
      writeStorage(window.localStorage, key, value);
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
