# Daily Missions — Product Requirements Document

> Status: Locked, ready for implementation
> Owner: Yaniv (solo)
> Estimated timeline: 7–8 weeks, ending with a 3–5 day internal dark-launch before public release
> Source: Brainstorm conversation, 2026-05-23

---

## 1. Problem Statement

Gammon-Rivals has no structured 24-hour engagement loop. The Hourly Wheel and Daily Bonus create return triggers but no *progression* — players have no goal beyond "play more matches." The result is:

- Players exhaust the lobby's novelty within their first few sessions
- No mechanism to push players up tiers (engagement, monetization, skill)
- No tunable economy sink/source the operator can dial weekly without a code change
- No way to nudge inactive modes (PvP, harder difficulties) into the rotation

Daily Missions is a single-feature answer to all four levers: retention, monetization, economy balance, and activity diversification. It introduces:

1. A bounded daily goal-completion loop (4 missions per day)
2. A weekly meta-progression (Mission Points → Chest milestones)
3. Operator-tunable mission catalog + rewards (no code changes to balance)
4. Per-player calibration (each player gets goal values stretched against their own baseline)

---

## 2. Goals

### Business goals
1. **Improve D7 retention** measurably above pre-launch baseline (target to be set during dark-launch phase; hypothesis: +5–10 percentage points).
2. **Lift ARPDAU** via gem-sink missions (Spend X gems), tier-stretch missions (push regulars toward whale entry fees), and Battle-Pass chest claim flow (gem-priced rerolls).
3. **Increase avg matches/DAU** by ≥20% among players who complete at least one mission per day.
4. **Operator economy control** — let the BO operator (Yaniv) tune the entire mission economy via config tables and live without redeploying code, mirroring the existing PP-calculator pattern.

### Player goals
5. **Always-on progression** — every login presents a clear, time-bounded set of goals with visible reward.
6. **Calibrated challenge** — missions feel achievable but stretching, regardless of the player's current engagement level.

---

## 3. Non-Goals (v1)

Each non-goal exists to prevent scope creep — these are valuable but explicitly *not* part of v1.

| Non-goal | Why deferred |
|----------|--------------|
| Generic configurable segmentation framework (segments table, rule builder, cohort UI) | Premature abstraction. The per-metric percentile primitive covers v1's needs with three small tables. |
| Multi-currency wallet refactor (`user_wallets` → `(profile_id, currency_code, balance)` rows) | Only worth doing when 5+ currencies exist. Today's coins + gems + future-currency-as-column is sufficient. |
| Player-to-player mission gifting / sharing / social comparison | Social layer is its own feature; v1 is single-player progression. |
| ML-driven personalized mission selection | Premature without baseline completion data. v1 uses random sampling from eligible pool. |
| A/B testing framework for mission variants | Add post-launch once a baseline catalog exists and we know what to test. |
| Push notifications for expiring missions | Mobile push infrastructure doesn't exist yet. Can add later as a fast-follow. |
| Mission-related leaderboards / tournaments | Separate feature space; would compete for Mission-Points-track attention. |

---

## 4. User Stories

### Player stories

- **As a player**, I want to open the lobby and see 4 daily missions calibrated to my play habits, so that I have clear, achievable goals every session.
- **As a player**, I want to track my mission progress in real time as I play, so that I feel forward motion during each match.
- **As a player**, I want to claim mission rewards with one click (per mission or all-at-once), so that completion feels rewarding and not bureaucratic.
- **As a player**, I want to reroll a mission I don't like once per day for free, and pay gems for additional rerolls, so that I'm never stuck with content I won't engage with.
- **As a player**, I want my mission completions to feed a weekly Mission Points pass with 4 chest milestones, so that I have both short- (daily) and medium-horizon (weekly) goals.
- **As a player**, I want to see a daily streak counter that rewards completing all 4 missions for 7 consecutive days, so that there's a reason to return every day, not just on big-mission days.
- **As a player**, I want a separate Weekly Challenge with a big reward, so that I have a stretch goal that survives across days.
- **As a player**, I want missions I never claimed before reset to be visibly *lost*, so that I feel urgency to claim and the system stays clean.

