import {defineConfig} from "vitest/config"

export default defineConfig({
  test: {
    // Packages are tested; apps are not. Everything under packages/ is pure,
    // headless, deterministic TypeScript (engine rules, AI decision logic, the
    // economy sim) — cheap to test and expensive to get wrong. Everything under
    // apps/ is UI and client state (React, Pixi, Redux, RTK Query); those tests
    // churned faster than they caught bugs and were removed deliberately.
    // scripts/check-app-boundaries.mjs keeps the split honest by forbidding
    // packages/** from importing apps/**. Do not widen this glob to apps/**.
    include: ["packages/**/*.{test,spec}.ts"],
  },
})
