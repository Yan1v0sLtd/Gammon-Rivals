# Local Development

> Status: live · Last verified: 2026-08-10 · Owner: developer

## Purpose

Run the Back Office and player game applications locally, and build all three
deployable bundles. The Back Office and player game are independent applications
in the same repository. They share the Supabase project but do not link to or
import each other.

Shared ownership is explicit:

- `packages/shared/` contains database types and pure client utilities.
- `packages/engine/` contains the pure game engine.
- `packages/board-renderer/` contains reusable board rendering.
- `packages/board-preview/` composes the shared engine and renderer for admin.

## Prerequisites

- Node.js and pnpm installed.
- Supabase project credentials: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Steps

Run each app in its own terminal:

```bash
pnpm run dev
pnpm run dev:admin
```

- Game: `http://127.0.0.1:5174`
- Back Office: `http://127.0.0.1:5175`
- Admin OAuth callback: `http://127.0.0.1:5175/admin/auth/callback`

Production builds:

```bash
pnpm run build           # game/Capacitor bundle → dist/play
pnpm run build:admin     # admin SPA → dist/admin
pnpm run build:website   # Astro marketing/legal site → dist/web
pnpm run build:all       # all three (boundary check + game + admin + website)
```

All builds require `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Verification

- Each dev server serves its app at the port above.
- `pnpm run build:all` completes without error.

## Troubleshooting

- Add the admin origin's `/admin/auth/callback` URL to the Supabase Auth
  redirect allowlist. Admin authorization remains enforced by `admin_roles`,
  `admin_email_allowlist`, guarded RPCs, and RLS.

## Related documents

- `docs/reference/03-architecture-reference.md` — hosting and delivery rules.
