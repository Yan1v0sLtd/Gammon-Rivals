# Daily Missions — Personalized Generator + Adaptive Difficulty

Status: design signed off 2026-06-14. Supersedes the generic "metric + goal" template model.

## Principle
Per-individual personalization, **no clusters / no segmentation**. Every mission type plugs into one shared **generator spine**; difficulty is governed by a shared **closed-loop controller** so missions track each player's habit and never ratchet into a stuck state. Rewards are **self-funding** (a % of the player's own expected loss).

This rides on top of the existing engine (idempotent `progress_mission` events, `claim_mission` reward grant, streak, chests, reroll, crons) — that engine is kept; we change how goals + rewards are *generated* and add an adaptive-difficulty layer.

## A. Generator spine — every type implements 4 hooks
1. `focus(player)` — the personalized facet (e.g. most-played tier). Type-specific.
2. `baseline(player, focus)` — slow, robust, *observational* estimate. Type-specific input; shared statistic.
3. `goal(...)` — the adaptive controller (shared, §C).
4. `reward(goal)` — `round( b × expected_loss(goal) )`, floored/capped (shared, §D).

Operator tunes coefficients per type (§G); spine + controller + reward are shared code.

## B. Baseline (observational, slow)
- **Statistic:** median (outlier-resistant) over **last 30 active days OR last 60 matches**, whichever comes first. Active day = ≥1 match.
- **Cold start** (<~10 matches): global default (no clusters) — default tier = lowest, default count = 2.
- Deliberately slow so mission-chasing doesn't inflate it — the **controller**, not the baseline, drives challenge.

## C. Adaptive difficulty controller (the core)
Per **(player, mission_type)** store: `target`, `last_completed_target`, `consecutive_misses`.
- **Cold start:** `target = clamp(ceil(baseline × 1.3))`.
- **On complete:** `target = min(cap, target + 1)`; `consecutive_misses = 0`. *(slow, earned ramp)*
- **On miss:** `consecutive_misses++`; when it reaches **2**: `target = max(floor, ceil(last_completed_target × 0.75))`; reset counter. *(fast relief, to a proven-winnable level)*
- **Clamps:** `floor = max(1, ceil(baseline × 0.5))`, `cap = ceil(baseline × 2)`.
- **Anchor-to-last-completed:** the goal only advances from levels the player has actually beaten → structurally cannot run away.
- Hysteresis (ease only at 2 misses) prevents flapping; **invisible** to the player; reset `target` toward neutral after long inactivity.

Chosen tuning = engagement-without-frustration: **ease fast (2 misses, ×0.75), ramp slow (+1)**.

## D. Reward (self-funding, economy-safe)
`reward = round_to_50( max(floor_reward, b × goal × tier_fee × (1 − effective_RTP)) )`
- Uses the **tier's actual fee** and **effective RTP** (incl. streak/lose-prize effects), not a flat assumed value.
- **Invariant:** effective return = `RTP + b·(1−RTP) < 100%` for any `b<1` → economy stays a net sink **by construction** (non-exploitable). Monitor on the existing RTP dashboard.
- `floor_reward` keeps eased/low-spend missions worth doing.

## E. "Play matches" instance (first vertical slice)
- `focus` = most-played tier over last ~30 matches (recency-weighted; tiebreak = most recent; cold-start = lowest tier). Relevance-first; a "discovery nudge" is a future knob (off by default).
- `baseline` = median matches / active-day.
- `goal` = controller §C. (e.g. habit 3.6/day → cold-start target ceil(3.6×1.3)=5 → "Play 5 Advanced" → completes → 6 → … misses twice at 8 → drops to ceil(7×0.75)=6.)
- `reward` = §D on that tier's fee/RTP.
- **Snapshot goal + reward at assignment** (frozen for the day; auditable).

## F. Prerequisites / changes
- Build **per-tier match aggregation** (today only an aggregate `matches_per_day` exists). Needed for `focus` + per-tier baselines.
- New **controller-state table** keyed (player, mission_type).
- **Extend the nightly metric cron** to precompute per-tier stats + baselines so assignment is cheap.
- **Keep** the existing engine (progress events, claim/reward, streak, chests, reroll, crons).
- **Retire/repair** the dead metrics (`rating_diff_won`, half-wired difficulty filter) — superseded.
- A **reroll is not a miss**; eased reward still respects `floor_reward`.

## G. Operator-tunable per type (defaults)
`base_stretch` 1.3 · `up_step` +1 · `ease_after` 2 misses · `ease_factor` 0.75 · floor `0.5×baseline` · cap `2×baseline` · reward `b` 10% · `floor_reward` 250 · `round_to` 50 · baseline window 30 active days / 60 matches.

## Rollout
Build spine + controller + "Play matches" end-to-end first (vertical slice, dark-launched), validate the numbers on real activity, then add each new type by implementing only its `focus` + loss-unit.
