/**
 * Pull a human-readable message out of any `unknown` error.
 *
 * Why this exists: `supabase.rpc(...)` returns errors as plain objects
 * shaped like a PostgrestError (`{ message, details, hint, code }`),
 * NOT as JavaScript `Error` instances. The very common pattern
 *
 *     err instanceof Error ? err.message : String(err)
 *
 * therefore renders Supabase RPC failures as the literal text
 * `[object Object]` — both useless to the user and useless for
 * triage. This helper falls back to the object's `message` /
 * `details` / `hint` fields before giving up on `String(err)`.
 *
 * Returns an empty string only when the error itself is null /
 * undefined; callers can use that to decide between a specific
 * message and a generic "try again" copy.
 */
export function extractErrorMessage(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      error?: unknown;
    };
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
    if (typeof obj.details === 'string' && obj.details.length > 0) return obj.details;
    if (typeof obj.hint === 'string' && obj.hint.length > 0) return obj.hint;
    // Some wrappers nest the original error under `.error`.
    if (obj.error) return extractErrorMessage(obj.error);
  }
  // Last resort — gives `"[object Object]"` for truly opaque cases,
  // but at that point we've already inspected the common shapes.
  return String(err);
}
