# Back Office app

The Back Office is built separately from the player game while sharing the same repository and Supabase project.

Shared ownership is explicit:

- `packages/shared/` contains database types and pure client utilities.
- `packages/board-preview/` is the only board-rendering entry available to admin UI.
- `npm run check:boundaries` rejects direct admin imports of the game renderer or engine.

## Local development

Run each app in its own terminal:

```bash
npm run dev
npm run dev:admin
```

- Game: `http://127.0.0.1:5174`
- Back Office: `http://127.0.0.1:5175`
- Admin OAuth callback: `http://127.0.0.1:5175/auth/callback`
- Legacy `/admin/auth/callback` mounts the same callback component, preserving PKCE query/hash values.

## Production builds

```bash
npm run build       # dist/
npm run build:admin # dist-admin/
npm run build:all
```

Deploy `dist/` and `dist-admin/` as separate sites. The admin site needs an SPA fallback to `/index.html`; `vercel.admin.json` contains a matching Vercel configuration.

Set these per deployment:

- Game: `VITE_ADMIN_APP_URL=https://admin.example.com`
- Admin: `VITE_GAME_APP_URL=https://game.example.com`
- Both: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

Add `https://admin.example.com/auth/callback` to the Supabase Auth redirect allowlist. Admin authorization remains enforced by `admin_roles`, `admin_email_allowlist`, guarded RPCs, and RLS.
