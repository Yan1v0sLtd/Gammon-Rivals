/**
 * Single documented definition of the lobby→gameplay handoff payload.
 *
 * `useLobbyMatchmaking` builds the destination URL from the `matched`
 * matchmaking state plus the player's selected board id; this module is that
 * construction, so the query-string contract between match entry and the
 * gameplay routes lives in one place.
 *
 * Route mapping by `mode`:
 * - `'pvp'` (human opponent) and `'online'` (server bot fallback) → `/play/:matchId`
 * - Legacy AI levels `'easy' | 'medium' | 'hard'` → `/hotseat`
 *
 * Query params consumed by each route:
 * - `PlayOnline` reads `turn` (per-turn forfeit timer) and `board` (theme).
 * - `HotSeat` reads `opp`, `target`, `board`, `matchId` (reuse an existing
 *   server-created match row instead of creating a new one) and `turn`.
 *
 * `HotSeat` also honors a dev-only `align` query flag that enables an
 * alignment-tooling mode for the renderer; match entry never produces it.
 *
 * Theme-blindness: `board` is THIS player's own cosmetic theme, written into
 * their own URL only — the opponent writes their own, so both clients differ
 * on the same `matchId`. Theme is per-client cosmetic, never a matchmaking
 * dimension and never carried across players.
 */

/** Everything match entry knows about a matched room, as URL-able primitives. */
export interface MatchEntry {
  readonly matchId: string;
  readonly target: number;
  readonly turnSeconds: number;
  /** One of `'pvp' | 'online' | 'easy' | 'medium' | 'hard'` (plain string from the matchmaking RPCs). */
  readonly mode: string;
  readonly boardId: string;
}

/** Full route path + query string to navigate into for a matched room. */
export function matchEntryPath(entry: MatchEntry): string {
  const { matchId, target, turnSeconds, mode, boardId } = entry;
  const params = new URLSearchParams();
  params.set('opp', mode === 'pvp' ? 'pvp' : mode);
  params.set('target', String(target));
  params.set('board', boardId);
  params.set('matchId', matchId);
  params.set('turn', String(turnSeconds));
  const query = params.toString();
  return mode === 'pvp' || mode === 'online' ? `/play/${matchId}?${query}` : `/hotseat?${query}`;
}
