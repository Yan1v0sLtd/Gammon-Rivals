import type {Json} from "../../../../packages/shared/src/database"

export function jsonToString(value: Json | null | undefined, fallback = "{}"): string {
  if (value === null || value === undefined) return fallback
  return JSON.stringify(value, null, 2)
}
