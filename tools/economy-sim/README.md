# economy-sim

A zero-dependency Monte Carlo harness used to design and validate the Gammon
Rivals coin economy + level system — core-loop RTP, FTUE pace, the level-bonus
contribution (pp on top of RTP), and free-tap / missions sizing.

## Run

```bash
node tools/economy-sim/sim.mjs [nPlayers]   # default 5000 players, 180 days
node tools/economy-sim/serve.mjs            # serve out/report.html at http://localhost:8123
```

Outputs are written to `out/` (an HTML report + CSV/JSON) — gitignored, recreated each run.

## Files

- **config.mjs**
  - *§A — live config snapshot*: the curve (`level_configs`), difficulty tiers
    (`table_configs`), and taps (daily/wheel/grants/currency) pulled from the live
    Supabase project. Treat as data; re-pull and replace after any Back-Office change.
  - *§B — behavioural model (assumptions)*: archetypes, skill→win-rate, session
    cadence, core RTP, XP formula, missions-refill sweep. These are the knobs to tune.
- **sim.mjs** — seeded RNG + economy engine (mirrors `enter_room` entry-sink,
  `finish_match` payout/XP incl. risk-free + base×(1+boost%), auto-promote level
  rewards) + the Monte Carlo runner, metrics, and HTML/CSV report generator.
- **serve.mjs** — tiny static server for viewing the report locally.

## Key mechanics modelled (kept in sync with production as of 2026-06)

- XP per match = `base_xp_win × (1 + xp_multiplier_pct/100)`, granted on win, loss
  and abandon (Beginner 50 → Grand Master 300).
- Level curve: hardcoded L1–10 FTUE ramp, L11–500 the original curve rebased;
  per-level coins ≈ 3% of the level's XP gap (~0.15pp on top of RTP).
- Core RTP modelled at 80%; coins bleed → IAP (free taps are the meta layer).

> The engine reimplements the server-side SQL logic in JS; if you change
> `finish_match` / the curve, update the corresponding bits here (or re-pull §A).
