export function formatCompactNumber(value: number | null | undefined): string {
  const numeric = Math.max(0, value ?? 0);
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(numeric >= 10_000_000 ? 0 : 1)}M`;
  }
  if (numeric >= 10_000) {
    return `${(numeric / 1_000).toFixed(numeric >= 100_000 ? 0 : 1)}K`;
  }
  return numeric.toLocaleString();
}
