import {createContext} from "react"

import type {AdminAuthContextValue} from "./adminAuthTypes"

export const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)
