export const EMPTY_ARRAY: readonly unknown[] = []

export function createEmptyArray<T>(..._type: readonly T[]) {
  return EMPTY_ARRAY as readonly T[]
}
