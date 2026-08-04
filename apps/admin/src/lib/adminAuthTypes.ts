import type {Session, User} from "@supabase/supabase-js"

import type {Database} from "../../../../packages/shared/src/database"

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
export type AdminRole = "owner" | "admin" | "support" | "viewer"

export type AdminAuthContextValue = {
  readonly session: Session | null,
  readonly user: User | null,
  readonly profile: ProfileRow | null,
  readonly role: AdminRole | null,
  readonly isLoading: boolean,
  readonly canManage: boolean,
  readonly isReady: boolean,

  signInWithGoogle(): Promise<void>,

  signOut(): Promise<void>,

  refresh(): Promise<void>,
}
