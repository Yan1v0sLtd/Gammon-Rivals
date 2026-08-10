# Online Play Reference

> Reference · As-built · Owner: Yaniv · Compiled as-of: 2026-08-10

Describes one match lifecycle: match entry, matchmaking, play modes, turn
lifecycle, doubling cube, timers/disconnects, and result handoff. It describes
the match lifecycle, not rewards tuning (see `docs/reference/05-economy-reference.md`).

## 1. Scope and audience

For developers working on matchmaking, online match state, turn validation, and
integrity. The engine rules source of truth is `packages/engine/src/*`.

## 2. Match entry contract and query parameters

- Single source of truth: `apps/game/src/game/matchEntryPath.ts`. `MatchEntry`
  (matchId, target, turnSeconds, mode, boardId) is the lobby→gameplay payload.
  (`matchEntryPath.ts:32-39`)
- URL building: `matchEntryPath()` sets query params `opp`, `target`, `board`,
  `matchId`, `turn`. (`matchEntryPath.ts:54-70`)
- Route mapping: `'pvp'` and `'online'` → `/play/:matchId?…`; legacy AI levels
  `'easy'|'medium'|'hard'` → `/hotseat?…`. Both routes are gated by `AuthGate`.
  (`matchEntryPath.ts:20-25`; `App.tsx:61-71`)
- `parseMatchEntryParams()`: `turn` parsed and clamped to `5..600` seconds;
  `inactivityForfeitMs = max(turnSeconds * 2, 30) * 1000`; `board` is the
  per-client cosmetic theme param. (`matchEntryPath.ts:44-51`)
- Theme-blindness contract: `board` is this client's own cosmetic theme only,
  never a matchmaking dimension and never carried across players.
  (`matchEntryPath.ts:26-30`; `matchmakingData.ts:40-55`)
- Wait screen: PlayOnline renders a "Waiting for opponent…" state when
  `opponent_id === null && !is_bot`, with an owner-only "Cancel match" button.
  (`PlayOnline.tsx:262-289`; `onlineMatchData.ts:225-230`)

## 3. Difficulty and stake selection

- Tiers come from `table_configs` rows with `kind='difficulty'`, fetched via
  `useGetTableConfigsQuery("difficulty")`. (`DifficultyModal.tsx:444-448`)
- Card stats shown: XP boost %, entry fee (coins), time-to-move; CTA disabled
  when level-locked or unaffordable. (`DifficultyModal.tsx:167-268`)
- Stake is server-set: `table_configs.entry_fee_coins`, `prize_coins`,
  `prize_coins_loss`, `required_level`, `match_target`, `turn_seconds`,
  `xp_multiplier_pct`, `base_xp_win`, `ai_level`, `allow_online_pvp`,
  `server_bot`, `target_rtp_pct`. (`packages/shared/src/database.ts:717-745`)

## 4. Matchmaking: human search, bot fallback, cancellation

- Search loop: poll `find_match_in_tier` every 500ms, max 4s
  (`MATCHMAKING_MAX_SECONDS=4`, `MATCHMAKING_POLL_MS=500`); matched →
  `matchmakingMatched` with `mode: "pvp"`. (`lobbySlice.ts:6-7`;
  `matchmakingListeners.ts:52-91`)
- Server side (`20260609000000_find_match_in_tier_rpc.sql`): enqueues caller
  idempotently, matches closest-rated partner within ±200 ELO in the same tier,
  atomically debits both entry fees, creates a `mode='online'` match. Partner's
  `owner_color` randomized via coin flip. (`20260722000000_randomize_online_opener.sql`)
- Bot fallback: after the 4s timeout the listener calls `cancelMatchmakingRpc()`
  then `enterRoomAiFallback`; mode becomes `"online"` if the tier's `server_bot`
  flag is set, else the legacy `aiLevel`. (`matchmakingListeners.ts:96-122`;
  `20260718000000_server_bot_flag.sql`)
