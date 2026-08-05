// DEV-only instrumentation; React StrictMode double-invokes renders, so compare counts relatively, not absolutely.
export type PerfCounts = Readonly<Record<string, number>>

const counts = import.meta.env.DEV ? new Map<string, number>() : undefined
let markId = 0

export function measure<T>(name: string, callback: () => T): T {
  if (!import.meta.env.DEV) return callback()

  const currentCounts = counts!
  currentCounts.set(name, (currentCounts.get(name) ?? 0) + 1)

  const id = markId++
  const startMark = `perf:${name}:start:${id}`
  const endMark = `perf:${name}:end:${id}`
  let startMarked = false
  try {
    performance.mark(startMark)
    startMarked = true
  }
  catch {
    // Instrumentation must not prevent the callback from running.
  }
  try {
    return callback()
  }
  finally {
    if (startMarked) {
      try {
        performance.mark(endMark)
        performance.measure(name, startMark, endMark)
      }
      catch {
        // Instrumentation must not change the callback's result or exception.
      }
    }
  }
}

export function count(name: string): void {
  if (!import.meta.env.DEV) return

  const currentCounts = counts!
  currentCounts.set(name, (currentCounts.get(name) ?? 0) + 1)
  try {
    performance.mark(name)
  }
  catch {
    // Instrumentation must not affect application behavior.
  }
}

export function resetCounts(): void {
  if (!import.meta.env.DEV) return
  counts!.clear()
}

export function getCounts(): PerfCounts {
  if (!counts) return {}
  return Object.fromEntries(counts)
}
