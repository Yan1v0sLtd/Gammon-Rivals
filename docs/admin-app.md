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

Deploy `dist/` and `dist-admin/` as separate sites. Both deployments require `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Add the admin origin's `/auth/callback` URL to the Supabase Auth redirect allowlist. Admin authorization remains enforced by `admin_roles`, `admin_email_allowlist`, guarded RPCs, and RLS.
