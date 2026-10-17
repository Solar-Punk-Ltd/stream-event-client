import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';

import { metricsText } from './bee.ts';
import { cpuCeiling } from './cgroup.ts';
import { docker, PROJECT, services } from './docker.ts';
import { diffMetrics, type MetricChange, parseMetrics } from './metrics.ts';

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every node's whole `/metrics`, written as it answered, and kept in memory for the diff. */
export async function snapshotMetrics(nodes: Record<string, string>, dir: string): Promise<Record<string, string>> {
  mkdirSync(dir, { recursive: true });
  const out: Record<string, string> = {};
  for (const [name, url] of Object.entries(nodes)) {
    try {
      out[name] = await metricsText(url);
    } catch (error) {
      out[name] = '';
      writeFileSync(join(dir, `${name}.error.txt`), String(error));
    }
    writeFileSync(join(dir, `${name}.prom`), out[name]);
  }
  return out;
}

/** Each node's series ranked by how far they moved, whole as JSON and the top of it as text a person reads first. */
export function writeMetricsDiff(before: Record<string, string>, after: Record<string, string>, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(after)) {
    const diff = diffMetrics(parseMetrics(before[name] ?? ''), parseMetrics(after[name]));
    writeJson(join(dir, `${name}.json`), diff);
    const line = (row: MetricChange) =>
      `${String(row.change).padStart(16)}  ${(row.before === null ? 'new' : row.relative === Infinity ? 'from 0' : `${(row.relative * 100).toFixed(0)}%`).padStart(8)}  ${row.series}  (${row.before ?? 'absent'} -> ${row.after ?? 'absent'})`;
    const byRelative = [...diff].sort((a, b) => Math.abs(b.relative) - Math.abs(a.relative));
    writeFileSync(
      join(dir, `${name}.txt`),
      [
        `${diff.length} series moved.`,
        '',
        'The largest moves:',
        ...diff.slice(0, 40).map(line),
        '',
        'The largest moves against where each series started, the new ones first:',
        ...byRelative.slice(0, 40).map(line),
        '',
      ].join('\n'),
    );
  }
}

/** Each container's standard output and error apart, and its state and exit code. */
export function writeServiceLogs(env: Record<string, string>, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const service of services(env)) {
    const logs = docker(['logs', '--timestamps', service.Name], { allowFailure: true });
    writeFileSync(join(dir, `${service.Service}.stdout.log`), logs.stdout);
    writeFileSync(join(dir, `${service.Service}.stderr.log`), logs.stderr);
    writeJson(join(dir, `${service.Service}.state.json`), {
      container: service.Name,
      state: service.State,
      health: service.Health || null,
      exitCode: service.ExitCode,
    });
  }
}

/** The containers on this Docker daemon that are not the kit's, which shared every measurement of the run. */
export function coTenants(): string[] {
  const { stdout } = docker(['ps', '--format', '{{.Names}} {{.Image}} {{.Label "com.docker.compose.project"}}'], {
    allowFailure: true,
  });
  return stdout
    .split('\n')
    .filter((line) => line && !line.endsWith(` ${PROJECT}`))
    .map((line) => line.replace(/ $/, ''));
}

/**
 * One number from `docker info`, or null. A machine with no docker program at all, such as the browser image a live
 * run executes in, is answered the same way as a daemon that refuses.
 */
function dockerInfoNumber(format: string): number | null {
  try {
    return Number(docker(['info', '--format', format], { allowFailure: true }).stdout) || null;
  } catch {
    return null;
  }
}

/** What the machine was: the bounds a run sat under, which a reader needs to judge any timing in it. */
export function machine() {
  return {
    platform: `${platform()} ${release()}`,
    cpus: cpus().length,
    memoryBytes: totalmem(),
    dockerMemoryBytes: dockerInfoNumber('{{.MemTotal}}'),
    dockerCpus: dockerInfoNumber('{{.NCPU}}'),
    cgroupCpuCeiling: cpuCeiling(),
    node: process.version,
  };
}
