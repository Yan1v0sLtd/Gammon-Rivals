# Documentation migration plan

> Status: ready to execute · Owner: Yaniv · Scope: `docs/` only, no application code

This plan converts `docs/` into three clear groups:

1. HTML references — durable product and system knowledge.
2. Markdown runbooks — repeatable operator and developer procedures.
3. Archive — historical plans and reports.

Every step below is a documentation change. No source file changes.

---

## 1. Decisions

- **D1.** All HTML references live in one folder: `docs/reference/`. One folder keeps one relative
  stylesheet path.
- **D2.** All shared CSS moves to `docs/reference/reference.css`. Each HTML file links it and keeps
  only its own inline SVG styles.
- **D3.** File names use the `-reference.html` suffix. The two existing PRDs are renamed for
  consistency.
- **D4.** Unimplemented task documents are folded into the matching reference as "known gaps" with
  their acceptance criteria, then deleted. Git history keeps the originals.
- **D5.** Superseded specifications move to `docs/archive/` with a dated file name. They are not
  deleted, because references cite them as evidence.
- **D6.** Every reference carries a compiled-as-of date. `AGENTS.md` stays the rule authority.

---

## 2. Target layout

```text
docs/
├── README.md                                  → index: which document owns which topic
├── reference/
│   ├── reference.css                          → single shared stylesheet
│   ├── product-reference.html                 → moved from prd/product-prd.html
│   ├── daily-missions-reference.html           → moved from prd/daily-missions-prd.html
│   ├── architecture-reference.html            → new
│   ├── online-play-reference.html             → new
│   ├── economy-reference.html                 → new
│   └── admin-reference.html                   → new
├── runbooks/
│   ├── local-development.md
│   ├── android-build.md
│   ├── play-billing-release.md
│   └── supabase-migration-squash.md
└── archive/                                    → unchanged, plus newly archived files
```

Removed folders after migration: `docs/prd/`, `docs/specs/`, `docs/billing/`.

---

## 3. Ownership boundaries

Each topic has exactly one owner. Other documents link, they do not restate.

| Topic                                                                           | Owner                           |
| ------------------------------------------------------------------------------- | ------------------------------- |
| Player promise, feature status, product priorities, GDD                         | `product-reference.html`        |
| Missions, streak, rerolls, chests, mission admin                                | `daily-missions-reference.html` |
| Apps, packages, boundaries, backend surface, state rules, hosting               | `architecture-reference.html`   |
| Match entry, matchmaking, modes, dice/move authority, reconnect, integrity gaps | `online-play-reference.html`    |
| Tiers, stakes, payouts, currencies, XP, rating, shop, billing grants            | `economy-reference.html`        |
| Admin sections, operator workflows, roles, config ownership, reporting          | `admin-reference.html`          |
| Commands and procedures                                                         | `docs/runbooks/*.md`            |
| Rules and non-negotiables                                                       | `AGENTS.md`                     |

Overlap rules:

- `architecture-reference` describes structure. It does not describe player flows.
- `online-play-reference` describes one match lifecycle. It does not describe rewards tuning.
- `economy-reference` describes value flow. It does not restate mission internals.
- `admin-reference` describes operator control. It does not restate economy formulas.

---

## 4. Shared stylesheet extraction

Create `docs/reference/reference.css` from the current `<style>` block of
`docs/prd/daily-missions-prd.html`.

Contents:

- Theme tokens and light/dark overrides
- Base typography
- `.shell`, `.toc-wrap`, `.toc`, `.toc-meta`
- `.content`, `.doc-head`, `.doc-eyebrow`, `.doc-sub`, `.doc-methodology`
- `.stat-strip`, `.stat`
- `section.sec`, `.sec-head`, `.sec-lede`
- `.cite`, `.table-wrap`, table rules
- `.chip`, `.chip-live`, `.chip-dark`, `.chip-dead`
- `.card`, `.card-quote`, `.defect-card`, `.unconfirmed-card`
- `figure.diagram`, `hr.div`, `.back-top`
- Responsive and reduced-motion rules

Each HTML file then starts with:

```html
<title>…</title> <link rel="stylesheet" href="reference.css" />
```

Rule: only diagram-local `<style>` inside `<svg>` stays inline. No page-level CSS duplication.

---

## 5. Runbook template

