# Gammon Rivals — Documentation Index

This is the documentation home for the Gammon Rivals monorepo. Documents are
grouped into references, runbooks, tasks, bugs, and archive.

## Topic ownership

Each topic has exactly one owner. Other documents link to it, they do not
restate it.

| Topic                                                                           | Owner                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------ |
| Player promise, feature status, product priorities, GDD                         | `reference/01-product-reference.md`        |
| Missions, streak, rerolls, chests, mission admin                                | `reference/02-daily-missions-reference.md` |
| Apps, packages, boundaries, backend surface, state rules, hosting               | `reference/03-architecture-reference.md`   |
| Match entry, matchmaking, modes, dice/move authority, reconnect, integrity gaps | `reference/04-online-play-reference.md`    |
| Tiers, stakes, payouts, currencies, XP, rating, shop, billing grants            | `reference/05-economy-reference.md`        |
| Admin sections, operator workflows, roles, config ownership, reporting          | `reference/06-admin-reference.md`          |
| Commands and procedures                                                         | `runbooks/*.md`                            |
| Rules and non-negotiables                                                       | `AGENTS.md`                                |

## References

Ordered by topic:

1. `reference/01-product-reference.md` — product requirements and light GDD.
2. `reference/02-daily-missions-reference.md` — daily/weekly mission system.
3. `reference/03-architecture-reference.md` — repository structure and rules.
4. `reference/04-online-play-reference.md` — one match lifecycle.
5. `reference/05-economy-reference.md` — value flow and economy.
6. `reference/06-admin-reference.md` — Back Office.

## Runbooks

| Runbook                               | Status                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| `runbooks/01-local-development.md`    | live                                                     |
| `runbooks/02-android-build.md`        | live                                                     |
| `runbooks/03-play-billing-release.md` | pending (release AAB + device test purchase outstanding) |

## Tasks and bugs

- `tasks/` — unimplemented work items with problem statements and acceptance
  criteria.
- `bugs/` — confirmed defects tracked for fixing.

Tasks:

1. `tasks/01-matchmaking-queue-expiry.md` — expire stale matchmaking queue entries.
2. `tasks/02-remove-client-side-rolling.md` — server-authoritative dice only.
3. `tasks/03-supabase-migration-squash.md` — squash `supabase/migrations/` into one baseline.
4. `tasks/04-admin-css-modules-migration.md` — migrate `apps/admin` from Tailwind to CSS Modules
   (inventory: `tasks/04-admin-css-modules-inventory.md`).
5. `tasks/05-doubling-cube-confirm-step.md` — confirm step before offering a double.

## Archive policy

Historical documents stay in `archive/` and are never cited as current facts.
They are kept as evidence and for git history. The references above are the
current authority.
