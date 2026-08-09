import type {Json} from "../../../../packages/shared/src/database"

export function metadataText(metadata: Json | null | undefined, key: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return ""
  const value = metadata[key]
  return typeof value === "string" ? value : ""
}