- AI level pick: rating-implied (<1300 easy, <1700 medium, else hard), tier
  `ai_level` as floor, plus a 3-win streak escalator.
- Cancellation: `matchmakingCancelled` only resets a live `"searching"` search;
  the listener runs `cancel_matchmaking` only when a search was running, never
  after `matched`. (`matchmakingListeners.ts:33-51`; `0008_matchmaking.sql:106-121`)
- Cleanup on lobby mount: `abandonStaleMatches` finalizes orphaned difficulty
  matches older than the age cap as losses. (`matchmakingListeners.ts:15-33`;
  `20260607000000_abandon_stale_matches.sql`)

## 5. Play modes

- **Online PvP** (`mode='online'`, human opponent): `/play/:matchId`
  (`PlayOnline.tsx`). Server-authoritative dice/turn-commit; Realtime pushes.
- **Server bot** (`mode='online'` + `is_bot=true`): same `/play/:matchId` route;
  human owner plays one colour, bot plays the other via `ai_move`. Client "pokes"
  `ai_move` when it is the bot's turn. NOTE: `ai_move/index.ts` header states it
  is "server capability only. NOT yet wired into the live AI match flow… Dormant
  until then" — so no tier is actually running the server bot yet.
  (`ai_move/index.ts:11-15`)
- **Local hot-seat / client-side AI:** `/hotseat`. `parseOpponent` maps
  `opp=easy|medium|hard` to a black AI; `opp=hotseat`/absent = two humans.
  (`HotSeat.tsx:38-47`) AI moves computed client-side; opening player randomized
  via `randomFirstBoard()`. (`gameplaySlice.ts:184-190`)
- Mode typing: `MatchMode = "hotseat" | \`ai-${AILevel}\` | "online"`.
(`gameplayData.ts:6`)

## 6. Turn lifecycle: roll, legal moves, commit, validation

- Roll: `invokeRollDice` → `roll_dice` edge fn. Server authenticates JWT, checks
  `mode='online'`, not finished, no turn in progress, caller is owner/opponent,
  caller colour matches the player derived from the last move; lazily creates the
  next `games` row when the previous game finished (resetting cube to 1/owner
  null); rolls `crypto.getRandomValues` dice, writes `current_turn`.
  (`roll_dice/index.ts:76-145`)
- Client computes legality from the engine: `selectLocalLegalMoves` →
  `legalMoves(board, remaining)`. `legalMoves` is pure and returns `[]` for
  unusable dice; `expandDice` quadruples doubles. (`onlineMatchSelectors.ts:336-348`;
  `engine/src/rules.ts:105-152`; `engine/src/dice.ts:30-34`)
- Submoves: `submitSubMove` optimistically patches `matches.current_turn` with
  the appended submove + consumed die. No per-submove server validation —
  validation happens at commit. (`onlineMatchApi.ts:70-96`)
- Commit: `finishTurn` → `finish_turn` edge fn. It authenticates, loads match,
  verifies participant + not finished + caller is the active player, replays all
  recorded prior moves through the shared engine mirror (rejecting
  `corrupt_history`, `game_already_won`, `turn_desync`), validates every submove
  against `legalMoves` (`illegal_move` rejects without committing), derives
  outcome via `computeBearOffResult`/`applyGameResult`, then calls
  `commit_turn_server` (service-role-only RPC) for the atomic 3-write.
  (`finish_turn/index.ts:139-215`; `20260712000000_commit_turn_server_rpc.sql`)
- End-turn gating: `selectCanEndTurn` = local turn, no winner, and
  `remaining.length===0 || legal.length===0`. (`onlineMatchSelectors.ts:431-433`)
  The old client-callable `finish_turn` RPC was revoked from authenticated users.
  (`20260713000000_lock_online_game_record.sql`)

## 7. Doubling cube, accept, drop

