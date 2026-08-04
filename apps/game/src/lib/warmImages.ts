/**
 * Fire the browser's image pipeline for the given URLs so the Shop's
 * image-preload reveal gate resolves instantly when it opens. Presentation
 * concern only — this stays separate from the RTK Query server-data cache.
 * Fire-and-forget: a failed warm-up just means the image is fetched when
 * first rendered.
 */
export function warmImages(urls: readonly (string | null | undefined)[]): void {
  const seen = new Set<string>()
  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    const img = new Image()
    img.src = url
  }
}
