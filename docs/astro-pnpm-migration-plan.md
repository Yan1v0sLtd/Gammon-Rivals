# Astro website + pnpm workspace migration plan

Status: agreed plan, not yet implemented.

This plan covers three things:

1. Moving the static marketing/legal pages to a new Astro application.
2. Serving one domain (`gammonrivals.com`) from a single root Nginx config.
3. Completing the pnpm migration and introducing the first real workspace.

**The game is no longer served on the web.** It becomes a Capacitor-only application. This is the
decision that shapes everything below.

Where a decision was deliberately deferred or placed out of scope, it is marked as such — do not
silently expand into it.

---

## 1. Technology split

| Application | Technology | Delivery |
|---|---|---|
| Marketing + legal website | Astro, statically generated | Web (`gammonrivals.com`) |
| Back office (admin) | React + Vite SPA (unchanged) | Web (`gammonrivals.com/admin`) |
| Game | React + Vite SPA (unchanged) | **Capacitor bundle only — not served on the web** |

Astro replaces only the static marketing/legal pages. It does not absorb any part of the game or
admin SPAs.

The honest justification for Astro is maintainability, not runtime speed: the current pages already
ship as static HTML. What we gain is one shared layout, shared header/nav/footer, one metadata
component, file-based clean routes, and generated sitemap output — instead of four hand-duplicated
HTML documents (`public/landing.html`, `public/how-to-play.html`, `public/privacy.html`,
`public/terms.html`).

---

## 2. Deployment and route contract

### 2.1 Output layout

```text
dist/
├── web/     → Astro static site        (web-served, document root)
├── admin/   → admin SPA                (web-served under /admin)
└── play/    → game SPA                 (NOT web-served; Capacitor bundle source only)
```

Each application build clears only its own output directory. The root aggregate build may clear
`dist/` once, before building all three.

**Delivery is out of scope.** How `dist/` reaches the Nginx host — container image, CI job, manual
copy — is deliberately not decided here. This plan defines the build outputs and the server route
contract, nothing beyond that.

### 2.2 Nginx

- A root `nginx.conf` is added to the repository.
- It serves the single domain `gammonrivals.com`.
- **TLS terminates upstream.** Nginx listens over plain HTTP; certificates are handled by whatever
  sits in front of it.
- Document root is the Astro output (`dist/web`).

### 2.3 Route ownership

| URL | Served from |
|---|---|
| `/` | `dist/web` |
| `/how-to-play` | `dist/web` |
| `/privacy` | `dist/web` |
| `/terms` | `dist/web` |
| `/delete-account` | `dist/web` (new static page) |
| `/admin`, `/admin/*` | `dist/admin` (SPA fallback within this prefix only) |
| `/admin/assets/*` | `dist/admin/assets` |
| `/_astro/*` | `dist/web` hashed assets |
| `/sw.js` | exact static file from `dist/web`, `no-store` |
| DB-driven asset roots (`/lobby/*`, `/themes/*`, `/loading/*`) | `dist/admin` (see §5.3) |
| anything else | **Astro 404 page** |

Because the game is not web-served, there are **no** `/play`, `/profile`, `/hotseat`, `/replay/*`
or root-level `/auth/callback` routes on the web, and no root-level `/assets/*` game chunk
directory. The only SPA fallback in the whole config is scoped inside `/admin/`.

This removes the maintenance coupling that a scoped fallback would otherwise create: adding a game
route no longer has any Nginx consequence at all, because the game never reaches Nginx.

### 2.4 `/sw.js`

The self-destructing service worker in `public/sw.js` was registered against the
`gammonrivals.com` origin by an old PWA deploy. That origin is now served by Astro, so the file
**moves into the website's public directory** (`apps/website/public/sw.js`) and is served from
`dist/web`.

It must keep its exact URL, must never 404, and must never be rewritten to an SPA `index.html`. An
orphaned worker whose update check fails leaves that browser stranded on a stale precached build.
Serve it with `no-store`.

### 2.5 `/delete-account`

- A **new static Astro page** at `/delete-account` becomes the single public deletion surface. It
  explains how to request deletion from `support@gammonrivals.com`: what to include, that support
  may verify account ownership, and what deletion covers.
- It has no interactivity: no auth, no API call, no form, no client-side script.
- This satisfies the Google Play requirement for a deletion URL reachable without the app.

In the game app:

- The `/delete-account` **route is disabled** in `apps/game/src/App.tsx`.
- The **logic is not removed**: `apps/game/src/pages/DeleteAccount.tsx`, the
  `useDeleteMyAccountMutation` hook and the `delete_my_account` RPC all stay in place.
- Loose end to handle in the same change: `apps/game/src/features/profile/ProfileAccountActions.tsx`
  links to `/delete-account`. With the route disabled that link falls through to the router's
  catch-all and bounces to `/play`. The entry point must be disabled alongside the route (or pointed
  at the public web page), otherwise Profile gains a dead control.

