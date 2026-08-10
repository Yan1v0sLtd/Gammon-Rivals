# Daily Missions — System Reference

> Feature reference · As-built · Compiled from a static read of
> `supabase/migrations/` and `src/` as of 6 Aug 2026. Not a live database query.
> Owner: Yaniv · Source: `docs/prd/daily-missions-prd.html` (migrated to markdown)

How the daily/weekly mission system actually works today — the assignment logic,
the reward math, what a player sees, what an operator can tune, and where the
implementation has drifted from the design.

**How this document was built:** by reading every mission-related migration and
the frontend/back-office source directly — not by re-describing the original
spec. Where the shipped system matches the spec, that is noted in passing; where
it does not, that is called out explicitly. Every formula, constant, and defect
below carries a `file:line` citation back to the code that proves it.

Quick facts:

- 4 missions assigned / day
- 2C·1R·1E fixed rarity mix
- 3 nightly cron jobs
- 12 mission types
- 1 type live and personalized
- 4 confirmed defects

---

## 1. Overview

Every player gets four missions a day — two Common, one Rare, one Epic — plus
one Epic weekly mission on Mondays. Complete one by playing normally (win
matches, wager coins, spin the wheel), then claim it in the Missions modal for
Coins, Gems, or XP. Chain seven claimed days in a row and a streak chest
unlocks. Underneath, there are actually **two independent difficulty engines**
deciding what a mission asks of you — a simple population-percentile system that
ships fully wired but unused, and a newer per-player adaptive controller that is
live for exactly one mission type. Both are documented in section 3.

The feature has no edge functions — it is entirely Postgres: three `pg_cron`
jobs plus a set of `SECURITY DEFINER` RPCs, fronted by one lobby modal and one
back-office admin panel. Two design documents shaped it: the original brainstorm
spec (`docs/archive/daily-missions-spec-2026-05-23.md`, 23 May 2026) and a
redesign that "supersedes the generic metric+goal template model"
(`docs/archive/daily-missions-redesign.md`, signed off 14 Jun 2026) by grafting
a second, per-player personalization engine onto the first system rather than
replacing it. Both engines are still live in the schema today.

The archived spec (`docs/archive/daily-missions-spec-2026-05-23.md`) is
superseded by this reference. This document is the current authority on how the
system works.

> "Per-individual personalization, no clusters / no segmentation."
>
> — `docs/archive/daily-missions-redesign.md:5` — the design rationale for the
> engine that now runs alongside the population-tier engine it was meant to
> replace.

---

## 2. Player experience

There is no dedicated route — Missions is a full-screen modal opened from the
lobby's bottom nav, gated by player level like the other nav features.

### Entry point

The bottom-nav Missions icon carries a numeric badge counting every
completed-but-unclaimed mission, daily and weekly combined
(`LobbyScreen.tsx:229`). Tapping it opens `DailyMissionsModal` — a fixed
1536×812 canvas that scales to fit the viewport rather than reflowing
responsively (`DailyMissionsModal.tsx:32,107`). The feature itself is unlocked
by level via the shared `lobby_feature_configs` table (the same gate
Events/Tournaments/VIP Club use); below the unlock level, the nav icon is dimmed
with a padlock and a tap-to-reveal "reach level N" tooltip
(`LobbyBottomNav.tsx:72-176`).

### Layout

A two-column body: the daily mission list on the left, a Daily/Weekly tab
switcher on the right. The Daily tab shows the streak strip; the Weekly tab
shows up to two weekly-mission cards (in practice, one — only one weekly
template exists). Each mission card shows a rarity badge, one line of copy, a
progress bar with "progress / goal", its reward icons, and a single action
button that reads **Go**, **Claim**, or **Claimed**.

