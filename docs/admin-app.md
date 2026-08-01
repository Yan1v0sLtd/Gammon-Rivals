# Back Office app

The Back Office is built separately from the player game while sharing the same repository and Supabase project.

## Local development

Run each app in its own terminal:

```bash
npm run dev
npm run dev:admin
```

- Game: `http://127.0.0.1:5174`
- Back Office: `http://127.0.0.1:5175`
- Admin OAuth callback: `http://127.0.0.1:5175/auth/callback`

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
