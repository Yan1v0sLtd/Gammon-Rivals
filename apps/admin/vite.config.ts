import path from "node:path"

import react from "@vitejs/plugin-react"
import {defineConfig} from "vite"

import {buildDefines, projectRoot, vendorChunkGroups} from "../../config/vite.shared.ts"

export default defineConfig({
  root: path.join(projectRoot, "apps/admin"),
  envDir: projectRoot,
  publicDir: path.join(projectRoot, "packages/brand-assets/public"),
  base: "/admin/",
  plugins: [react()],
  define: buildDefines(),
  server: {
    port: 5175,
    host: "127.0.0.1",
  },
  optimizeDeps: {
    include: ["pixi.js"],
  },
  build: {
    outDir: path.join(projectRoot, "dist/admin"),
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
