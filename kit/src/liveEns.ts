/**
 * Live mode's ENS scenarios: the wallet that owns a real ENS name, whose key reaches the kit only through the
 * environment, the gate that checks that wallet and its name before a run, the name the checks expect, and the two
 * readings of a finished run's evidence that matter on a real deployment: the key nowhere in it, and how many of Swarm
 * ID's own files its site answered with a server error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createPublicClient, type Hex, http } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

import { bakedName, ENS_ACTORS, type EnsActor } from './ens.ts';
import { findLeaks } from './leaks.ts';
import type { PreflightCheck } from './preflight.ts';
import type { Scenario } from './scenario.ts';
import type { Target } from './target.ts';
import { traceTexts } from './traces.ts';
import { testWallet, type TestWallet } from './wallet.ts';

/** The environment variable the operator routes the ENS wallet's key in by, never a file and never an argument. */
export const ENS_KEY_VARIABLE = 'KIT_ENS_KEY';
/** How a run gets the key: in its environment from the operator's secret store, never typed or written to a file. */
const RUN_WITH_KEY = `pnpm kit live run <scenario> --target <file> with ${ENS_KEY_VARIABLE} in its environment, routed in by the operator's secret store so the key is never typed or written to a file`;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
/** How long one ENS lookup of the gate may take. */
const LOOKUP_TIMEOUT_MS = 30_000;

export type EnsKeyReading = { state: 'missing' } | { state: 'malformed' } | { state: 'read'; wallet: TestWallet };

/** The ENS wallet's key from `env`, or whether it is missing or not a key. The value is never part of an answer. */
export function readEnsKey(env: Record<string, string | undefined>): EnsKeyReading {
  const value = env[ENS_KEY_VARIABLE];
  if (!value) return { state: 'missing' };
  if (!PRIVATE_KEY.test(value)) return { state: 'malformed' };
  return { state: 'read', wallet: testWallet(value as Hex) };
}

/** The actors whose account a scenario makes with the wallet that owns an ENS name. */
export function ensActorsOf(scenario: Pick<Scenario, 'steps'>): string[] {
  const actors = scenario.steps
    .filter((step) => step.verb === 'create-account' && step.options['ens-name'] === 'true' && step.actor)
    .map((step) => step.actor!);
  return [...new Set(actors)];
}

type EnsTarget = NonNullable<Target['ens']>;

export interface EnsGateReadings {
  key: { state: 'missing' } | { state: 'malformed' } | { state: 'read'; address: string };
  expected: EnsTarget | undefined;
  /** The actors the scenario gives the ENS wallet. */
  actors: string[];
  /** Where the target's name resolves on the config's ENS endpoint, null for nowhere. */
  forward: { address: string | null; problem: string | null };
  /** The primary name of the target's address on that endpoint, null for none. */
  reverse: { name: string | null; problem: string | null };
}

const sameAddress = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

/** Every check the ENS part of the live gate makes. Any one that is not ok refuses the run. */
export function judgeEnsGate(readings: EnsGateReadings): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const { key, expected, actors, forward, reverse } = readings;
  add(
    'ens key',
    key.state === 'read',
    key.state === 'missing'
      ? `${ENS_KEY_VARIABLE} is not set, and this scenario signs with the wallet that owns the target's ENS name. Run ${RUN_WITH_KEY}`
      : key.state === 'malformed'
        ? `${ENS_KEY_VARIABLE} is not a 0x-prefixed 32-byte hex key`
        : `read from ${ENS_KEY_VARIABLE}`,
  );
  const target = expected && actors.includes(expected.actor);
  add(
    'ens target',
    Boolean(target),
    !expected
      ? 'the target file has no ens field naming the actor, the wallet address and the name'
      : target
        ? `${expected.actor} signs as ${expected.address}, named ${expected.name}`
        : `the target names ${expected.actor}, and the scenario gives the ENS wallet to ${actors.join(', ') || 'nobody'}`,
  );
  if (!expected) return checks;
  if (key.state === 'read') {
    add(
      'ens wallet',
      sameAddress(key.address, expected.address),
      sameAddress(key.address, expected.address)
        ? `the key's wallet is ${expected.address}`
        : `the key's wallet is ${key.address}, and the target names ${expected.address}`,
    );
  }
  add(
    'ens forward',
    sameAddress(forward.address, expected.address),
    forward.problem ?? `${expected.name} resolves to ${forward.address ?? 'no address'}`,
  );
  add(
    'ens reverse',
    reverse.name === expected.name,
    reverse.problem ?? `${expected.address} has the primary name ${reverse.name ?? 'none'}`,
  );
  return checks;
}