- Engine rules: `canOfferDouble`/`offerDouble`/`acceptDouble`/`computeDropResult`/
  `dropDouble`/`applyGameResult`. Cube dead at `target<=1`; Crawford game forbids
  doubling; cube caps at 64. (`engine/src/match.ts:51-144`)
- Client gates: `selectCanOfferDouble` requires match not finished, not between
  games, not Crawford, cube `value < 64`, owner is self (or cube unowned), no
  pending offer, local turn. (`onlineMatchSelectors.ts:435-438`)
- Offer: `offerDouble` writes `cube_offer` on `matches` — a client-direct UPDATE,
  no RPC validation. (`onlineMatchData.ts:113-125`)
- Accept: `acceptDouble` writes `cube_value*2`, `cube_owner=localColor`, clears
  offer. (`onlineMatchData.ts:127-141`)
- Drop: `dropDouble` client-direct path writes the `games` row (winner =
  offerer, `win_type='single'`, `points=cubeValue`, `dropped_double=true`,
  finished) then updates match scores, Crawford game number, and match
  winner/finished_at. (`onlineMatchData.ts:153-193`) This is flagged as not yet
  server-validated. (`finish_turn/index.ts` header)
- UI: `CubeOfferDecision` center overlay + "Waiting for opponent to accept or
  drop" pending card. (`PlayOnline.tsx:323-338`)

## 8. Timers, disconnects, forfeits, abandonment

- Turn timer: per-room `turnSeconds` from entry params; `selectTurnDeadlineMs =
localClockBase + turnSeconds*1000`, with a mount-time floor so a fresh page
  cannot forfeit on stale rows. (`onlineMatchSelectors.ts:460-463`;
  `onlineMatchSlice.ts:20-23`) Local activity resets the clock.
  (`onlineMatchListeners.ts:84-116`)
- Auto-action on expiry: a listener arms the deadline and fires `roll`
  (auto-roll) or `force-end` (finish_turn even with unplayed dice).
  (`onlineMatchListeners.ts:119-161`)
- Presence: Realtime presence channel keyed `matchId:userId`;
  `opponentPresenceChanged` records `opponentDisconnectedAt` only for an
  online→offline transition after `opponentEverOnline`. Grace
  `PRESENCE_FORFEIT_GRACE_MS = 1500`. (`onlineMatchListeners.ts:45-83`;
  `onlineMatchSlice.ts:6, 97-108`)
- Claim deadline: min of presence-forfeit deadline and inactivity deadline; the
  inactivity path is gated on it being the opponent's turn.
  (`onlineMatchListeners.ts:163-233`; `onlineMatchSelectors.ts:469-475`)
- Forfeit chain: on deadline → `opponentInactivityDeadlineReached` →
  `replace_opponent_with_ai` RPC (validates participant, `opponent_still_active`
  check, flips `mode` to `ai-{level}`, stashes `_abandonment`) then immediately
  `finalizeMatch` with abandon flags on the opponent side.
  (`onlineMatchListeners.ts:235-266`; `20260612000000_replace_opponent_with_ai.sql`)
- Abandonment payout: `finish_match` takes `ownerAbandoned`/`opponentAbandoned`;
  `grant_match_reward` pays the abandoner 0 coins but still applies ELO loss.
  (`20260714000000_finish_match_derive_payout.sql`)
- Waiting-room cancel: `cancelMatchForOwner` stamps `finished_at` on an unstarted
  match. (`onlineMatchData.ts:225-230`)

## 9. Result and payout handoff

- Natural bear-off win in PvP: derived server-side in `finish_turn`, and
  `commit_turn_server` calls `grant_match_reward` with the derived winner when
  the turn ends the match. (`20260714000000_finish_match_derive_payout.sql`)
- Forfeit/claim path: `finalizeMatch` → `finish_match` RPC with client-computed
  scores from `buildFinalizeScores`; then `grant_match_reward`.
  (`onlineMatchData.ts:214-222, 253-260`)