### Operator stories (Yaniv as BO operator)

- **As the operator**, I want to author mission templates in the BO with rarity, resolution mode (fixed or stretch), eligibility, rewards, and MP value, so that I can author the full mission catalog without code changes.
- **As the operator**, I want to author the 4 chest milestones and their reward bundles separately, so that the Battle Pass economy is independently tunable.
- **As the operator**, I want to configure the reroll gem-cost ladder and daily cap, so that I can throttle reroll abuse without code changes.
- **As the operator**, I want a dry-run preview tool that shows me what missions a sample player (selected by profile) would be assigned today and why, so that I can debug assignment logic before players see it.
- **As the operator**, I want metric distributions and per-player tier assignments visible in the BO, so that I can spot-check that segmentation calibration is correct.

---

## 5. Requirements

### P0 — Must Have (shipped at launch)

#### Schema (10 new tables + 2 existing extensions)

**Reference data:**
- `currencies` — `code pk, display_name, icon_url, is_enabled`. Seeded with `coins, gems`.
- `mission_templates` — `id, mission_type, metric_code, rarity (common|rare|epic), resolution_mode (fixed|stretch), goal_value, stretch_factor, goal_min, goal_max, eligibility jsonb, mission_points, period (daily|weekly), enabled, created_at, updated_at`
- `mission_rewards` — `id, mission_id, reward_kind (currency|item), currency_code, item_table, item_id, amount`. Polymorphic.
- `chest_milestones` — `id, threshold_mp, milestone_index, enabled`. The 25/75/150/250 progression.
- `chest_rewards` — same shape as `mission_rewards`, FK to `chest_milestones`.
- `reroll_pricing_config` — singleton row: `gem_cost_ladder int[]` (e.g. `[0, 25, 75, 200]`), `daily_cap int`.

**Metric infrastructure:**
- `player_metrics` — `(profile_id, metric_code, value_today, baseline_7d, updated_at)`. ~10 rows per player.
- `metric_distributions` — `(metric_code, percentile, value, computed_at)`. Population-level percentile breakpoints, recomputed nightly.
- `player_metric_tiers` — `(profile_id, metric_code, tier (casual|regular|whale))`. Derived nightly.

**Per-player state:**
- `player_daily_missions` — `(id, profile_id, mission_template_id, rarity_slot, resolved_goal, progress, completed_at, claimed_at, expires_at, assigned_at, reroll_count_today)`.
- `player_weekly_pass` — `(profile_id, week_key, mp_earned, chests_claimed jsonb, created_at)`. One row per player per ISO week.
- `player_streak` — `(profile_id pk, current_streak_days, last_complete_date, total_streak_chests_claimed)`.
- `user_inventory` (new generic table) — `(profile_id, item_table, item_id, granted_at, source)`. The polymorphic *grant ledger*; existing item tables stay where they are.

**Existing extensions:**
- `user_wallets` — gains a column per new currency over time. v1 still just `coins, gems`.
- `wallet_transactions` — credits with `source = 'mission_reward' | 'chest_reward' | 'streak_chest_reward'`.

#### Cron jobs (4)

1. **Nightly metric + tier recompute** — 02:00 UTC daily. Rebuilds `player_metrics.baseline_7d`, `metric_distributions`, `player_metric_tiers` from the last 7 days of event data.
2. **Daily mission assignment** — 00:00 UTC daily. Expires yesterday's missions (unclaimed = LOST), assigns 1 always-Epic + 3 sampled from Common/Rare pool of eligible templates per player. Resolves each mission's `goal_value` per `resolution_mode`. Anti-repeat: exclude any template assigned in the last 3 days.
3. **Weekly pass reset** — 00:00 UTC Monday. Closes prior week's `player_weekly_pass` (unclaimed chests LOST), opens new week.
4. **Streak rollover check** — 00:00 UTC daily. If `last_complete_date < yesterday`, reset `current_streak_days` to 0.

