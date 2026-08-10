import type {Session, User} from "@supabase/supabase-js"

import type {Database} from "../../../../packages/shared/src/database"

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

/**
 * Session + profile only. The admin role is NOT here on purpose: it comes from
 * `get_my_admin_role` through the AdminAccess RTK Query cache (see
 * AdminAuthGate), which also honours the email allowlist that a plain
 * `admin_roles` read misses.
 */
export type AdminAuthContextValue = {
  readonly session: Session | null,
  readonly user: User | null,
  readonly profile: ProfileRow | null,
  readonly isLoading: boolean,

  signInWithGoogle(): Promise<void>,

  signOut(): Promise<void>,

  refresh(): Promise<void>,
}
