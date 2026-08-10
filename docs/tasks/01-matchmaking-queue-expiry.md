# Task: Expire stale matchmaking queue entries

## Problem

An unmatched `matchmaking_queue` row can survive when the player signs out or switches accounts during matchmaking.

The client cannot reliably remove the old row after an identity change:

- `cancel_matchmaking()` deletes only `profile_id = auth.uid()`.
- Supabase changes the active session before the auth event reaches Redux.
- By the time listener middleware handles the identity change, the previous user's JWT is unavailable.
- Calling the RPC would therefore target the new user or fail after sign-out.

The client should still cancel its local polling workflow on identity changes, but server queue cleanup requires a separate backend change.

## Proposed follow-up

Add server-side expiry for unmatched queue rows. A safe approach is to prune or exclude rows whose `created_at` is older than a short TTL before selecting a partner in `find_match_in_tier`.

Current timing supports a conservative TTL:

- The client polls every 500 ms.
- Each poll refreshes the caller's queue `created_at`.
- A client search lasts at most four seconds.
- A TTL around 15 seconds leaves ample tolerance while preventing abandoned rows from becoming ghost opponents.

Consider adding a partial index on `created_at` where `matched_match_id is null` if pruning is performed during matchmaking.

## Relevant code

- `apps/game/src/features/lobby/matchmakingListeners.ts` — matchmaking polling, cancellation and AI fallback.
- `apps/game/src/features/auth/authListeners.ts` — identity-change handling.
- `apps/game/src/features/lobby/matchmakingData.ts` — `cancelMatchmakingRpc()` and `findMatchInTier()`.
- `../archive/migrations/0008_matchmaking.sql` — queue schema and auth-scoped cancellation RPC.
- `../archive/migrations/20260722000000_randomize_online_opener.sql` — latest `find_match_in_tier` definition.

## Acceptance criteria

- Stale unmatched rows cannot be selected as opponents.
- Active polling rows are not removed.
- Sign-out or account switching cannot leave a ghost opponent that is later charged an entry fee.
- Existing matchmaking RPC signatures and generated database types remain unchanged unless a new contract is intentionally introduced.
- PvP matching, user cancellation, timeout, and AI fallback behavior remain unchanged.

## Scope note

This is intentionally deferred. The current work is limited to client-side Redux refactoring and must not introduce a database migration.
