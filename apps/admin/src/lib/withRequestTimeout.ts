export function withRequestTimeout<T>(request: PromiseLike<T>, label: string, timeoutMs = 12000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} is taking too long. Please refresh and try again.`))
    }, timeoutMs)
  })

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}
