import type {Json} from "../../../../packages/shared/src/database"

export function parseJson(value: string, label: string, expected: "object" | "array"): Json {
  try {
    const parsed = JSON.parse(value || (expected === "array" ? "[]" : "{}"))
    if (expected === "array" && !Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`)
    }
    if (expected === "object" && (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")) {
      throw new Error(`${label} must be a JSON object.`)
    }
    return parsed as Json
  }
  catch (err) {
    if (err instanceof Error && err.message.includes("must be")) throw err
    throw new Error(`${label} is not valid JSON.`, {cause: err})
  }
}
