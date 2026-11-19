// Opt-in, bounded measurements. These measure JS work, not input-to-photon latency.
const enabled = new URLSearchParams(location.search).has('perf');
const samples = new Map<string, number[]>();
export function measure<T>(name: string, work: () => T): T {
  if (!enabled) return work();
  const start = performance.now();
  try {
    return work();
  } finally {
    const values = samples.get(name) ?? [];
    if (values.length === 512) values.shift();
    values.push(performance.now() - start);
    samples.set(name, values);
  }
}
export function snapshot() {
  return Object.fromEntries(
    [...samples].map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [
        name,
        {
          count: sorted.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
          max: sorted.at(-1),
        },
      ];
    }),
  );
}
if (enabled) Object.assign(window, { elasticPerformance: snapshot });
