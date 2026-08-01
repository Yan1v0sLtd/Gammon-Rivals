import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@shared/types/database';

/**
 * Independent Supabase client used exclusively by the Back Office.
 *
 * Why a separate client? The game's `supabase` client manages a session
 * that doubles as the player identity — when an operator wants to test
 * the game as a guest while administering as their Google account, the
 * two sessions need to live side-by-side. We isolate them via a
 * different `storageKey`, which Supabase uses as the localStorage
 * prefix for the persisted session.
 *
 * Other differences from the game client:
 *   - Always uses localStorage (no hybrid session-vs-local switching).
 *     The BO is an operator tool — no anonymous-session story to handle.
 *   - `detectSessionInUrl: true` so the /admin/auth/callback page can
 *     simply mount and supabase-js picks up the PKCE code automatically.
 *
 * The PKCE code-verifier is stored under `${storageKey}-code-verifier`,
 * also in localStorage, so the verifier the BO writes when initiating
 * Google OAuth is the same verifier that gets read at the callback.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const missingConfigMessage =
  'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use the back office.';

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

export const isAdminSupabaseConfigured = Boolean(url && key);

export const adminSupabase: SupabaseClient<Database> = isAdminSupabaseConfigured
  ? createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'sb-admin-auth-token',
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
  : createMissingSupabaseClient();