- Payout math: `pvp_pot = 2 * entry_fee`, rake = `pot * pvp_rake_pct / 100`,
  winner = `pot - rake - loser_consolation`, loser = `prize_coins_loss`; XP =
  `base_xp_win * (100 + xp_multiplier_pct)/100 * current_xp_multiplier`; ELO via
  k-factor 32, only when `entry_fee_paid_at` is set (paid PvP). All reward logic
  gated on `entry_fee_paid_at` to neutralize forged match rows.
  (`20260714000000…sql`)
- Client refresh: `finalizeMatch` invalidates `ActiveMatch`, `Wallet`, `Profile`,
  `XpBoost` tags. (`onlineMatchApi.ts:144-166`)

## 10. Integrity gaps and acceptance criteria

Closed:

- Turn commit is server-validated and service-role-atomic (`finish_turn` +
  `commit_turn_server`); online `moves`/`games` rows are RLS-locked to server
  writers; dice are server-authoritative (`roll_dice`); payout derives from
  replayed moves for natural wins.

Open/known gaps (documented in code):

- Drop-double game-ends are client-direct with no server validation
  (`onlineMatchData.ts:153-193`). The live single-game economy has no cube, so
  this only matters for `target>1`.
- `offerDouble`/`acceptDouble` are client-direct `matches` UPDATEs
  (`onlineMatchData.ts:113-141`) — out-of-turn cube writes are prevented only by
  RLS participant policies and UI gating, not a validated RPC.
- Forfeit/claim path trusts the client-asserted winner/scores in `finish_match`.
  (`20260714000000…sql` header)
- HotSeat/client-side-AI matches are forgeable (client-authored moves,
  client-asserted outcome). (`20260714000000…sql` header)
- `ai_move` server bot is implemented but dormant, so `server_bot` tiers and
  `replace_opponent_with_ai`-converted matches have no live server-side bot play.
  (`ai_move/index.ts:11-15`)
- Legacy `enter_room(text)` shim still exists for stale clients.
  (`20260611000000_enter_room_back_compat.sql`)
- Dice generation uses `buf[i] % 6` (modulo bias) in both edge functions.

Acceptance criteria pattern: benign race allow-list (`turn already in progress`,
`no_turn_in_progress`, `not_your_turn`, `match finished`, `match_already_finished`,
`opponent_still_active`, `race_lost`) swallowed + cache invalidation resyncs.
(`onlineMatchErrors.ts:31-47`)

### Known gaps tracked as tasks

- **Client-side rolling still reachable** — the `/hotseat` route rolls dice
  client-side, which violates the "dice are server-authoritative in online play"
  non-negotiable. See `docs/tasks/02-remove-client-side-rolling.md` for the
  problem statement, options, acceptance criteria, and code list.
- **Stale queue entries** — an unmatched `matchmaking_queue` row can survive when
  the player signs out or switches accounts during matchmaking, creating a
  ghost-opponent edge case. See `docs/tasks/01-matchmaking-queue-expiry.md` for
  the TTL proposal, acceptance criteria, and code list.

## 11. Open decisions

- When to wire `ai_move` into the live AI-match flow and flip
  `table_configs.server_bot` per tier (currently default false).
  (`ai_move/index.ts:11-15`; `20260718000000_server_bot_flag.sql`)
- Server-validating the drop-double path and the cube offer/accept path for
  `target>1` matches.
- Server-side abandonment verification for the forfeit/claim path (`finish_match`
  still trusts the claiming client).
- Whether converted (`replace_opponent_with_ai`) matches should continue as a
  playable AI game or be finalized immediately (current listener finalizes
  immediately after conversion).
- A nightly pg_cron sweep for orphan matches is suggested but not built.
  (`20260607000000_abandon_stale_matches.sql`)
- Removal of the legacy `enter_room` shim and old `finish_turn` RPC once no stale
  clients remain.