Because the game is no longer web-served, the previous split-brain problem is gone: one URL, one
page, one source of truth. Wording must still stay consistent with `public/privacy.html`, which
describes both an in-app and a web deletion path.

### 2.6 Admin under `/admin`

Required changes:

- Vite `base: "/admin/"`.
- `BrowserRouter basename="/admin"`.
- OAuth callback becomes `/admin/auth/callback` — a direct consequence of the basename, not of any
  collision (the game's web callback no longer exists).
- Supabase redirect allowlist updated to include the new admin callback URL.

### 2.7 Capacitor

- `capacitor.config.ts` → `webDir: "dist/play"`.
- Android commands build only the game.
- The game keeps a root asset base, so root-relative asset paths resolve inside the WebView bundle.
- The native app still boots at `/` and redirects to `/play` via the existing `IndexRedirect`. The
  comment in `App.tsx` claiming the web `/` is the marketing landing and never reaches the router
  becomes unconditionally true.

**Consequence to accept:** the commented-out "Vercel-for-mobile" live-reload workflow in
`capacitor.config.ts` (`server.url` pointing at `https://gammonrivals.com/play`) is now permanently
dead, because `/play` will not exist on the web. Native iteration is bundle-rebuild only.

---

## 3. pnpm baseline

pnpm is already the de-facto manager (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `mise.toml` pins
pnpm 11.20.0), but the migration was never finished: scripts, docs and CI still speak npm.

- pnpm is the only package manager. Keep exactly one root `pnpm-lock.yaml`.
- Never reintroduce `package-lock.json`. (The original draft's "retain one root package-lock" is
  wrong — the file no longer exists, and two lockfiles would mean two resolutions.)
- Add a pinned `packageManager` field to the root manifest.
- Fix the store directory to have a working default:

  ```yaml
  storeDir: ${PNPM_STORE_DIR:-.pnpm-store}
  ```

  pnpm supports `${NAME:-fallback}` in `pnpm-workspace.yaml`. Today the bare `${PNPM_STORE_DIR}`
  makes any install fail where the variable is unset.
- Add workspace patterns for `apps/*` (and `packages/*` for the later phase).
- Convert nested `npm run` / `npx` usage in root scripts, CI and docs to pnpm.
- CI installs with the frozen lockfile and runs the pnpm equivalents of build/test/lint. The stale
  npm cache/install comment in `.github/workflows/ci.yml` goes with it.

Workspace commands use pnpm filters, not npm-style `--workspace` paths:

```jsonc
{
  "scripts": {
    "dev:website": "pnpm --filter website dev",
    "build:website": "pnpm --filter website build"
  }
}
```

**Scope limit:** `apps/website` is the only new workspace importer in this phase. The game, the
admin app and everything under `packages/` keep resolving dependencies from the root manifest until
the later package-boundary phase (§6).

---

## 4. Astro website (`apps/website`)

```text
apps/website/
├── public/
│   └── sw.js
├── src/
│   ├── components/
│   ├── layouts/
│   │   ├── SiteLayout.astro
│   │   └── LegalLayout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── how-to-play.astro
│   │   ├── privacy.astro
│   │   ├── terms.astro
│   │   ├── delete-account.astro
│   │   └── 404.astro
│   └── styles/
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

Constraints:

- **No React integration, no MDX, no Markdown, no client-side JavaScript.** Legal and marketing
  content is authored in `.astro` only.
- `SiteLayout.astro` owns `<html>`/`<head>`, metadata, canonical URL, Open Graph/Twitter tags,
  favicon, global stylesheet, background/shell, header and footer.
- `LegalLayout.astro` wraps `SiteLayout` and adds the shared document panel used by Privacy, Terms
  and the delete-account page.
- Content and appearance are migrated, not redesigned. The existing pages already carry per-page
  titles, descriptions, canonical links and Open Graph tags; those move into the shared metadata
  component.
- Keep Astro's default `_astro` asset directory.

Known latent bug to fix during the port: `public/site.css` uses `var(--font-display)`, which the
marketing pages never define (only `apps/game/src/index.css` does), so those pages silently fall
back to `sans-serif`. Define the variable in the website's own styles rather than porting the bug.

SEO / generated files:

- Set the production `site` URL so canonical URLs and the sitemap generate correctly.
- The sitemap contains **Astro pages only**. `/play` is not part of the website and must not be
  published or indexed.
- `robots.txt` points at the generated sitemap and keeps disallowing `/admin`.
- The hand-maintained `public/sitemap.xml` is retired.

---

## 5. Brand assets (`packages/brand-assets`)

`brand-assets` becomes the single source of truth for static brand/visual assets. It is created as a
**source directory now, not a pnpm package** — matching the existing convention where no directory
under `packages/` has a manifest. It gets a manifest in the later package-boundary phase.

```text
packages/brand-assets/
├── imported/     → compile-time imports (fingerprinted by Vite, optimizable by Astro)
├── public/       → stable URLs required by DB rows, Pixi loading, dynamic paths
└── native/       → Android icon/splash source masters (moved from root assets/)
```

### 5.1 Why two delivery modes

A single file cannot reliably be both a Vite `publicDir` file and a normal imported module. Each
asset has exactly one canonical home, chosen by how it is consumed:

- **`imported/`** — referenced only from code we control at build time. Imported directly by the
  consuming module. Astro can run `astro:assets` transforms; Vite fingerprints them.
- **`public/`** — the URL is not known at build time and must stay stable:
  - board theme images stored in `board_theme_configs`,
  - loading-screen and podium images stored in Supabase,
  - mission badge/chest and difficulty images built from template strings,
  - Pixi textures loaded by URL string in `packages/board-renderer/src/theme/loader.ts`,
  - operator-configured image URLs from the back office.

  These keep their current root-relative paths (`/lobby/...`, `/themes/...`, `/loading/...`), so
  existing database values and localStorage caches stay valid. **No database migration is required.**

### 5.2 Per-consumer asset sets

Removing the game from web serving means the three outputs no longer need the same assets. Each
build takes only its own subset:

| Output | Needs |
|---|---|
| `dist/web` | website imagery only, imported and hashed into `_astro` |
| `dist/admin` | assets the back office renders, including DB-driven board/theme previews |
| `dist/play` | the full game asset set, resolved inside the Capacitor bundle |

This avoids shipping gameplay chrome to the marketing site and website art into the APK. The APK
size consequence is real: `dist/play` is bundled offline.

### 5.3 The one shared-URL rule — SUPERSEDED

> **Superseded during execution planning.** See the refinement note at the top of
> `docs/astro-pnpm-migration-execution.md`.
>
> This section originally routed the DB-driven asset roots from `dist/admin` via special Nginx
> locations. Instead, the **website's** `publicDir` also points at `packages/brand-assets/public`,
> so `/lobby/*`, `/themes/*` and `/loading/*` are served from the document root (`dist/web`).
> Admin's root-absolute DB paths then resolve with no special-case rules, and the website can
> reference shared imagery by stable URL. Trade-off accepted: `dist/web` carries the stable asset
> set.

The back office cannot be handled by the `/admin/` base alone: DB-supplied paths are **root-absolute
strings** (`/themes/x.webp`) and do not resolve relative to a base. That is the constraint the
refinement above solves.

### 5.4 Rules

- Every asset lives in exactly one place. No duplicated masters.
- No barrel file and no re-export module inside `brand-assets`; consumers import the exact path.
- `brand-assets` imports nothing, so it cannot affect the dependency-free status of `engine`, `ai`
  or `sim`.
- Native icon/splash masters move here from root `assets/`; the Android rendering script is updated.
- `sw.js`, `robots.txt`, generated sitemap output, website CSS and page content are website
  infrastructure, not brand assets.

### 5.5 What "optimize from one place" actually means

1. **Source compression/normalization** — run once, centrally, over `brand-assets`. The only lever
   that benefits every output. Precedent: `scripts/compress-textures.mjs`.
2. **Astro image optimization** — applies only to images imported into Astro components, so only
   `dist/web` gets responsive/recompressed variants.
3. **Vite fingerprinting** — hashes imported assets for cache-busting; it does not recompress.

The same source can still produce separate optimized copies per output. That is expected.

### 5.6 Known friction

- Classification depends on invisible runtime facts (is this path in Supabase? is it built from a
  template?). Making an asset DB-driven later means physically moving the file and updating imports.
- CSS `url('/...')` references in the game's CSS modules are root-absolute and are not rewritten by
  Vite. Converting them to fingerprinted imports requires relative URLs or inline styles; where that
  is not worth it, those assets stay in `public/` with stable URLs.

---

## 6. Deferred: package-boundary phase

Explicitly not part of this migration:

- Adding manifests to the game, the admin app and the existing `packages/*` directories.
- Declaring explicit `workspace:*` dependencies between them.
- Replacing root-coupled dependency resolution.
- Turning `brand-assets` into a real workspace package.

When that phase happens it must also update TypeScript project includes (`apps/*/tsconfig.json`),
the boundary checker roots and allow-lists (`scripts/check-app-boundaries.mjs`), and the Deno mirror
scripts (`scripts/build-shared-engine.mjs`, `scripts/build-shared-ai.mjs`) — all of which hard-code
repo-relative paths today. The dependency-free contract for `engine`/`ai`/`sim` and the no-barrel
rule must survive it.

`design-tokens` is also deferred. Tokens currently exist in three disjoint forms (Tailwind theme
colors, board-renderer `0x` hex Theme objects, CSS modules with deliberately no custom properties)
and nothing consumes a single token source.

---

## 7. Execution

This document records decisions and rationale only. The ordered, commit-sized work list lives in
`docs/astro-pnpm-migration-execution.md`.

Phases there, in order: pnpm baseline → output split → `brand-assets` → Astro website → disable the
in-app deletion route → `nginx.conf` → cleanup.
