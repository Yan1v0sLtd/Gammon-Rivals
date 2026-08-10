# Astro + pnpm migration — execution plan

Companion to `docs/astro-pnpm-migration-plan.md`, which holds the decisions and rationale. This file
is the ordered work list.

Each chunk is meant to be one commit: small, self-contained, and leaving the repo in a working
state. **Verification is manual and owned by the user** — no verification tasks are listed here.

## Refinement applied to the decisions doc

§5.3 of the plan routed the DB-driven asset roots (`/lobby/`, `/themes/`, `/loading/`) from
`dist/admin` via special Nginx locations. Superseded: the **website's** `publicDir` also points at
`packages/brand-assets/public`, so those paths are served from the document root (`dist/web`)
naturally. Admin's root-absolute DB paths then resolve with no special-case rules, and the website
can reference shared imagery by stable URL.

Trade-off accepted: `dist/web` carries the stable asset set.

## Manual prerequisites (outside the repo)

- Supabase redirect allowlist: add `https://gammonrivals.com/admin/auth/callback`.
- Supabase redirect allowlist: `https://gammonrivals.com/auth/callback` (game web callback) becomes
  obsolete once the game leaves the web. Safe to remove after Phase E.
- Native OAuth (`gammonrivals://auth/callback`) is unaffected throughout.

---

# Phase A — pnpm baseline

No behaviour change. Do this first; everything later assumes a working install path.

## A1 — Make the pnpm store resolvable

- `pnpm-workspace.yaml`: `storeDir: ${PNPM_STORE_DIR:-.pnpm-store}`.
- `package.json`: add pinned `packageManager` matching the mise pin (pnpm 11.20.0).
- `.gitignore`: add `.pnpm-store`.

Done when: a fresh clone can install without `PNPM_STORE_DIR` being set.

## A2 — Convert root script internals to pnpm

- `package.json`: `build:all`, `android:sync`, `android:debug`, `android:build`, `android:assets`
  currently chain `npm run` / `npx`. Convert to `pnpm run` / `pnpm exec`.

Done when: no `npm`/`npx` remains in root scripts.

## A3 — Convert CI to pnpm

- `.github/workflows/ci.yml`: `pnpm/action-setup`, `cache: pnpm`, frozen-lockfile install,
  `pnpm run build` / `pnpm test` / `pnpm run lint`.
- Align `node-version` with `mise.toml` (26.6.0); CI currently pins 22.
- Delete the stale comment block about `package-lock.json` and Windows-edited lockfiles.

Done when: CI no longer references npm or a package-lock.

## A4 — Convert docs and script headers to pnpm

- `docs/admin-app.md`, `docs/android-app-setup.md`, `docs/billing/native-wiring.md`.
- Header comments in `scripts/run-economy-sim.mjs`, `scripts/build-shared-engine.mjs`,
  `scripts/build-shared-ai.mjs` (`npm run build:shared-*`, `npm run sim`).
- `CLAUDE.md` / `AGENTS.md` command references.

Docs only. No code change.

---

# Phase B — Output split

Moves build outputs into `dist/{admin,play}`. Astro does not exist yet.

## B1 — Game output → `dist/play` (+ Capacitor)

- `apps/game/vite.config.ts`: `outDir` → `<root>/dist/play`.
- `capacitor.config.ts`: `webDir` → `dist/play`.

These must land together, or `cap sync` bundles the wrong directory.

Done when: `build` emits `dist/play` and Capacitor points at it.

## B2 — Admin output → `dist/admin` and base `/admin/`

- `apps/admin/vite.config.ts`: `outDir` → `<root>/dist/admin`, add `base: "/admin/"`.
- `apps/admin/src/App.tsx`: `BrowserRouter basename="/admin"`.
- `apps/admin/src/lib/AdminAuthProvider.tsx`: `redirectTo` → `${origin}/admin/auth/callback`.

Requires the Supabase allowlist entry from the prerequisites.

Done when: admin builds to `dist/admin` and its routes/callback live under `/admin`.

## B3 — Retire `dist-admin`

- `.gitignore`: drop `dist-admin` (the `dist` entry now covers all three outputs).
- `eslint.config.js`: drop `dist-admin` from ignores.

---

# Phase C — brand-assets

## C1 — Create the package skeleton and move native masters

- Create `packages/brand-assets/{imported,public,native}/`.
- Move committed SVG masters from root `assets/` into `packages/brand-assets/native/`
  (`icon-source.svg`, `icon-foreground.svg`, `splash-source.svg`).
- Update `scripts/render-android-assets.mjs` source paths.
- Update `.gitignore` entries for the generated PNG masters to the new location.

Asset-only; no TS is added, so `scripts/check-app-boundaries.mjs` needs no change.

## C2 — Move stable assets and repoint `publicDir`

- Move `public/{brand,gameplay,lobby,loading,themes}` and `public/favicon.svg` into
  `packages/brand-assets/public/`, preserving the exact directory shape so every URL is unchanged.
- `apps/game/vite.config.ts` and `apps/admin/vite.config.ts`: `publicDir` →
  `<root>/packages/brand-assets/public`.
- `.husky/pre-commit`: change the guarded path from `public/` to
  `packages/brand-assets/public/`.

No URL changes, so no database migration and no localStorage invalidation.

Done when: both apps build with identical asset URLs from the new source.

## C3 — (Optional, deferred) Per-consumer asset subsets

