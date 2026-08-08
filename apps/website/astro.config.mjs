import path from "node:path"
import {fileURLToPath} from "node:url"

import {defineConfig} from "astro/config"

// Repo root, derived from this file's location so paths never depend on the cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export default defineConfig({
  output: "static",
  outDir: path.join(repoRoot, "dist/web"),
  publicDir: path.join(repoRoot, "packages/brand-assets/public"),
})
