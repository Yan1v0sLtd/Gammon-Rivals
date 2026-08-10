# Task: Supabase Migration Squash

> Status: pending · Last verified: 2026-08-10 · Owner: developer

## Purpose

Shrink `supabase/migrations/` (123 files) into one baseline + a short tail,
without touching existing data. Pre-launch product — no production data to
preserve beyond what is already in the database.

## Prerequisites

- Supabase CLI installed (see Part 1 below).
- A linked Supabase project.

### Terms

- **Project** — your hosted Supabase database (the one in the dashboard).
- **Link** — telling the CLI "talk to this project".
- **Migration history** — a small table inside the database
  (`supabase_migrations.schema_migrations`) that records which migration files
  have already been run.
- **Baseline** — one big SQL file that recreates your entire current schema
  from scratch.
- **Migration repair** — a CLI command that marks a migration version as applied
  (or reverted) in the history table _without executing it_.

## Steps

### Part 1: Install the CLI

macOS (Homebrew):

```bash
brew install supabase/tap/supabase
supabase --version
```

Alternatives:

```bash
npm install -g supabase
```

or binaries from GitHub releases: https://github.com/supabase/cli/releases

### Part 2: The plan

#### Step 1 — Log in

```bash
supabase login
```

Opens the browser and asks you to allow the CLI. One-time.

#### Step 2 — Link to your project

```bash
supabase link --project-ref <REF>
```

Where to find `<REF>`: Supabase dashboard → **Project Settings → General →
Reference ID** (e.g. `abcdefghijklmnop`).

If the repo has no `supabase/config.toml` yet, run `supabase init` first.

#### Step 3 — Dump the current schema

```bash
supabase db dump --schema > supabase/migrations/0000_baseline.sql
```

Asks the linked project to describe everything it has (tables, columns,
functions, triggers, RLS) and writes it into the baseline file.

The schema dump does NOT include seed data (shop items, board themes, etc. that
old migrations inserted with `INSERT`). Add the seed inserts from the old
migrations into `0000_baseline.sql` manually so fresh environments build fully.

#### Step 4 — Mark the baseline as already applied

```bash
supabase migration repair --status applied 0000_baseline
```

Inserts one row into the migration history table saying "version
`0000_baseline` is done" — without running it. This is what keeps existing data
safe: the tables already exist, so we never re-create them.

#### Step 5 — Delete the old migration files

```bash
rm supabase/migrations/0001_init.sql # ... all except 0000_baseline.sql
```

Keep `0000_baseline.sql` plus any new migrations added from now on.

#### Step 6 — Push

```bash
supabase db push
```

The CLI compares local files against the history table. `0000_baseline` is
already applied → skipped. Nothing new → nothing runs. Data untouched.

#### Step 7 — Prove fresh environments still build

```bash
supabase start   # requires Docker; runs a local copy
supabase db reset
```

Builds a fresh empty database by running only `0000_baseline.sql`. If it builds
cleanly, anyone cloning the repo (or a future staging project) gets the same
schema.

#### Step 8 — Verify nothing drifted

On a test copy, compare the baseline-built schema against the real project:

```bash
supabase db diff --linked
```

"no changes" → baseline is a perfect match. Differences → fix the baseline.

### The order that matters

1. Dump baseline (Step 3)
2. Repair history (Step 4)
3. Delete old files (Step 5)
4. Push / test (Steps 6–8)

Do NOT delete the old files before dumping — they are the source for the seed
data.

## Verification

- `supabase db diff --linked` reports "no changes".
- A fresh `supabase db reset` builds cleanly from `0000_baseline.sql`.

## Troubleshooting

- **Staging / validation (optional, pre-launch):**
  - **Branching** — Supabase preview branches are tied to GitHub PRs, live ~24h,
    and **cannot be promoted to production**. Use a branch only to validate the
    squash in isolation.
  - **Rollout** — pre-launch, use `supabase db reset --linked` (destructive:
    drops all objects, replays from baseline) OR create a fresh project and
    repoint the app's `SUPABASE_URL` / anon key + auth provider callbacks.
  - **Data preservation without reset** — the `migration repair` route above
    never drops anything. Only the migration history table is edited.

## Related documents

- `docs/reference/03-architecture-reference.md` — backend surface and RLS.
