import path from "node:path"

import react from "@vitejs/plugin-react"
import {defineConfig} from "vite"

import {buildDefines, projectRoot, vendorChunkGroups} from "../../config/vite.shared.ts"

export default defineConfig({
  root: path.join(projectRoot, "apps/game"),
  envDir: projectRoot,
  publicDir: path.join(projectRoot, "packages/brand-assets/public"),
  plugins: [react()],
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  define: buildDefines(),
  server: {
    port: 5174,
    host: "127.0.0.1",
  },
  optimizeDeps: {
    include: ["cannon-es", "three"],
  },
  build: {
    outDir: path.join(projectRoot, "dist/play"),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: vendorChunkGroups(),
        },
      },
    },
  },
})
