# Gammon Rivals — Product Reference

> Product requirements · Working draft · Compiled as-of: see git history
> Owner: Yaniv · Source: `docs/prd/product-prd.html` (migrated to markdown)

A mobile backgammon game built around quick, trusted matches, virtual-stake
progression, daily goals, and collectible board themes.

**Document intent:** define the customer promise, current player experience,
core game loop, and next product priorities.

Status labels used throughout:

- **Available** — a player surface exists today.
- **Partial** — the path is gated, incomplete, or not launch-verified.
- **Placeholder** — navigation exists without a player feature.
- **Gap** — the customer need is not served today.

Quick facts:

- 3 play paths: online, bot, hot-seat
- 5 difficulty and virtual-stake tiers
- 4 daily mission slots
- 2 player currencies: coins and gems
- 1 shared deterministic rules engine
- 5 major launch or growth gaps

---

## 1. Product overview

Gammon Rivals gives casual and competitive players a fast way to play complete
backgammon matches, earn visible progress, and return for short daily goals.

### Product promise

> Start a fair match quickly. Make meaningful choices. Finish with visible
> progress.
>
> — Proposed product promise for this PRD.

### Positioning

- **Mobile first.** The player app is a Capacitor-native product and is not
  served as a public web game. (`AGENTS.md · File structure`)
- **Backgammon first.** Standard rules, match scoring, and the doubling cube
  are the core skill experience. (`packages/engine/src/match.ts`)
- **Fast entry.** A player can use a guest account, choose a tier, and enter
  online matchmaking with bot fallback. (`apps/game/src/features/auth/`,
  `features/lobby/`)
- **Virtual value only.** Coins and gems have no real-money cash-out path.
  Product copy uses stake and match value, not betting language.
  (`AGENTS.md · Non-negotiable 4`)

### Product goals

1. Make the first match easy to start and understand.
2. Keep online play fair and reliable.
3. Give every completed match a clear result and progression value.
4. Create daily and weekly reasons to return.
5. Support sustainable spending without real-money reward claims.

### Current release non-goals

- Real-money play, cash prizes, or cash-out.
- Changing standard backgammon rules for each mode.
- A broad social network before the core match and retention loops are stable.
- Serving the native player app as a public browser game.

---

## 2. Players and needs

The product serves three main player motivations. One player can move between
them over time.

| Player type            | Main need                                            | Product response                                                                        | Current risk                                                                 |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Quick-match player** | Start a short game with little setup.                | Guest access, clear tier choice, fast matchmaking, bot fallback, auto-roll.             | No rematch flow. A failed queue can still create poor recovery cases.        |
| **Competitive player** | Play trusted matches and improve skill.              | Ratings, higher tiers, turn timers, doubling cube, match history, replay.               | No leaderboard, tournament, or direct rival relationship.                    |
| **Progression player** | See goals, rewards, levels, and collection progress. | XP, levels, daily missions, weekly challenge, streak, wheel, daily bonus, board themes. | Mission chest meta-progress is not surfaced and cosmetics are mostly boards. |

### Shared customer jobs

- Teach me enough to make my first legal moves.
- Find me a suitable opponent without a long wait.
- Show that dice, moves, and payouts are trustworthy.
- Make wins meaningful without making losses end the session.
- Give me a reason to return tomorrow.
- Let me save, review, and personalize my progress.

---

## 3. Core product loop

The main loop starts and ends in the lobby. Match rewards feed progression,
progression unlocks higher-value play, and retention systems create the next
reason to return.

Diagram (text form): Lobby → Choose tier → Find opponent → Play match → Result.
Result feeds Progress (levels, missions, unlocks) and Return trigger (bonus,
wheel, streak), which loop back to Lobby.

Online and bot matches use the same lobby-to-match handoff. A player's selected
board is cosmetic and does not affect matchmaking.
(`apps/game/src/game/matchEntryPath.ts:1-72`)

### Session loops

- **Minute loop:** roll, inspect legal choices, move, and decide whether cube
  pressure matters.
