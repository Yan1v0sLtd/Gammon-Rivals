export type PerfCounts = Readonly<Record<string, number>>

const counts = import.meta.env.DEV ? new Map<string, number>() : undefined
let markId = 0

export function measure<T>(name: string, callback: () => T): T {
  if (!import.meta.env.DEV) return callback()

  const currentCounts = counts!
  currentCounts.set(name, (currentCounts.get(name) ?? 0) + 1)

  const id = markId++
  const startMark = `board-renderer:${name}:start:${id}`
  const endMark = `board-renderer:${name}:end:${id}`
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

export function getCounts(): PerfCounts {
  if (!counts) return {}
  return Object.fromEntries(counts)
}