/** Reads the target's name both ways on the ENS endpoint the viewer's config names, as the viewer would. */
export async function readEnsGate(
  ensRpc: string,
  key: EnsKeyReading,
  expected: EnsTarget | undefined,
  actors: string[],
): Promise<EnsGateReadings> {
  const readings: EnsGateReadings = {
    key: key.state === 'read' ? { state: 'read', address: key.wallet.address } : key,
    expected,
    actors,
    forward: { address: null, problem: 'not looked up, the target names no ENS name' },
    reverse: { name: null, problem: 'not looked up, the target names no ENS name' },
  };
  if (!expected) return readings;
  const client = createPublicClient({ chain: mainnet, transport: http(ensRpc, { timeout: LOOKUP_TIMEOUT_MS }) });
  const [forward, reverse] = await Promise.allSettled([
    client.getEnsAddress({ name: normalize(expected.name) }),
    client.getEnsName({ address: expected.address as Hex }),
  ]);
  readings.forward =
    forward.status === 'fulfilled'
      ? { address: forward.value ?? null, problem: null }
      : { address: null, problem: `the forward lookup failed: ${String(forward.reason).split('\n')[0]}` };
  readings.reverse =
    reverse.status === 'fulfilled'
      ? { name: reverse.value ?? null, problem: null }
      : { name: null, problem: `the reverse lookup failed: ${String(reverse.reason).split('\n')[0]}` };
  return readings;
}

/** The ENS name a check expects for `actor`: the baked one locally, the one the target names live. */
export function ensNameFor(run: { live: { target: Pick<Target, 'ens'> } | null }, actor: string): string {
  if (run.live) {
    const ens = run.live.target.ens;
    if (!ens) throw new Error('the target file has no ens field, so live mode knows no ENS name');
    if (ens.actor !== actor) throw new Error(`the target names an ENS name for ${ens.actor}, not ${actor}`);
    return ens.name;
  }
  if (!ENS_ACTORS.includes(actor as EnsActor)) {
    throw new Error(`the ENS snapshot names wallets for ${ENS_ACTORS.join(' and ')} only, not ${actor}`);
  }
  return bakedName(actor as EnsActor);
}

interface HarLog {
  log?: { entries?: { request?: { url?: string }; response?: { status?: number } }[] };
}

/** How many answers a recorded network holds from `origin` with a server error, 500 and up. */
export function serverErrorsAt(har: string, origin: string): number {
  const entries = (JSON.parse(har) as HarLog).log?.entries ?? [];
  return entries.filter((entry) => {
    const status = entry.response?.status ?? 0;
    if (status < 500) return false;
    try {
      return new URL(entry.request?.url ?? '').origin === origin;
    } catch {
      return false;
    }
  }).length;
}

/**
 * The finding a live run records when Swarm ID's site answered its own files with a server error, so a failed run
 * classifies itself. bzz.link answers such errors under parallel load, a known limit of the deployment's address for
 * Swarm ID. A passed run gets the count alone.
 */
export function swarmIdServerErrorFinding(
  passed: boolean,
  byActor: Record<string, number>,
): { count: number; byActor: Record<string, number>; cause?: string } | null {
  const count = Object.values(byActor).reduce((sum, n) => sum + n, 0);
  if (count === 0) return null;
  return {
    count,
    byActor,
    ...(passed
      ? {}
      : {
          cause:
            "Swarm ID's site answered its own files with 500 and up, which bzz.link does under parallel load, so the failure may be the deployment's address for Swarm ID and not the release",
        }),
  };
}

/**
 * Where any of `secrets` appears in the actors' recorded network, console and traces, and in the run's own `texts`,
 * as `<secret name> in <place>`. Never the secret itself.
 */
export function evidenceLeaks(
  actorDirs: string[],
  secrets: Record<string, string>,
  texts: Record<string, string>,
): string[] {
  const recorded: Record<string, string> = { ...texts };
  for (const dir of actorDirs) {
    const actor = basename(dir);
    for (const file of ['network.har', 'console.log']) {
      const path = join(dir, file);
      if (existsSync(path)) recorded[join(actor, file)] = readFileSync(path, 'utf8');
    }
    if (existsSync(dir)) {
      for (const [trace, text] of Object.entries(traceTexts(dir))) recorded[join(actor, trace)] = text;
    }
  }
  return findLeaks(recorded, secrets);
}
