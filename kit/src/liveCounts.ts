/**
 * The chat server's counts on a real deployment. Its `/health` answers only on the deployment's own machine, so the
 * operator opens an SSH tunnel to it and names the tunnel's local end as `chatHealth` in the target. The scenarios
 * that read the counts refuse to start until that tunnel answers with them.
 */
import { healthStatus } from './bee.ts';
import type { PreflightCheck } from './preflight.ts';
import type { Step } from './scenario.ts';
import { countsOf } from './serverCounts.ts';

/** The `evil` actions that write to the inbox from the kit's process and read the server's counts around it. */
const COUNTED_EVIL_ACTIONS = new Set(['forge', 'replay']);

/** How the operator opens the tunnel and tells the kit of it. */
const OPEN_THE_TUNNEL =
  "open an SSH tunnel to the chat server's health port on the deployment's machine, such as `ssh -N -L 4997:127.0.0.1:<its health port> <the deployment's host>`, and name its local end in the target as chatHealth, such as http://127.0.0.1:4997";

/** Whether a scenario's steps read the chat server's counts. */
export function needsServerCounts(steps: readonly Step[]): boolean {
  return steps.some(
    (step) => step.verb === 'snapshot-drops' || (step.verb === 'evil' && COUNTED_EVIL_ACTIONS.has(step.args[0] ?? '')),
  );
}

export interface CountsGateReading {
  /** The target's chatHealth, null when it names none. */
  address: string | null;
  /** What `/health` answered through the tunnel, null for nothing. */
  status: number | null;
  /** Whether the answer carried the server's counts. */
  counts: boolean;
}

/** The one check the counts part of the live gate makes. */
export function judgeCountsGate(reading: CountsGateReading): PreflightCheck[] {
  const check = (ok: boolean, detail: string): PreflightCheck[] => [{ name: 'chat server counts', ok, detail }];
  const { address, status, counts } = reading;
  if (!address) {
    return check(
      false,
      `this scenario reads the chat server's counts from its /health, which answers only on the deployment's own machine: ${OPEN_THE_TUNNEL}`,
    );
  }
  if (status === null)
    return check(false, `${address}/health answered nothing, so the tunnel is not open: ${OPEN_THE_TUNNEL}`);
  if (!counts) return check(false, `${address}/health answered ${status} with no counts, so it is not the chat server`);
  if (status !== 200) return check(false, `${address}/health answered ${status}, so the chat server is not healthy`);
  return check(true, `read through ${address}`);
}

/** Reads the chat server's `/health` through the tunnel, for the gate. */
export async function readCountsGate(address: string | null): Promise<CountsGateReading> {
  if (!address) return { address, status: null, counts: false };
  const { status, body } = await healthStatus(address);
  return { address, status, counts: countsOf(body) !== null };
}