#### Server RPCs (6)

1. `get_player_missions_today(profile_id)` → active missions + weekly pass state + streak + next-reroll-cost. Single round-trip per screen render.
2. `progress_mission(profile_id, metric_code, delta, event_id)` → SECURITY DEFINER. Increments active missions matching that metric. Idempotent on `(mission_id, event_id)`.
3. `claim_mission(profile_id, mission_id)` → checks complete-and-not-claimed, credits rewards via `mission_rewards`, increments weekly pass `mp_earned`, updates streak when all 4 missions claimed.
4. `reroll_mission(profile_id, mission_id)` → checks ladder cost and daily cap, debits gems, replaces mission with anti-repeat sample from same rarity pool.
5. `claim_chest(profile_id, milestone_index)` → checks `mp_earned >= threshold` and not in `chests_claimed`, credits `chest_rewards`.
6. `claim_streak_chest(profile_id)` → fires when `current_streak_days >= 7`; credits streak-chest bundle.

#### Event hook sites (5)

All call `progress_mission` for the relevant metric:

- `finish_match` RPC — emits matches_played, matches_won, win_streak, coins_won_net, coins_wagered, matches_at_difficulty (multiple calls per match).
- `level_up` trigger — emits levels_per_week.
- `spin_wheel` RPC — emits wheel_spins.
- Gem-debit wallet writes — emit gems_spent.
- Any XP-credit write — emits xp_earned.

#### BO authoring surfaces (5)

1. **Mission Template editor** — full CRUD. Fields: type, metric, rarity, resolution mode + params with safety-cap fields, eligibility (min_level, max_level, requires_unlocks), rewards (multi-row), MP value, period, enabled.
2. **Chest Milestones editor** — 4 milestone rows (threshold + rewards bundle).
3. **Reroll Pricing editor** — one form: price ladder + daily cap.
4. **Streak Chest editor** — single bundle.
5. **Dry-run preview** — pick a player profile → see what they'd be assigned today, with reasoning. Built BEFORE launch.

#### Frontend (P0)

- **Daily Missions Screen** — full-screen modal/route, matching the mockup design:
  - Header with refresh-in timer + info icon
  - Mission Points progress bar with 4 chest milestone markers
  - Daily missions list (4 cards: rarity badge, title, subtitle, progress bar, reward icons, action button [Go | Claim])
  - Claim All button when ≥1 mission is claimable
  - Reroll Missions button (showing remaining-free count + next gem cost)
  - Daily Streak strip (counter + +10% MP bonus indicator)
  - Weekly Challenge panel (right column, separate progress)
  - Daily Streak Chest panel (7-day countdown)
- **Mission Points + Chest Track** — progress strip with the 4 chest icons; chests get a CLAIM affordance when threshold passed
- **Reroll modal** — confirm flow with gem cost preview, anti-repeat indication
- **Chest claim modal** — celebration animation showing the unboxed reward bundle
- **Reward flight animations** — coins/gems flying to the wallet pill on claim, matching the existing wheel/daily-bonus patterns

#### Initial mission catalog (~25 templates)

