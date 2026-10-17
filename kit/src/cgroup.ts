import { readFileSync } from 'node:fs';

/** Where a container's cpu ceiling is written, as `<quota> <period>` in microseconds or `max <period>`. */
const CPU_MAX = '/sys/fs/cgroup/cpu.max';

/** The cpus a `cpu.max` line allows, or null when it sets no ceiling or cannot be read. */
export function parseCpuMax(text: string): number | null {
  const [quota, period] = text.trim().split(/\s+/);
  const allowed = Number(quota) / Number(period);
  return Number.isFinite(allowed) && allowed > 0 ? allowed : null;
}

/** This process's cpu ceiling, null on a machine with none, such as a laptop outside a container. */
export function cpuCeiling(): number | null {
  try {
    return parseCpuMax(readFileSync(CPU_MAX, 'utf8'));
  } catch {
    return null;
  }
}