- **Match loop:** enter with a virtual stake, compete, receive a result, and
  decide whether to play again.
- **Daily loop:** claim a bonus, review missions, spin the wheel, and complete a
  focused set of matches.
- **Long loop:** gain XP and rating, unlock higher tiers, and collect board
  themes.

---

## 4. Player feature map

Features are grouped by the player need they serve, not by the code or team that
owns them.

| Player need               | Current features                                                                         | Status      | Product note                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| **Learn and start**       | Guest access, Google sign-in, guest upgrade, onboarding tour, How to Play.               | Available   | The first-match path should remain shorter than account setup.                            |
| **Choose a game**         | Five difficulty/stake tiers, level gates, board selection, online matchmaking.           | Available   | Tier labels must explain challenge, cost, and expected reward.                            |
| **Play now**              | Human PvP, bot fallback, local hot-seat, turn timer, auto-roll.                          | Available   | Bot fallback protects time-to-match but must not feel like a hidden downgrade.            |
| **Play a complete match** | Standard legal moves, match score, doubling cube, accept/drop flow, disconnect handling. | Available   | The cube is a core skill feature and requires a clear confirm step.                       |
| **Trust the outcome**     | Server-authoritative online dice and turn validation, deterministic rules engine.        | Available   | Fairness should be explained in player language, not technical language.                  |
| **Gain progress**         | Coin payout, consolation reward, XP, levels, rating, status tiers, unlocks.              | Available   | Every result must show what changed and why.                                              |
| **Return regularly**      | Daily bonus, hourly wheel, four daily missions, weekly challenge, streak, rerolls.       | Available   | Mission chest backend state exists, but the track was not built in the player experience. |
| **Review performance**    | Profile, statistics, match history, replay.                                              | Available   | Replay supports learning but is not connected to coaching or sharing.                     |
| **Personalize**           | Board theme collection, selection, and gem purchase.                                     | Partial     | The practical cosmetic collection is boards only.                                         |
| **Buy resources**         | Coin packs, gem packs, bundles, boosts, limited sales, Play Billing validation path.     | Partial     | Native billing still needs a release build and on-device test purchase.                   |
| **Play socially**         | Anonymous human matchmaking and local hot-seat only.                                     | Gap         | No friends, direct challenge, rematch, chat, sharing, or social comparison.               |
| **Join competition**      | Events, Tournaments, and VIP navigation slots.                                           | Placeholder | Navigation and level-gating exist, but the player features do not.                        |
| **Control the account**   | Save progress, account actions, delete account, privacy and terms.                       | Available   | Account control is part of trust and store compliance.                                    |

Main evidence: player routes (`apps/game/src/App.tsx:32-86`), lobby composition
(`apps/game/src/lobby/LobbyScreen.tsx`), mission state
(`apps/game/src/features/lobby/lobbyData.ts:24-78`), and shop mapping
(`apps/game/src/modals/Shop/shopCatalog.ts`).

---

## 5. Game design

This is the light GDD layer. It describes the intended feel and pacing. The
tested TypeScript engine remains the rules source of truth.

### Experience principles

1. **Fast to action.** The lobby should lead to a match with few decisions and
   no forced account setup.
2. **Readable choices.** The board must show legal move options from the engine
   rather than validate guesses after a tap.
3. **Trusted competition.** Online dice and committed turns are
   server-authoritative.
4. **Meaningful pressure.** Virtual stakes, score, timer, and doubling cube
   create tension without real-money framing.
5. **Visible progress.** The result must connect to coins, XP, rating, missions,
   and unlocks.

### Match structure

| Stage           | Player experience                                          | Design requirement                                                            |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Entry**       | Select tier, virtual stake, and board theme.               | Show cost, challenge, timer, and reward framing before confirmation.          |
| **Matchmaking** | Search for a human, then use bot fallback when needed.     | Minimize waiting and state clearly when the opponent is a bot.                |
| **Turn**        | Roll, select from legal moves, move checkers, end turn.    | Board interaction must reflect precomputed legal sequences from the engine.   |
| **Pressure**    | Use the doubling cube, accept, or drop.                    | Offering a double requires a confirm step. The consequence must be explicit.  |
| **Recovery**    | Handle slow turns, disconnects, and opponent loss.         | A network issue must not leave the player in an unclear or endless match.     |
| **Result**      | See winner, score, payout, XP, rating, and mission impact. | Show each value change once, in a clear order, before returning to the lobby. |