| # | Template | Metric | Rarity variants | Notes |
|---|----------|--------|-----------------|-------|
| 1 | Play X matches | matches_per_day | C/R/E | stretch, all tiers |
| 2 | Win X in a row | win_streak | C/R/E | stretch, cap whale at X=4 |
| 3 | Level up X times | levels_per_week | C/R | fixed, hide for level > 25 |
| 4 | Play difficulty Y, X times | matches_at_difficulty_Y | C/R/E | per-difficulty templates, unlock-gated |
| 5 | Wager X coins | coins_wagered_per_day | C/R/E | stretch |
| 6 | Win X coins net | coins_won_net_per_day | C/R/E | stretch |
| 7 | Earn X XP today | xp_per_day | C/R/E | stretch, cross-cutting |
| 8 | Spin the wheel X times | wheel_spins_per_day | C | fixed, habit/retention |
| 9 | Spend X gems | gems_spent_per_day | C/R | fixed, monetization-tagged |
| 10 | Beat a higher-rated opponent | rating_diff_won | E | single template, rated-only |
| 11 | Complete N other daily missions | meta | C/R | meta-mission, anti-cherry-pick |

### P1 — Nice to Have (fast follow after dark-launch)

- Mission catalog audit view in BO (portfolio breakdown by primary lever)
- Per-tier reward forecast view in BO (expected coin/gem pump per day per tier)
- Mission "favorited" by player — pin one to top, never auto-replaced
- Surface "missions about to expire" indicator in lobby header
- Reward-claim multi-step animation when claiming via Claim All

### P2 — Future Considerations (architectural insurance, not v1 scope)

- Multi-currency wallet refactor when 5th currency lands
- ML-driven personalized mission selection (replace random sampling)
- Mission-based AB testing framework
- Push notifications for expiring missions
- Mission sharing / social comparison
- Seasonal "themed" mission packs (operator-curated daily takeovers)

---

## 6. Success Metrics

### Leading indicators (measure within 1-2 weeks of dark-launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Daily Missions screen open rate (% of DAU) | ≥70% | Frontend event log |
| Mission completion rate per slot | ≥60% Common, ≥40% Rare, ≥25% Epic | `player_daily_missions.completed_at` IS NOT NULL |
| Mission claim rate (of completions) | ≥90% | `claimed_at` IS NOT NULL / `completed_at` IS NOT NULL |
| MP earned per active player per day | Median: 100, p75: 150 | `player_weekly_pass.mp_earned / days_in_week` |
| Chest claim rate (of unlocked) | ≥85% | Chest claims / chest unlocks |
| Reroll usage rate | 30–60% use free; <15% use paid | `reroll_count_today` distribution |
| Streak length distribution | Median ≥3 days, p90 ≥7 days | `player_streak.current_streak_days` |

### Lagging indicators (measure 4-8 weeks post-launch)

| Metric | Target | Notes |
|--------|--------|-------|
| D7 retention delta vs. baseline | +5–10pp | Compare cohorts pre/post launch |
| ARPDAU delta vs. baseline | +10–20% | Tracked at sweepstakes-monetization layer |
| Avg matches/DAU | +20% among mission-active players | match_finished events / DAU |
| Coin economy balance | Sink/source ratio stays within ±10% of pre-launch | Existing economy reporting |
| Gem economy balance | Sink uplift from rerolls + Spend-X-gems missions | Existing reporting |

### Evaluation cadence

- Day 1-5 of dark-launch: operator self-play, no targets
- Day 6-14 post-public-launch: leading indicators reviewed daily, tune coefficients live
- Week 4: lagging-indicator first-look review
- Week 8: full success/failure verdict, decide on P1 priorities

---

## 7. Open Questions

