# Bug: Mission reroll swaps the template but keeps the old goal

> Confirmed · Server-side · Extracted from `docs/reference/02-daily-missions-reference.md` §5

## Problem

`reroll_mission(p_mission_id)` replaces a daily mission with a new template but
never writes the new goal. The row keeps the goal of the mission it replaced.

The player sees the new mission — new title, art, and copy — while progress is
measured against the previous mission's goal. Depending on which two templates
met, the new mission is either trivially easy or impossible.

## Evidence

`../archive/migrations/20260626000000_daily_missions_v5_chests_streak_reroll.sql`:

- `:437-447` resolves the new goal correctly into the local `v_resolved_goal`
  (fixed templates take `goal_value`; personalized templates clamp
  `baseline_7d · stretch_factor` between `goal_min` and `goal_max`).
- `:453` writes `resolved_goal = resolved_goal` — a self-assignment. The column
  keeps its previous value.
- `:472` returns the correct `v_resolved_goal` in the JSON response, so the RPC
  reply looks right and hides the defect.

The local variable was renamed to `v_resolved_goal` to fix an "ambiguous column
reference" error (`:336-340`). The `update` statement was not renamed with it.

The client cannot mask the problem: `rerollMission()` discards the RPC response
(`apps/game/src/features/lobby/lobbyData.ts:317-319`, returns `Promise<void>`)
and the modal refetches mission state, so the player is shown the stale goal
from the row, not the correct goal from the response.

## Reproduction

1. Open Missions and reroll a Common mission whose goal differs from the
   replacement template's goal.
2. Read the goal shown on the new card after the refetch.
3. Compare it with `player_daily_missions.resolved_goal` for that row, and with
   the `resolved_goal` value in the `reroll_mission` response.

The card and the row show the old goal; the response shows the new one.

## Impact

- Rerolled missions are unwinnable or free, at random.
- Gems are charged for rerolls after the first (`gem_cost_ladder`, default
  `[0, 25, 75, 200]`), so a paid action produces a broken mission.
- Mission completion drives the streak and the streak chest, so a stuck mission
  blocks a reward chain rather than one card.

## Fix

Write the resolved goal:

```sql
set mission_template_id = new_template.id,
    resolved_goal = v_resolved_goal,
```

Ship it as a new migration that replaces the function. Do not edit the applied
migration.

Existing rows rerolled before the fix keep a wrong goal. Decide whether to leave
them until the nightly reassignment clears them, or to repair them in the same
migration.

## Acceptance criteria

- After a reroll, `player_daily_missions.resolved_goal` equals the goal in the
  RPC response for both `fixed` and personalized templates.
- Progress on a rerolled mission is measured against the new template's goal,
  and the card shows that goal after a refetch.
- Reroll cost, the daily cap, the same-rarity replacement rule, and the
  3-day template exclusion are unchanged.
- `mission_rerolls` logging and the returned `next_reroll_cost` are unchanged.
- Claiming a rerolled mission pays the new template's reward.
