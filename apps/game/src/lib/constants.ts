export const EMPTY_ARRAY: readonly unknown[] = [];

export function createEmptyArray<T>() {
  return EMPTY_ARRAY as readonly T[];
}
