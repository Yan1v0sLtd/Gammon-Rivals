const RELOAD_FLAG = "__gr_chunk_reloaded__"

function isStaleChunkError(reason: unknown): boolean {
  if (!reason) return false
  const name = (reason as {name?: string}).name
  if (name === "ChunkLoadError") return true
  // Keep the fallback's native stringification for non-standard error reasons.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const message = String((reason as {message?: unknown}).message ?? reason)
  return (
    message.includes("is not a valid JavaScript MIME type")
    || message.includes("Failed to fetch dynamically imported module")
    || message.includes("error loading dynamically imported module")
    || message.includes("Importing a module script failed")
  )
}

function maybeReloadForStaleChunk(reason: unknown): void {
  if (!isStaleChunkError(reason) || sessionStorage.getItem(RELOAD_FLAG)) return
  sessionStorage.setItem(RELOAD_FLAG, "1")
  window.location.reload()
}

export function initializeClient(displayName: string, _releaseName: string): void {
  const build = {commit: __APP_BUILD_COMMIT__, time: __APP_BUILD_TIME__};
  (window as unknown as {__BUILD__: typeof build}).__BUILD__ = build
  console.info(
    `%c${displayName}%c build ${build.commit} · ${build.time}`,
    "font-weight:bold;color:#fcd34d",
    "color:inherit",
  )

  window.addEventListener("unhandledrejection", (event) => {
    maybeReloadForStaleChunk(event.reason)
  })
  window.addEventListener("error", (event) => {
    maybeReloadForStaleChunk(event.error ?? event.message)
  })
  window.addEventListener("load", () => {
    sessionStorage.removeItem(RELOAD_FLAG)
  })
}