| Player action          | What happens                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Go**                 | Closes the modal. There is no deep link into a specific match, tier, or mode — even for a tier-pinned mission like "play 2 Beginner matches." (`DailyMissionsModal.tsx:239`) |
| **Claim**              | One RPC call; a coin/gem/XP flight animates to the wallet pill. (`DailyMissionsModal.tsx:127`)                                                                               |
| **Claim All**          | Loops claim sequentially over daily-only completed missions — not atomic, not parallel. (`DailyMissionsModal.tsx:157`)                                                       |
| **Reroll**             | Shown only on Common-rarity cards client-side; opens a confirm popup with the gem cost, then swaps the mission. (`DailyMissionsModal.tsx:165,672`)                           |
| **Claim streak chest** | No confirmation step — fires immediately once the streak reaches 7 days. (`DailyMissionsModal.tsx:183`)                                                                      |

Progress updates via a Supabase Realtime subscription on the player's own
mission/streak/pass rows — but the payload itself is discarded; any event just
triggers a full state refetch (`useDailyMissions.ts:132-171`). Claim/reroll
actions refetch immediately in their own success handler rather than waiting on
that round trip. The lobby's top-bar wallet and XP counters, however, are _not_
live while the modal is open — they only refresh when it closes
(`LobbyScreen.tsx:892-904`).

### Where the built UI diverges from the design doc

**Shipped without its meta-progression surface — The Mission Points → chest-milestone strip was never built**

The original spec calls for "a Mission Points progress bar with 4 chest
milestone markers" and a streak-chest panel
(`docs/archive/daily-missions-spec-2026-05-23.md:147-158`). The backend fully
supports it — MP accrual, four milestones, a `claim_chest` RPC — but
`DailyMissionsModal.tsx` never reads `weekly_pass` or `chest_milestones` from
its own fetched state, and no chest-track markup exists in the component at all.
A feature flag, `CHESTS_ENABLED = false`, exists in the codebase but is not even
imported into this modal — the strip was not gated off, it was simply never
built for this design pass (`DailyMissionsModal.tsx:858, lobbyData.ts:132`).

Player impact: mission-point accrual is invisible. There is no way to know a
chest is close, or that one is claimable.