Filter which stable assets each output receives, so the marketing site stops shipping gameplay
chrome and the APK stops shipping website art. Not required for correctness; do it only if APK size
or deploy size justifies the extra build machinery.

---

# Phase D — Astro website

## D1 — Scaffold `apps/website`

- `pnpm-workspace.yaml`: add `apps/*` (existing apps have no manifest, so pnpm ignores them).
- Create `apps/website/` with `package.json`, `tsconfig.json`, `astro.config.mjs`.
- Config: `outDir` → `<root>/dist/web`, `publicDir` → `packages/brand-assets/public`, default
  `_astro` asset dir, static output.
- Root `package.json`: add `dev:website` / `build:website` using `pnpm --filter`; add website to
  `build:all`.
- Placeholder `src/pages/index.astro` only.

Done when: the website builds to `dist/web`.

## D2 — Shared layout and styles

- `src/layouts/SiteLayout.astro`: `<html>`/`<head>`, title, description, canonical, Open Graph and
  Twitter tags, favicon, global stylesheet, background/shell, header, footer.
- `src/layouts/LegalLayout.astro`: wraps `SiteLayout`, adds the shared document panel.
- `src/styles/global.css`: port `public/site.css`.
- Fix the latent bug: define `--font-display` in the website's own styles (the marketing pages
  currently reference it without defining it and silently fall back to `sans-serif`).
- Extract the header/nav/footer into components.

## D3 — Landing page

- Port `public/landing.html` → `src/pages/index.astro`, using `SiteLayout`.
- Keep the "Coming Soon" CTA and the covert `/play` wordmark behaviour decision explicit: `/play`
  no longer exists on the web, so that link must be dropped or repointed.
- Website-exclusive imagery (logo, hero background) goes in `brand-assets/imported/` and is imported
  so Astro can optimize it; shared/DB-driven imagery keeps its stable URL.

## D4 — How-to-play page

- Port `public/how-to-play.html` → `src/pages/how-to-play.astro`.
- Extract the feature-card grid and board strip into components.
- Board previews and lobby icons are shared/DB-seeded: reference by stable URL, do not duplicate
  into `imported/`.

## D5 — Legal pages

- Port `public/privacy.html` → `src/pages/privacy.astro` and `public/terms.html` →
  `src/pages/terms.astro`, both on `LegalLayout`.
- Content is migrated verbatim; no rewording in this chunk.

## D6 — Static delete-account page

- New `src/pages/delete-account.astro` on `LegalLayout`.
- Content: how to request deletion from `support@gammonrivals.com`, what to include, that support
  may verify ownership, and what deletion covers.
- No form, no script, no auth, no API call.
- Keep wording consistent with the Privacy Policy's deletion section, including its stated timing.

## D7 — SEO, sitemap, robots, service worker

- Set the production `site` URL in `astro.config.mjs`.
- Add the sitemap integration; Astro pages only, no `/play` entry.
- `robots.txt` in the website public dir: point at the generated sitemap, keep `Disallow: /admin`.
- Move `public/sw.js` → `apps/website/public/sw.js` unchanged.
- Add `src/pages/404.astro` using `SiteLayout`.

---

# Phase E — Disable the in-app deletion route

## E1 — Disable route and entry point, keep the logic

- `apps/game/src/App.tsx`: disable the `/delete-account` route.
- `apps/game/src/features/profile/ProfileAccountActions.tsx`: disable the entry point, so Profile
  does not gain a control that falls through to the catch-all and bounces to `/play`.
- **Do not remove** `apps/game/src/pages/DeleteAccount.tsx`, `useDeleteMyAccountMutation`, or the
  `delete_my_account` RPC. The user removes these later.

---

# Phase F — Nginx

## F1 — Add `nginx.conf`

Single server for `gammonrivals.com`, HTTP only (TLS terminates upstream), document root `dist/web`.

- `/` and the Astro pages from `dist/web`, with clean-URL resolution.
- `/_astro/*` from `dist/web`, immutable caching.
- `/admin` and `/admin/*` from `dist/admin`, SPA fallback scoped to this prefix only.
- `/admin/assets/*` immutable caching.
- Stable asset roots (`/lobby/`, `/themes/`, `/loading/`, `/gameplay/`, `/brand/`, `/favicon.svg`)
  from the document root.
- `/sw.js`: exact match, `no-store`, never rewritten to an SPA shell.
- HTML: revalidate.
- Everything else: Astro 404.

No game routes and no root-level `/assets/*`.

---

# Phase G — Cleanup

## G1 — Remove superseded static site files

- Delete `public/landing.html`, `public/how-to-play.html`, `public/privacy.html`,
  `public/terms.html`, `public/site.css`, `public/sitemap.xml`, `public/robots.txt`.
- Delete `public/icons.svg` (currently unreferenced).
- Remove the now-empty root `public/` directory and any remaining references to it.

## G2 — Update documentation

- `docs/admin-app.md`: replace the separate `dist/` + `dist-admin/` deployment description with the
  `dist/{web,admin,play}` layout and the `/admin` base.
- `docs/android-app-setup.md`: `webDir` is `dist/play`; note that the `server.url` live-reload
  workflow is permanently dead because `/play` no longer exists on the web.
- `CLAUDE.md` / `AGENTS.md`: update the file-structure section to include `apps/website` and
  `packages/brand-assets`, and note the game is Capacitor-only on the web.
