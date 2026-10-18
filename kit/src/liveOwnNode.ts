/**
 * The viewer's own Bee node on a real deployment. A message on a person's own stamp goes out only through a Bee node of
 * their own or Weeb3 in the tab, so live mode reaches a Bee node of the deployment's through an SSH tunnel the operator
 * opens, and the target names the tunnel's local end for the actor it stands in for. The scenarios that read or send
 * through it refuse to start until that tunnel answers as Bee.
 */
import { healthStatus } from './bee.ts';
import type { PreflightCheck } from './preflight.ts';
import type { Scenario } from './scenario.ts';

/** How the operator opens the tunnel and tells the kit of it. */
const openTheTunnel = (actor: string) =>
  `open an SSH tunnel to a Bee node's API, such as \`ssh -N -L 4996:<the node's API address> <the node's host>\`, and name its local end in the target under ownNodes, such as "ownNodes": { "${actor}": "http://127.0.0.1:4996" }`;

/** The actors whose browser reads the chat from their own node from the start, or connects it in a step. */
export function ownNodeActorsOf(scenario: Pick<Scenario, 'actors' | 'steps'>): string[] {
  const fromStart = Object.entries(scenario.actors)
    .filter(([, settings]) => settings.chatSource === 'bee')
    .map(([actor]) => actor);
  const connected = scenario.steps
    .filter((step) => step.verb === 'connect-source' && step.args[0] === 'bee' && step.actor)
    .map((step) => step.actor!);
  return [...new Set([...fromStart, ...connected])];
}

export interface OwnNodeReading {
  actor: string;
  /** The target's own node for the actor, null when it names none. */
  address: string | null;
  /** What `/health` answered through the tunnel, null for nothing. */
  status: number | null;
  /** The Bee version the answer named, null when it named none. */
  version: string | null;
}

/** One check per actor the own-node part of the live gate makes. Any one not ok refuses the run. */
export function judgeOwnNodeGate(readings: readonly OwnNodeReading[]): PreflightCheck[] {
  return readings.map(({ actor, address, status, version }) => {
    const check = (ok: boolean, detail: string): PreflightCheck => ({ name: `own node ${actor}`, ok, detail });
    if (!address) {
      return check(
        false,
        `${actor} reads and sends through the viewer's own Bee node, and the target names none: ${openTheTunnel(actor)}`,
      );
    }
    if (status === null)
      return check(false, `${address}/health answered nothing, so the tunnel is not open: ${openTheTunnel(actor)}`);
    if (!version) return check(false, `${address}/health answered ${status}, not as Bee, so it is not a Bee node`);
    if (status !== 200) return check(false, `${address}/health answered ${status}, so the node is not healthy`);
    return check(true, `Bee ${version}, read through ${address}`);
  });
}

/** Reads each actor's own node's `/health` through its tunnel, for the gate. */
export async function readOwnNodeGate(
  actors: readonly string[],
  ownNodes: Record<string, string>,
): Promise<OwnNodeReading[]> {
  return Promise.all(
    actors.map(async (actor) => {
      const address = ownNodes[actor] ?? null;
      if (!address) return { actor, address, status: null, version: null };
      const { status, body } = await healthStatus(address);
      const version = (body as { version?: unknown } | null)?.version;
      return { actor, address, status, version: typeof version === 'string' ? version : null };
    }),
  );
}
