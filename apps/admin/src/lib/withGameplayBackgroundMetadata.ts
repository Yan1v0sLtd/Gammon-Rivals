import type {Json} from "../../../../packages/shared/src/database"

export function withGameplayBackgroundMetadata(metadata: Json, value: string): Json {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
  const next: Record<string, Json> = {}
  Object.entries(source).forEach(([key, metadataValue]) => {
    if (metadataValue !== undefined) next[key] = metadataValue
  })
  const trimmed = value.trim()
  if (trimmed) {
    next.gameplayBackgroundImage = trimmed
  }
  else {
    delete next.gameplayBackgroundImage
  }
  return next
}
