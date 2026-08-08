import path from "node:path"
import {fileURLToPath} from "node:url"

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const VENDOR_PACKAGES = [
  "pixi.js",
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "scheduler",
  "@supabase/supabase-js",
  "@supabase/auth-js",
  "@supabase/functions-js",
  "@supabase/postgrest-js",
  "@supabase/realtime-js",
  "@supabase/storage-js",
  "@supabase/phoenix",
  "@capacitor/core",
  "@capacitor/app",
  "@capacitor/browser",
  "@capgo/capacitor-social-login",
  "capacitor-plugin-cdv-purchase",
  "cordova-plugin-purchase",
  "@pixi/colord",
  "earcut",
  "eventemitter3",
  "iceberg-js",
  "ismobilejs",
  "parse-svg-path",
  "tiny-lru",
  "tslib",
] as const

function isPackageModule(id: string, packageName: string): boolean {
  const normalizedId = id.replaceAll("\\", "/")
  return normalizedId.includes(`/node_modules/${packageName}/`)
}

export function vendorChunkGroups() {
  return VENDOR_PACKAGES.map((packageName) => ({
    name: `vendor-${packageName.replaceAll("/", "-")}`,
    test: (id: string) => isPackageModule(id, packageName),
    includeDependenciesRecursively: false,
  }))
}

export function buildDefines(): Record<string, string> {
  const commit = (process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "dev").slice(0, 7)
  return {
    __APP_BUILD_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  }
}
