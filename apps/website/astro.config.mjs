import path from "node:path"
import {copyFile, readdir} from "node:fs/promises"
import {fileURLToPath} from "node:url"

import {defineConfig} from "astro/config"
import sitemap from "@astrojs/sitemap"

// Repo root, derived from this file's location so paths never depend on the cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const websitePublic = path.join(repoRoot, "apps/website/public")

// `publicDir` points at the shared brand-assets dir, which the game and admin
// builds also consume — so website-only static files (robots.txt, sw.js) live
// in apps/website/public and are copied into the output by this hook. Copying
// here keeps the shared dir clean and never touches game/admin outputs.
const websiteStatic = {
  name: "website-static",
  hooks: {
    "astro:build:done": async ({dir}) => {
      for (const file of await readdir(websitePublic)) {
        await copyFile(path.join(websitePublic, file), path.join(fileURLToPath(dir), file))
      }
    },
  },
}

export default defineConfig({
  output: "static",
  site: "https://gammonrivals.com",
  outDir: path.join(repoRoot, "dist/web"),
  publicDir: path.join(repoRoot, "packages/brand-assets/public"),
  integrations: [sitemap(), websiteStatic],
})
