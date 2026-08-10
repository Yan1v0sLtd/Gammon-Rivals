# Task: Remove client-side dice rolling — server-authoritative dice only

## Problem

The browser can still roll dice. The `/hotseat` route (`apps/game/src/pages/HotSeat.tsx` → `apps/game/src/game/useGame.ts`) rolls client-side:

- Human turn: `rollDice()` calls `rollDie()` from `packages/engine/src/dice.ts` and sets `diceRoll`/`remaining` locally.
- AI turn: the local AI rolls via the same `rollDie()` after `AI_ROLL_DELAY` (500 ms), then picks a move in the browser.
- The opening player is decided client-side by `randomFirstBoard()` (a `Math.random()` coin flip).

This path is reachable from the product, not just a dev tool:

- `enter_room_ai_fallback` uses `effective_is_bot := coalesce(cfg.server_bot, false)`. Every tier defaults to `server_bot = false`, so a player queuing alone is routed to `mode = 'ai-<level>'` → `matchEntryPath` sends that to `/hotseat`.
- HotSeat then creates/records the match via client-side `createMatch`/`saveGame` (`lib/persistence`).

This violates the non-negotiable "dice are server-authoritative in online play" (`CLAUDE.md`) and silently keeps a client-rolled AI game as the default experience for solo players.

The headless uses of the engine's `roll()` must stay: `packages/engine/src/dice.ts` is pure logic consumed by tests, `packages/sim`, and the Deno mirror (`supabase/functions/_shared/engine/dice.ts`). The problem is the app calling it, not the function existing.

## Proposed follow-up

1. **Remove browser rolling.** Strip `rollDie()`/`expandDice()` from `useGame.ts` (human + AI turn) and remove the `randomFirstBoard` coin flip.
2. **Decide `/hotseat` fate — pick one:**
   - **Option A (recommended): delete the local-play path.** Remove the `/hotseat` route, `HotSeat.tsx`, `useGame.ts`, the legacy `ai-%` modes, and `modeFromAi`/`createMatch` AI branches. `matchEntryPath` then routes only `pvp`/`online`. Flip `enter_room_ai_fallback` so every AI game is a server bot (`effective_is_bot := true`, `mode = 'online'`) — or gate `allow_ai` tiers on `server_bot = true`.
   - **Option B: keep same-device play, make it server-authoritative.** Route hotseat through the online path: match row created server-side, rolls via `roll_dice`, moves via `finish_turn`. Larger lift; only worth it if same-device play is a product requirement.
3. **Enforce mechanically.** Extend `scripts/check-app-boundaries.mjs` (or an eslint `no-restricted-imports` rule) to reject any import of dice/roll-producing code from `apps/**`. "No way to roll in the browser" must be a build failure, not a convention.
4. **Clean up fallbacks.** Remove the `fallback.aiLevel` branch in `apps/game/src/features/lobby/matchmakingListeners.ts`, the legacy mode routing in `matchEntryPath.ts`, and the `AI_ROLL_DELAY`/`AI_LEVELS`-driven UI in HotSeat.

## Relevant code

- `apps/game/src/game/useGame.ts` — client rolls: human `rollDice()` (~line 249), AI turn roll (~line 481), `randomFirstBoard()` (~line 57).
- `apps/game/src/pages/HotSeat.tsx` — `/hotseat` route; `createMatch`/`saveGame`/`modeFromAi` usage.
- `apps/game/src/game/matchEntryPath.ts` — routes anything that is not `pvp`/`online` to `/hotseat`.
- `apps/game/src/features/lobby/matchmakingListeners.ts` — AI-fallback branch dispatches `mode: fallback.aiLevel` when the server returns a non-bot match.
- `apps/game/src/features/lobby/matchmakingData.ts` — `enterRoomAiFallback()` client wrapper.
- `../archive/migrations/20260718000000_server_bot_flag.sql` (and later recreations: `20260719000000`, `20260722000000`) — `enter_room_ai_fallback` defaults `server_bot` to false.
- `packages/engine/src/dice.ts` — keep: pure logic for tests, sim, and the server mirror.
- `packages/sim/src/playGame.ts`, `tools/economy-sim/sim.mjs` — keep: headless sims, not the browser game.
- `supabase/functions/roll_dice/index.ts`, `supabase/functions/ai_move/index.ts` — the authoritative rolls.

## Acceptance criteria

- No file under `apps/**` imports dice-rolling code or can produce a `DiceRoll`; the boundary check fails the build otherwise.
- Every product roll — human or bot — is generated in an edge function (`roll_dice`, or `ai_move` for the server bot) and arrives via the match row / Realtime.
- A solo player queuing in the lobby always lands in a server-authoritative match (`pvp` or `mode = 'online'` bot), never `/hotseat`.
- PvP matchmaking, realtime sync, and reconnect behavior are unchanged.
- `npm test` and `npm run sim` still use the engine's `roll()`/`seededRng` — unchanged.
- Hotseat either no longer exists (Option A) or rolls server-side (Option B).

## Scope note

Task only — nothing in this report is implemented. The online PvP path already satisfies the requirement; the work is removing the hotseat/legacy-AI escape hatch and adding the mechanical guard so it cannot regress.