Also missing against the original player story ("I want missions I never claimed
before reset to be visibly lost, so I feel urgency"): an unclaimed mission that
expires simply disappears from the list. There is no "lost" badge, no grey-out,
no history view — the fetch RPC only ever returns unexpired rows
(`missions_text_tokens.sql:92`).

---

## 3. System architecture

Three `pg_cron` jobs run every night. In real clock order: missions are assigned
at **00:00 UTC**, streaks roll over at **00:15 UTC**, and player metrics
recompute at **02:00 UTC** — which means the assignment job always resolves a
"stretch" goal against _the previous night's_ baseline, not same-day activity.

Diagram (text form): the nightly metrics job feeds `player_metrics` into
stretch-mode goal resolution but leaves `player_metric_tiers` unread; the
personalized engine bypasses `player_metrics` entirely and computes its own live
baseline; both paths converge into the four assigned missions.

The nightly pipeline: real chronological order is 00:00 assign → 00:15 streak
rollover (not shown) → 02:00 metrics. `player_metric_tiers` is computed every
night and consulted by nothing in the assignment or eligibility path — see
section 8.

### Two baselines, two engines

This is the fact that most explains the rest of the document. The **stretch**
resolution mode (section 4) derives its goal from the nightly cron's flat 7-day
average. The **personalized** resolution mode derives its goal from a live
30-day median computed at the moment of assignment, plus a per-player
adaptive-difficulty controller (`player_mission_difficulty`) that ratchets the
target up on completion and eases it down after repeated misses. They never
share data. A template is one or the other, chosen by an operator in the
Templates tab (section 7), and only six of twelve mission types are even
eligible for the personalized path.

### Assignment logic

`assign_daily_missions_for_profile`
(`missions_lock_down_internal_rpcs.sql:27-183`) runs once per player, per night:

1. For every mission type with `supports_personalized` and `rollout_pct > 0`,
   hash the player into or out of that type's rollout —
   `hashtextextended(profile_id || ':' || mission_type) % 100 < rollout_pct`.
   This is a _stable_ bucket, not a fresh coin-flip each run: a given player is
   either always in or always out for a given type. (`:60-79`)
2. Fill four slots — exactly **2 Common, 1 Rare, 1 Epic**, hard-coded, not the
   "3 sampled" the original spec describes (`:43`). Eligibility
   (`min_level`/`max_level`/`requires_rated`) and no-literal-duplicate are hard
   filters; "new mission type" and "not assigned in the last 3 days" are ranking
   preferences only, not filters (`:97-107`).
3. On Mondays (UTC), also fill one weekly Epic slot, expiring the following
   Monday.

A prior version of this ranking used hard `AND` filters instead of preferences,
which meant the Epic slot could silently come up empty whenever every eligible
template collided with a recent assignment — some players received only 3 of 4
missions until that was fixed. (`missions_fill_all_rarity_slots.sql` header)

---

## 4. Mission types

Twelve mission types are seeded. Six also have a personalized variant sitting
behind a per-type rollout percentage — today, only one is actually turned on.

| Type                       | Metric                     | Rarities                    | Trigger                  | Reward (fixed variant)            | Personalized   |
| -------------------------- | -------------------------- | --------------------------- | ------------------------ | --------------------------------- | -------------- |
| **play_matches**           | matches_per_day            | C·R·E, stretch ×1.2/1.5/2.0 | finish any match         | 250c / 500c+20xp / 1500c+10g+50xp | dark · 0%      |
| **win_streak**             | win_streak                 | C·R·E, fixed 2/3/5          | win (reset on loss)      | 300c / 500c / 20g                 | dark · 0%      |
| **level_up**               | levels_per_week            | C·R, fixed 1/2              | XP crosses a level       | 200c / 500c                       | —              |
| **play_difficulty**        | matches_per_day (Beginner) | Common only                 | finish match at Beginner | 250c                              | —              |
| **wager_coins**            | coins_wagered_per_day      | C·R·E, stretch ×1.1/1.5/2.0 | entry-fee debit          | 200c / 500c / 20g                 | live · 100%    |
| **win_coins_net**          | coins_won_net_per_day      | C·R·E, stretch              | net coin P&L, clamped ≥0 | 250c / 500c / 1500c               | —              |
| **earn_xp**                | xp_per_day                 | C·R·E, stretch              | any XP gain              | 200c / 500c / 1500c               | —              |
| **spin_wheel**             | wheel_spins_per_day        | Common, fixed 1             | hourly-wheel spin        | 150c                              | dark · MP-only |
| **spend_gems**             | gems_spent_per_day         | C·R, fixed 5/25             | gem debit                | 300c / 1000c                      | dark · MP-only |
| **beat_higher_rated**      | rating_diff_won            | Epic only                   | never fires              | 25g + 500c                        | —              |
| **meta_complete_missions** | missions_claimed_per_day   | Common, fixed 3             | claim any other mission  | 500c                              | dark · MP-only |
| **weekly_ranked_wins**     | ranked_wins_per_week       | Epic, weekly, fixed 15      | win a rated online match | 100g + 5000c                      | —              |

c = coins, g = gems, xp = experience. Reward figures are the seeded values in
`mission_type_config`/`mission_rewards` — all BO-editable, so treat these as the
as-shipped baseline rather than guaranteed current production values (section 9).

**Dead mission type, still assignable — beat_higher_rated can never be completed**

Its metric, `rating_diff_won`, is never emitted by any event hook in the
codebase — flagged in the operator's own seed comment ("NOT WIRED... needs
wiring or retirement") and confirmed by a repo-wide search
(`missions_type_config.sql:60,75`). No later migration disables the template; it
remains `enabled = true` and can still be handed to a player as their Epic slot
for the day.

Player impact: an Epic mission that is structurally unwinnable can be assigned
today.

### Copy tokens

Mission titles support dynamic tokens — `{goal}`, `{tier}`, `{goal|singular|plural}`
— meant to be resolved server-side by `mp_render_mission_text()`
(`mission_goal_thousands_commas.sql:6-20`). The RPC that actually serves mission
state today, `get_player_missions_today` (current version,
`daily_missions_v6_get_state_rpc.sql:8-135`), never calls it — an earlier
version did, but was overwritten by a later migration. See section 8 for which
live templates this affects.

---

## 5. Lifecycle and RPCs

Six `SECURITY DEFINER` functions carry a mission from assignment to reward. All
are locked down to the owning player or a config-manager as of a July security
fix (section 8).

### Progress

`progress_mission(profile, metric_code, delta, event_id, context)` is the single
entry point every trigger calls. It is idempotent via an event log
(`mission_progress_events`) and updates every unclaimed, unexpired mission on
that metric whose template `params` are a subset of the passed context — that is
the mechanism `play_difficulty` uses to only count Beginner-tier matches. Six
call sites feed it: a match-finish trigger (matches, win streak, ranked wins), a
wallet-transaction trigger (wager, net coins, gem spend), a direct call from the
wheel-spin RPC, an XP-update trigger, a level-update trigger, and `claim_mission`
itself (for the meta "claim 3 missions" type).

### Claiming

`claim_mission(mission_id)` validates ownership and completion, then **always**
walks the template's `mission_rewards` bundle to total up coins/gems/XP/items,
credits the wallet, awards mission points to the weekly pass, marks the row
claimed, and — if that clears the player's whole active slate — advances the
streak. There is no server-side "claim all"; the modal's button is a client-side
loop.

**Live, currently affecting real payouts — Personalized mission rewards are computed, stored, and then never paid**

Assignment computes a real snapshot reward and writes it to
`player_daily_missions.reward_coins`. But `claim_mission` was rewritten on 25
Jun and, unlike the version before it, never reads that column — it only ever
pays out from the `mission_rewards` bundle table, which is **empty** for every
personalized template (they are seeded with no reward rows at all). The result:
a personalized mission claims successfully, awards its flat mission-point value,
and pays **zero** coins, gems, or XP.

Diagram (text form): a personalized mission's reward is computed and stored in
`reward_coins` at assignment, survives the field-guard trigger, but
`claim_mission` never reads that column — it reads the empty rewards bundle
instead, so the player receives zero currency.

Traced from the current `claim_mission` definition
(`daily_missions_v4_lifecycle.sql:151-339`) against the current
`mp_assign_personalized` (`missions_personalized_sinks_mp.sql:22-177`). Live
today for `wager_coins`, the one personalized type at 100% rollout. A
structurally identical gap exists for cashback-mode fixed/stretch templates —
there, the field-guard trigger nulls `reward_coins` before the row even commits,
since no cashback template has resolution_mode = personalized.

### Reroll

`reroll_mission(mission_id)` — only offered client-side on Common cards, though
the RPC itself has no such restriction. Cost comes from a gem ladder
(`[0, 25, 75, 200]` by default — first reroll free), capped at
`min(daily_cap, ladder length)` per day. It picks a same-rarity replacement,
excluding the current template and anything assigned in the last 3 days, before
charging gems.

**Silent no-op — Reroll swaps the mission but keeps the old goal**

The function resolves the correct new goal into a local variable, returns it
correctly in its JSON response — but the row-update statement sets
`resolved_goal = resolved_goal`, a self-assignment left over from a variable
rename that fixed an "ambiguous column" error without updating the write.
(`daily_missions_v5_chests_streak_reroll.sql:453`, computation at `:438-447`)
After a reroll, the mission you see (new template, new art, new copy) is
tracking progress against whatever goal the _previous_ mission happened to have
— trivially easy or unreachable, depending on luck.

### Streak and chest

The streak advances only when a claim leaves the player with zero unclaimed
active daily missions, and only on consecutive UTC calendar days — logging in is
not enough, the full slate has to be cleared. A 00:15 UTC cron zeros anyone
whose streak is active but who did not clear yesterday. `claim_streak_chest()`
requires `current_streak_days >= 7`, pays a single flat bundle, and
**decrements** the streak by 7 rather than resetting it to zero — so a player
who lets it run past 7 without claiming can claim the same flat reward
repeatedly. There is no scaling reward curve; it is one threshold, one bundle.

The weekly pass's mission-point accrual and four chest milestones are
backend-complete (`claim_chest`, gated the same way as every other claim RPC)
but have no reachable player-facing surface today — see the callout in section 2.

---

## 6. Data model

Fifteen tables. Reference/catalog tables are world-readable and admin-writable;
per-player state tables are own-row-readable with _no_ direct write policies at
all — every mutation goes through a `SECURITY DEFINER` RPC by design.

| Table                         | Role                 | Key columns                                                                                       |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| **mission_templates**         | Catalog              | rarity, resolution_mode, goal_value/stretch_factor, reward_mode, params/eligibility jsonb         |
| **mission_rewards**           | Catalog              | polymorphic currency-or-item reward line, FK'd to a template                                      |
| **mission_type_config**       | Registry             | the 12 types' metric_code, supports_personalized, rollout_pct, 9 adaptive-controller coefficients |
| **player_metrics**            | Metric state         | (profile, metric_code) → value_today, baseline_7d                                                 |
| **metric_distributions**      | Metric state         | population percentile breakpoints, rebuilt nightly                                                |
| **player_metric_tiers**       | Metric state         | casual/regular/whale — written nightly, read by nothing (section 8)                               |
| **player_mission_difficulty** | Controller state     | (profile, mission_type) → target, consecutive_misses — RLS with zero policies, RPC-only           |
| **player_daily_missions**     | Active instance      | progress, resolved_goal, completed_at, claimed_at, expires_at, focus_tier, reward_coins           |
| **mission_progress_events**   | Idempotency log      | event_id pk — de-dupes repeated progress calls                                                    |
| **mission_rerolls**           | Audit / count source | rerolled_at — "rerolls today" is always counted live from here                                    |
| **player_weekly_pass**        | Meta-progression     | (profile, week_key) → mp_earned, chests_claimed jsonb                                             |
| **chest_milestones**          | Catalog              | threshold_mp, rarity — 4 global rows                                                              |
| **chest_rewards**             | Catalog              | polymorphic reward line, FK'd to a milestone                                                      |
| **player_streak**             | Player state         | current_streak_days, last_complete_date, total_streak_chests_claimed                              |
| **streak_chest_rewards**      | Catalog              | single global bundle — not FK'd to anything, just one flat reward                                 |
| **reroll_pricing_config**     | Singleton config     | gem_cost_ladder int[], daily_cap                                                                  |

Every per-player table cascades on `profiles(id)`. Item-kind rewards route into
`user_board_inventory` for board themes specifically, or a generic
`user_inventory` ledger otherwise — `item_table`/`item_id` are freeform text
with no referential check, so a typo grants a nonsense inventory row rather than
erroring (section 7).

---

## 7. Admin and back office

One admin section, six sub-tabs. Read-only for `support`/`viewer` roles; every
mutation additionally re-checks `can_manage_config` server-side regardless of
what the client UI allows.

### Templates

The template editor's **Mission type** dropdown is the operator-facing half of
the derived-metric mechanic: choosing a type auto-fills `metric_code` (shown
read-only underneath) from the type's registry row, and force-falls-back
**Resolution mode** out of Personalized if the new type does not support it.
Fixed shows a goal input; Stretch shows a factor plus min/max clamps;
Personalized shows an info box and hides the reward bundle entirely, since that
reward is generated per-player at assignment time. A **Reward** dropdown offers
Manual bundle or Cashback (% of house edge) — the latter shows a live client-side
preview computed from a hand-maintained constant the code's own comment admits
"can silently drift" from the real tier config it is meant to mirror.

### Mission Types

The registry — label, description, the personalization toggle, rollout
percentage, and eleven adaptive-controller coefficients (base stretch, ramp
step, ease-after-N-misses, ease factor, floor/cap multipliers, reward %, floor
reward, rounding, baseline window). `mission_type` and `metric_code` are
intentionally not editable here — binding a new type to an event hook is a code
change, not a BO change.

### Chests · Reroll · Streak Chest

Straightforward bundle/threshold editors for the four chest milestones, the
reroll gem ladder and daily cap, and the single streak-chest bundle. The reroll
help text notes "ladder[0] should be 0 so the first reroll is free" — a
convention communicated in prose only; nothing enforces it.

### Simulator

Not what the original spec asked for. The spec wanted "a dry-run preview that
shows what missions a sample player would be assigned today and why" — the code
has a comment marking that as a stub ("full impl is a fast-follow") immediately
followed by a different, broader tool: spin up synthetic test profiles
(individually or as Casual/Regular/Whale cohorts with hard-coded baselines),
hand-edit a test player's metric baseline, and re-run assignment against them. A
genuine preview RPC for the flagship personalized type, `mp_play_matches_preview`,
exists server-side but is called from no UI and had its client execute grant
revoked in the July lockdown.

### Guardrails

Authoritative validation lives in Postgres check constraints (reward-% must stay
below 1 so the economy stays a net sink, rollout% in [0,100], etc.) — those hold
regardless of what the UI does. The BO-editor layer is thinner: only **Rollout %**
has client-side min/max clamping. Every other numeric field — goal bounds,
mission points, all eleven coefficients, chest thresholds, reroll rungs — is a
bare number input with no client validation; an out-of-range value is only
caught by the database constraint on save, surfaced to the operator as a raw
Postgres error string.

---

## 8. Known issues

Confirmed by reading the current, live definition of each function — not
inferred from comments alone. Ranked by player impact.

**Critical · live · affects real payouts today — Personalized-mission rewards are unpayable**

Diagrammed in section 5. `claim_mission` never reads
`player_daily_missions.reward_coins`; personalized templates ship with no reward
bundle. Currently live for `wager_coins`, the one personalized type at 100%
rollout — every player who completes their personalized wager mission gets
mission points and nothing else.

**High · silent data corruption — Reroll does not update the goal**

`resolved_goal = resolved_goal` self-assignment (section 5) means a rerolled
mission tracks progress against a stale goal from the mission it replaced.

**Medium · visible to players — Mission copy tokens render literally**

`{goal}`, `{tier}`, and `{goal|singular|plural}` tokens are written into live
template subtitles but the RPC serving mission state today never resolves them
(section 4). Affects the `play_difficulty` template and most of the
`spend_gems`/`spin_wheel`/`wager_coins`/`win_coins_net`/`win_streak`/
`meta_complete_missions` stretch templates.

**Medium · assignable but unwinnable — beat_higher_rated can never complete**

Detailed in section 4 — its metric is never emitted, and the template is still
`enabled`.

Two more items are dormant rather than actively harmful, but worth knowing:

- **player_metric_tiers is dead code.** Computed nightly, consulted nowhere
  (section 3) — the population-segmentation engine the redesign doc explicitly
  moved away from is still running for free every night.
- **focus_tier gating was dropped.** An early version of the progress trigger
  restricted a tier-pinned personalized mission to matches at that specific
  tier; the June rewrite of that trigger does not carry the check forward.
  Dormant today because `play_matches` personalized is at 0% rollout — would
  activate the moment that is raised.

A previously-live issue, already fixed and included here for context: through 24
Jul 2026, `progress_mission` and its reset counterpart were callable directly by
any authenticated client with an arbitrary `profile_id` — a coin/gem mint, in
the fixing migration's own words, "proved in a rolled-back tx." Closed by
revoking client execute on the internal helper RPCs.
(`missions_lock_down_internal_rpcs.sql:1-22`)

---

## 9. Open questions

This document is a static read of the migration history and current frontend
source — not a live database query. That distinction matters most here.

**Not confirmed** — Live values for every BO-editable table — `mission_type_config`
coefficients and rollout percentages beyond what a migration explicitly set, the
reroll ladder, chest bundles, which templates are actually `enabled` today.
These are edited directly from the admin panel, not via new migrations, so this
document can only state the seeded starting point. Two migrations explicitly
describe values that had already drifted from their own defaults via live BO
edits before the migration was even written — this is a real, observed pattern
here, not a hypothetical caveat.

**Not confirmed** — Whether two or more personalized mission types rolled out
simultaneously could push a player's daily total above four missions. The
personalized pre-assignment loop has no slot-cap check of its own — traced in
the SQL, not observed against real data.

**Not confirmed** — Whether `claim_chest` is reachable through any UI. No caller
exists in the searched frontend source, but that was not an exhaustive read of
every component in the repository.

**Not confirmed** — Whether an operator has patched any of the section 8 defects
directly against the database outside of a migration file. Nothing in the
repository could show that either way.