### Rules authority

- The engine generates legal moves before the UI offers a move.
  (`packages/engine/src/legal-moves.ts`)
- Board updates are immutable and deterministic. (`packages/engine/src/board.ts`)
- Match play supports score, cube ownership, Crawford, and game results.
  (`packages/engine/src/match.ts`)
- The renderer displays board state but does not own game rules or match state.
  (`AGENTS.md · PixiJS integration rules`)

---

## 6. Progression and economy

The economy supports match access, rewards, long-term progress, and collection.
It must remain understandable and preserve the virtual-only product framing.

| Value              | Player meaning                    | Main sources                                       | Main uses                                              |
| ------------------ | --------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| **Coins**          | Core play resource.               | Match results, daily bonus, wheel, missions, shop. | Virtual match stakes and selected purchases.           |
| **Gems**           | Premium utility resource.         | Rewards and shop purchases.                        | Board themes, mission rerolls, selected shop items.    |
| **XP**             | Long-term participation progress. | Matches, missions, boosts.                         | Levels, status, tier and feature unlocks.              |
| **Rating**         | Competitive skill signal.         | Rated match outcomes.                              | Identity, comparison, and future competition features. |
| **Mission points** | Weekly mission progress.          | Claimed missions.                                  | Chest milestones; currently not surfaced to players.   |

### Economy requirements

- Server logic must calculate online entry fees, payouts, and purchase grants.
- The player must see the virtual stake before match entry.
- The result must explain net coin change, XP, and rating change.
- Loss recovery must not remove all ability to continue playing.
- Rewards and prices should remain operator-tunable without a client release.
- Product copy must not imply that virtual value can become money.

### Retention layers

- **Immediate:** match payout and result animation.
- **Hourly:** reward wheel.
- **Daily:** bonus, four missions, rerolls, and streak progress.
- **Weekly:** weekly challenge and mission-point track.
- **Long-term:** XP levels, rating, unlocks, and board collection.

Daily Missions has its own as-built reference with detailed lifecycle and known
defects. See `docs/reference/02-daily-missions-reference.md`.

---

## 7. Product requirements

These requirements describe product outcomes. Detailed technical behavior
remains in feature specifications and source-level references.

### P0 — launch confidence

1. A new player can enter the lobby, understand the primary action, and start a
   match without creating a permanent account.
2. Online dice, legal turns, match results, entry fees, and payouts remain
   server-authoritative.
3. Human matchmaking recovers through bot fallback or a clear error state.
4. Every completed match shows outcome, coin change, XP, rating, and relevant
   mission progress.
5. Daily bonus, wheel, missions, profile, history, replay, and account deletion
   remain reachable from clear player surfaces.
6. Google Play purchases pass one release-build, license-tester purchase from
   store dialog to granted wallet value.
7. Critical mission defects that can block completion or remove promised
   rewards are fixed before mission-led growth campaigns.

### P1 — retention and social foundation

1. Add a rematch path after a completed human match.
2. Add a minimal friend or direct-challenge flow before building chat.
3. Add player notifications for high-value return moments, with clear opt-in
   controls.
4. Decide whether to build and expose the weekly mission chest track.
5. Add a leaderboard only when rating integrity and season rules are defined.

### P2 — live competition

1. Define Events as time-bound goals or modes with a clear reward contract.
2. Define Tournaments as a complete entry, bracket, recovery, and payout flow.
3. Define VIP as player value, not only a locked navigation item.
4. Expand cosmetics only after board-theme collection and shop conversion are
   measured.

> **Priority note:** P0 is the proposed launch gate. P1 and P2 are proposals for
> product sign-off. They are not commitments inferred from existing navigation
> placeholders.

