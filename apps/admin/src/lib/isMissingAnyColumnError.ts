import {isMissingColumnError} from "./isMissingColumnError"

export function isMissingAnyColumnError(error: unknown, columnNames: readonly string[]): boolean {
  return columnNames.some((columnName) => isMissingColumnError(error, columnName))
}
