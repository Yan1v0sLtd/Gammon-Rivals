# Back Office app

The Back Office and player game are independent applications in the same repository. They share the Supabase project but do not link to or import each other.

Shared ownership is explicit:

- `packages/shared/` contains database types and pure client utilities.
- `packages/engine/` contains the pure game engine.
- `packages/board-renderer/` contains reusable board rendering.
- `packages/board-preview/` composes the shared engine and renderer for admin.

## Local development

Run each app in its own terminal:

```bash
pnpm run dev
pnpm run dev:admin
```

- Game: `http://127.0.0.1:5174`
- Back Office: `http://127.0.0.1:5175`
- Admin OAuth callback: `http://127.0.0.1:5175/admin/auth/callback`

## Production builds

```bash
pnpm run build           # game/Capacitor bundle → dist/play
pnpm run build:admin     # admin SPA → dist/admin
pnpm run build:website   # Astro marketing/legal site → dist/web
pnpm run build:all       # all three (boundary check + game + admin + website)
```

Deployment is a single site (see `nginx.conf`): `dist/web` serves the domain root
and `dist/admin` is served under `/admin`. `dist/play` is bundled into the
Capacitor app only and is **not** web-served — there is no `/play` route on the
public website.

All builds require `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Add the admin origin's `/admin/auth/callback` URL to the Supabase Auth redirect
allowlist. Admin authorization remains enforced by `admin_roles`,
`admin_email_allowlist`, guarded RPCs, and RLS.
