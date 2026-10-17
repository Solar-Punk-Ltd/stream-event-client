/** One Prometheus series, its name with its labels exactly as Bee prints them, and its value. */
type MetricSeries = Map<string, number>;

/** A series that moved between two snapshots. `before` or `after` is null for a series that appeared or vanished. */
export interface MetricChange {
  series: string;
  before: number | null;
  after: number | null;
  change: number;
  /** The move over where the series started, Infinity for one that appeared, which JSON writes as null. */
  relative: number;
}

/** The value is the last space-separated field, since a label value may hold spaces of its own. */
const SAMPLE_LINE = /^(\S+?(?:\{.*\})?)\s+(\S+)(?:\s+\d+)?$/;

/** Reads a whole Prometheus text exposition, such as Bee's `/metrics`, into its series. */
export function parseMetrics(text: string): MetricSeries {
  const series: MetricSeries = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(SAMPLE_LINE);
    if (!match) continue;
    const value = Number(match[2]);
    if (Number.isFinite(value)) series.set(match[1], value);
  }
  return series;
}

/**
 * Every series that moved, the largest move first. A series that appeared counts from zero and one that vanished to
 * zero, so the ranking reads one way whichever it was.
 */
export function diffMetrics(before: MetricSeries, after: MetricSeries): MetricChange[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  const changes: MetricChange[] = [];
  for (const series of names) {
    const was = before.get(series) ?? null;
    const now = after.get(series) ?? null;
    const change = (now ?? 0) - (was ?? 0);
    const relative = was ? change / Math.abs(was) : Infinity;
    if (change !== 0 || (was === null) !== (now === null)) {
      changes.push({ series, before: was, after: now, change, relative });
    }
  }
  return changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.series.localeCompare(b.series));
}
