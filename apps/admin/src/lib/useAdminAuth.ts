import {use} from "react"

import {AdminAuthContext} from "./adminAuthContext"
import type {AdminAuthContextValue} from "./adminAuthTypes"

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = use(AdminAuthContext)
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider")
  return ctx
}
