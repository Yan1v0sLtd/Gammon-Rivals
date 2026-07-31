/**
 * The player's currently-selected board id, persisted client-side.
 *
 * Board theme is a PER-CLIENT cosmetic (see {@link useBoardThemeConfig}) — it
 * is never stored on the match row. The lobby writes the player's pick here;
 * match screens that are reached WITHOUT a `?board=` URL param (invite links,
 * public/queue matches, cold loads) read it back so the player still sees
 * THEIR board instead of the generic fallback placeholder.
 *
 * localStorage is durable across sessions, so even a brand-new tab opened
 * straight onto an invite link recovers the last board the player chose.
 */
const STORAGE_KEY = 'gr:selectedBoardId';

export function getPersistedBoardId(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    // Storage unavailable (private mode / SSR / sandbox) — non-fatal.
    return null;
  }
}

export function setPersistedBoardId(id: string | null | undefined): void {
  try {
    // Never clobber a real stored pick with an empty/placeholder value.
    if (id && id.trim()) localStorage.setItem(STORAGE_KEY, id.trim());
  } catch {
    // Storage unavailable — non-fatal.
  }
}