Every file in `docs/runbooks/` uses these headings, in this order:

```markdown
# <Title>

> Status: <live | pending | one-off> · Last verified: <YYYY-MM-DD> · Owner: <role>

## Purpose

## Prerequisites

## Steps

## Verification

## Troubleshooting

## Related documents
```

Rules:

- One task per runbook.
- Commands in fenced blocks.
- No design rationale; link the owning reference instead.
- Mark outstanding steps explicitly in `Status`.

---

## 6. Execution steps

### Step 1 — Create the reference folder and stylesheet

1. Create `docs/reference/`.
2. Create `docs/reference/reference.css` with the shared rules from section 4.

### Step 2 — Move and clean the two existing references

1. `git mv docs/prd/product-prd.html docs/reference/product-reference.html`.
2. `git mv docs/prd/daily-missions-prd.html docs/reference/daily-missions-reference.html`.
3. Delete the inline `<style>` block in both files. Add the stylesheet link.
4. Remove the empty `docs/prd/` folder.

### Step 3 — Fix stale citations in the missions reference

In `docs/reference/daily-missions-reference.html`:

1. Replace `docs/daily-missions-redesign.md` with `docs/archive/daily-missions-redesign.md`
   (two places).
2. Replace `docs/specs/daily-missions.md` with `docs/archive/daily-missions-spec-2026-05-23.md`
   (two places).
3. Add a one-line note: the archived spec is superseded by this reference.

### Step 4 — Archive the superseded specification

1. `git mv docs/specs/daily-missions.md docs/archive/daily-missions-spec-2026-05-23.md`.
2. Remove the empty `docs/specs/` folder.
3. Confirm no other file cites the old path.

### Step 5 — Write `architecture-reference.html`

Sections:

1. Scope and audience
2. Repository layout: `apps/game`, `apps/admin`, `apps/website`, `packages/*`
3. Boundary rules and the boundary checker
4. Engine and AI purity, plus the Deno mirrors for edge functions
5. Client state rules: Redux Toolkit, RTK Query, listener middleware, feature slices
6. Backend surface: edge functions, RPC groups, RLS and admin gates
7. Delivery: `dist/play` for Capacitor, `dist/admin` under `/admin`, `dist/web` at the root
8. Testing policy: packages tested, apps not tested
9. Known structural debt
10. Open decisions

Authoritative sources to read before writing: `AGENTS.md`, `apps/*/vite.config.ts`,
`scripts/check-app-boundaries.mjs`, `supabase/functions/`, `apps/game/src/store/`,
`apps/admin/src/store/`, `nginx.conf`, `capacitor.config.ts`. Use
`docs/archive/state_08_08_2026.md` only as a lead, never as a fact.

### Step 6 — Write `online-play-reference.html`

Sections:

1. Scope and audience
2. Match entry contract and query parameters
3. Difficulty and stake selection
4. Matchmaking: human search, bot fallback, cancellation
5. Play modes: online PvP, server bot, local hot-seat
6. Turn lifecycle: roll, legal moves, commit, validation
7. Doubling cube, accept, drop
8. Timers, disconnects, forfeits, abandonment
9. Result and payout handoff
10. Integrity gaps and acceptance criteria
11. Open decisions

Fold in fully, then delete the sources:

- `docs/remove-client-side-rolling.md` → gap entry "client-side rolling still reachable", with its
  problem statement, options, acceptance criteria, and code list.
- `docs/matchmaking-queue-expiry.md` → gap entry "stale queue entries", with its TTL proposal,
  acceptance criteria, and code list.

Authoritative sources: `apps/game/src/game/matchEntryPath.ts`,
`apps/game/src/features/lobby/matchmaking*`, `apps/game/src/features/onlineMatch/*`,
`apps/game/src/pages/PlayOnline.tsx`, `apps/game/src/pages/HotSeat.tsx`,
`supabase/functions/roll_dice`, `finish_turn`, `ai_move`, `packages/engine/src/*`.

### Step 7 — Write `economy-reference.html`

Sections:

1. Scope and audience
2. Currencies and wallets
3. Difficulty tiers, entry fees, payout and rake flow
4. XP, levels, status, rating
5. Return rewards: daily bonus, hourly wheel
6. Shop catalog, sales, board purchases
7. Google Play Billing: validation and grant path
8. Economy monitoring and RTP reporting, with a pointer to the admin reference
9. Known gaps, including unverified device purchase
10. Open decisions