---

## 8. Success measures

The first version should establish baselines before fixed targets are locked.
Measures follow the customer journey from first open to return.

| Product question        | Measure                                                                  | Decision use                 | Target                  |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------- | ----------------------- |
| Can players start?      | First-open → first-match-start conversion                                | Onboarding and lobby clarity | Baseline first          |
| Can players find play?  | Median time to match; human vs bot-fallback share                        | Matchmaking health           | Baseline first          |
| Do matches finish?      | Match completion, timeout, disconnect, and abandonment rates             | Reliability and pacing       | Baseline first          |
| Do players continue?    | Matches per active player; same-session second-match rate                | Core loop quality            | Baseline first          |
| Do players return?      | D1, D7, and D30 retention                                                | Retention system value       | Set after soft launch   |
| Do missions help?       | Mission open, completion, claim, and reroll rates                        | Daily-loop tuning            | Use mission PRD targets |
| Is progression healthy? | XP pace, tier unlock pace, coin sink/source ratio                        | Economy tuning               | Define by cohort        |
| Does commerce work?     | Store open, purchase attempt, success, refund, and repeat-purchase rates | Billing and catalog quality  | After device validation |

### Required metric cuts

- Guest versus saved account.
- New, returning, and highly active players.
- Difficulty tier and entry fee.
- Human opponent versus bot fallback.
- Device version and app release.

---

## 9. Gaps and priorities

The main risks are not missing backgammon rules. They are launch verification,
weak social retention, and player surfaces that promise more than they currently
deliver.

### Launch blocker · commerce — Native purchase flow is not device-verified

The Play Billing catalog, client bridge, server validator, and grant path exist.
The release AAB and license-tester purchase remain outstanding.

Required result: one end-to-end purchase, duplicate-token check, cancellation
check, and wallet confirmation on a real device.

### High · retention — No social continuation after a good match

Human matchmaking does not lead to rematch, friend, direct challenge, sharing,
or social comparison.

Recommended first step: rematch plus a minimal rival relationship. Do not start
with full chat.

### High · product promise — Events, Tournaments, and VIP are navigation placeholders

Level gates and lobby slots exist, but the features behind them do not. Locked
navigation can create false expectations.

Hide them until each has a signed-off player promise, or label them clearly as
future content.

### Medium · return loop — No push notification system

Daily and hourly return triggers depend on the player opening the app without an
external reminder.

Add notifications only after event value, frequency caps, opt-in, and quiet
hours are defined.

### Medium · reliability — Matchmaking queue expiry is deferred

Stale queue entries can create a ghost-opponent edge case. The current design
note records this work as intentionally deferred.
(`docs/tasks/01-matchmaking-queue-expiry.md`)

Resolve before matchmaking scale makes stale state frequent or hard to support.

### Recommended sequence

1. Verify billing and close player-impacting mission defects.
2. Measure first match, matchmaking, completion, replay, and return behavior.
3. Add rematch and a minimal rival connection.
4. Decide the role of notifications and the weekly chest track.
5. Define one competition feature before exposing Events, Tournaments, or VIP.

---

## 10. Open decisions

These choices need product ownership. The repository cannot answer them.

### Positioning

Is the main launch promise "fast backgammon for everyone" or "competitive
backgammon with progression"? This choice changes onboarding, store emphasis,
and the first lobby action.

### Matchmaking

How clearly should bot fallback be disclosed, and should players be allowed to
wait longer for a human?

### Social

Is the first social feature rematch, friends, direct challenge, or leaderboard?
Building all four together would create avoidable scope.

### Competition

Which one feature earns the first live-competition slot: seasonal leaderboard,
scheduled event, or tournament?

### Progression

Should the weekly mission chest track be built, or should missions stay focused
on direct rewards and streaks?

### Monetization

What is the primary paid value: more match access, faster progression, or
collection? The current shop supports all three but does not establish one clear
product promise.

### Success threshold

What soft-launch baselines and release gates will define product readiness for
retention, match reliability, economy health, and purchase success?
