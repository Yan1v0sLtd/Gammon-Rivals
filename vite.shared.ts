export function buildDefines(): Record<string, string> {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
  return {
    __APP_BUILD_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  };
}