Rule: link `daily-missions-reference.html` for mission rewards. Do not restate them.

Authoritative sources: `packages/sim/src/economy.ts`, `packages/sim/src/tiers.ts`,
`apps/game/src/modals/Difficulty/DifficultyModal.tsx`, `apps/game/src/modals/Shop/*`,
`apps/game/src/features/shop/*`, `apps/game/src/lib/billing/*`,
`supabase/functions/validate-google-purchase`, `packages/shared/src/currency.ts`,
`packages/shared/src/progression.ts`.

### Step 8 — Write `admin-reference.html`

Sections:

1. Scope and audience
2. Access model: allowlist, roles, guarded RPCs, RLS
3. Section registry and URLs
4. Operator workflows per domain
5. Config ownership and live-editable values
6. Reporting: RTP, users, audit log
7. Admin app structure: store, injected endpoints, data modules
8. Local development and deployment pointers
9. Known gaps and open decisions

Migration status: treat the RTK Query migration as complete. Verify by confirming each admin
feature folder contains its own `<x>Api.ts` and `<x>Data.ts` before publishing the claim.

Authoritative sources: `apps/admin/src/lib/adminSections.ts`, `apps/admin/src/features/*`,
`apps/admin/src/store/*`, `apps/admin/src/Admin.tsx`, admin RPC migrations.

Then delete `docs/admin-router.md`. Carry forward only two live items: optional lazy loading and the
`/users/:userId` deep link. Drop the pre-migration snapshot.

### Step 9 — Create the runbooks

1. `docs/runbooks/local-development.md` from `docs/admin-app.md`: dev servers, ports, build
   commands, environment variables, OAuth redirect setup. Link `architecture-reference.html` for
   hosting rules instead of restating them.
2. `docs/runbooks/android-build.md` from `docs/android-app-setup.md`.
3. `docs/runbooks/play-billing-release.md` from `docs/billing/native-wiring.md`. Status stays
   `pending`: release bundle and device test purchase are outstanding.
4. `docs/runbooks/supabase-migration-squash.md` from `docs/supabase-baseline.md`. Status stays
   `pending`.
5. Apply the section 5 template to all four.
6. Delete `docs/admin-app.md`, `docs/android-app-setup.md`, `docs/billing/native-wiring.md`,
   `docs/supabase-baseline.md`, and the empty `docs/billing/` folder.

### Step 10 — Create the index

Create `docs/README.md` with:

- The topic-to-owner table from section 3
- A list of runbooks with status
- An archive policy statement: historical documents stay, but are never cited as current facts

### Step 11 — Close out this plan

Move this file to `docs/archive/docs-migration.md` after the final verification passes.

---

## 7. Deletion summary

Deleted after their content moves:

- `docs/admin-app.md`
- `docs/admin-router.md`
- `docs/android-app-setup.md`
- `docs/billing/native-wiring.md`
- `docs/supabase-baseline.md`
- `docs/matchmaking-queue-expiry.md`
- `docs/remove-client-side-rolling.md`

Moved, not deleted:

- `docs/specs/daily-missions.md` → `docs/archive/daily-missions-spec-2026-05-23.md`
- `docs/prd/product-prd.html` → `docs/reference/product-reference.html`
- `docs/prd/daily-missions-prd.html` → `docs/reference/daily-missions-reference.html`

Untouched:

- Every existing file in `docs/archive/`

---

## 8. Verification

Run after all steps:

1. Anchor and asset check: every `href="#id"` resolves, IDs are unique, and each HTML file links an
   existing `reference.css`.
2. `pnpm exec prettier --write docs` then `pnpm exec prettier --check docs`.
3. `pnpm lint`.
4. `grep -rn` for each deleted path across the repository. Expect no results.
5. Open each reference in a browser. Confirm shared styles load in light and dark mode.
6. Confirm no reference contains a page-level `<style>` block.

---

## 9. Rules during execution

- Do not change application code.
- Do not delete anything in `docs/archive/`.
- Separate as-built facts from proposals in every reference.
- Cite code paths for factual claims. Verify each claim against current source.
- Keep one owner per topic. If two references need the same fact, one links to the other.