| # | Question | Owner | Blocking? |
|---|----------|-------|-----------|
| Q1 | Initial gem-cost ladder values (e.g. `[0, 25, 75, 200]`) | Operator | Non-blocking — BO-editable; needs a v1 default for Phase 1 seed |
| Q2 | Final reward magnitudes per rarity tier (coins/gems/XP/MP per Common, Rare, Epic) | Operator | Non-blocking — BO-editable; needs v1 defaults |
| Q3 | Chest content bundles for the 4 milestones | Operator | Non-blocking — BO-editable |
| Q4 | Streak chest content bundle | Operator | Non-blocking — BO-editable |
| Q5 | Weekly Challenge initial template (the "Win 15 ranked matches" equivalent for v1) | Operator | Non-blocking — BO-editable |
| Q6 | Avatar frames feature — how broad? Just for missions, or a separate cosmetics shop too? | Operator | Blocking for Phase 1 schema — `user_inventory` design assumes generic items |
| Q7 | Daily reset timezone — UTC, or player-local-derived? | Engineering | Default: UTC for everything; revisit if support tickets pile up |
| Q8 | Should "complete N other missions" meta-mission count its own claim? | Engineering | Default: no, to prevent recursion |
| Q9 | Anti-cheat: how strict should `progress_mission` idempotency be? Replay attack protection? | Engineering | SECURITY DEFINER + idempotency key (event_id) covers the realistic surface |

---

## 8. Timeline & Build Sequence

**Total estimate: 7–8 weeks of solo development.**

| Phase | Scope | Estimate | Gating dependency |
|-------|-------|----------|-------------------|
| **1** | **Schema migrations** — all 10 tables + 2 extensions + RLS + seed v1 templates and currencies | 1 week | none |
| **2** | **Nightly metric recompute cron** + tier derivation Postgres function | 4 days | Phase 1 |
| **3** | **Daily assignment cron** — 4 slots, resolution math, anti-repeat | 4 days | Phases 1, 2 |
| **4** | **Mission lifecycle RPCs** — `progress_mission`, `claim_mission`, idempotency, 5 event-hook sites | 1 week | Phases 1, 3 |
| **5** | **Weekly pass + chests + streak + rerolls** — RPCs and state transitions | 1 week | Phases 1, 4 |
| **6** | **Frontend** — Daily Missions screen, mission cards, chest track, weekly + streak panels, reroll + chest modals | 1.5 weeks | Phases 4, 5 |
| **7** | **BO authoring surfaces** — 5 editors + dry-run preview | 1 week | Phase 1 (can run parallel to Phase 6) |
| **8** | **Internal dark-launch** — operator self-play on dev DB, coefficient tuning, then public release | 3–5 days | All prior phases |

### Critical path
Phases 1 → 2 → 3 → 4 → 5 → 6 → 8. Phase 7 can parallelize against Phase 6 once Phase 1 lands.

### Phase 8 dark-launch gates

Before publishing to players:
1. Operator (Yaniv) plays for 3 days with the full assigned mission slate
2. All 11 mission template concepts trigger correctly from real gameplay
3. At least one chest milestone claimed
4. At least one reroll executed (free + paid path)
5. Coefficients reviewed against actual play data — reward magnitudes, MP weights, stretch factors

### Risk: scope drift

Two mitigation rules baked into the plan:
1. The 11-template catalog is locked. New mission concepts go to P1.
2. The 5 BO surfaces are locked. No new authoring surfaces in v1.

---

## 9. Architecture Principles (carry-forward from existing project conventions)

These rules from the project's CLAUDE.md apply equally to Daily Missions:

- **All coefficients are DATA, not code.** Reward magnitudes, stretch factors, MP values, chest thresholds, gem costs — all live in tables, all editable from the BO.
- **All content is environment-scoped** where applicable (mission_templates, chest_milestones — but per-player state stays env-agnostic).
- **RLS is authoritative.** All player-state tables get RLS policies; no client-side trust on mission progress.
- **No premature abstractions.** No segments table, no rule engine, no DSL.
- **PP-calculator pattern.** Math + coefficients in tables, dispatched by pure Postgres functions where reasonable.

---

## 10. Open Threads After Spec Sign-off

- Spec doc: this file (`docs/specs/daily-missions.md`)
- Migration: `supabase/migrations/<next_num>_daily_missions_v1_schema.sql` (Phase 1 first artifact)
- Task list: tracked in TaskCreate, one entry per phase

---

*End of PRD. Next action: kick off Phase 1 with the schema migration.*
