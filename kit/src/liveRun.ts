/**
 * Live mode: the scenarios that run against a real deployment, groups A and B of the live mode plan. A run reads
 * the viewer's public config, passes the live gate, and runs the scenario's steps with the browser guard letting
 * through only what the target and the config name. Nothing of the local stack is read or started, apart from the
 * hostile site, which is served from this machine.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type EvilSite, serveEvilSite } from './evilSite.ts';
import { writeJson } from './evidence.ts';
import { readSwarmIdFetches, swarmIdFetchFinding } from './gentleFetch.ts';
import { liveGuard } from './guard.ts';
import { judgeLiveGate, namedAddresses, readLiveGate } from './liveGate.ts';
import { judgeCountsGate, needsServerCounts, readCountsGate } from './liveCounts.ts';
import { ensActorsOf, evidenceLeaks, judgeEnsGate, readEnsGate, readEnsKey } from './liveEns.ts';
import {
  judgeStandingGate,
  readStandingAccount,
  standingAccounts,
  standingActorsOf,
  standingSecrets,
} from './liveAccounts.ts';
import { judgeOwnNodeGate, ownNodeActorsOf, readOwnNodeGate } from './liveOwnNode.ts';
import { readLock } from './lock.ts';
import { LIVE_EVIDENCE_DIR, REPO_DIR } from './paths.ts';
import type { PreflightCheck } from './preflight.ts';
import { type AfterBrowsers, execute, loadScenario, newRunId, STOPPED_OUTSIDE_A_STEP } from './runner.ts';
import { type Scenario, type ScenarioResult, suiteStatus } from './scenario.ts';
import { commitOf } from './stack.ts';
import { LIVE_EVIL_ORIGIN, type LiveDeployment, liveDeployment, readTarget, type Target } from './target.ts';

/**
 * The scenarios that run live. Group A needs no wallet and no drive, nothing on the deployment beyond guest messages
 * the gateway pays for and Swarm ID accounts on its real site. Group B signs besides with the wallet that owns the
 * target's ENS name, its key routed in through the environment, and spends nothing more. Group D's forging and replay
 * scenarios write raw to the chat's inbox through the deployment's chat write address, which its gateway stamps as it
 * stamps every guest message, and read the chat server's counts through the operator's tunnel. Group C signs an actor
 * in to a standing account with its drives and sends on its own stamp through the viewer's own Bee node, a node of the
 * deployment's the operator tunnels to.
 */
export const LIVE_SCENARIOS = [
  'partitioned-storage',
  'popup-blocked',
  'eth-name-refused',
  'evil-unlisted',
  'ens-both-ways',
  'ens-off-while-signed-in',
  'rpc-down',
  'rpc-lying',
  'forge-binding',
  'forge-message',
  'forge-wallet-link',
  'replay-message',
  'my-stamp-send',
  'own-feed-sync',
  'stamp-key-stays-in-frame',
  'drive-needs-consent',
  'two-people-chat',
  'device-feed-leak',
] as const;

const REFUSED_BY_GATE = 'the live gate';
/** How long the viewer's config may take to answer. */
const CONFIG_TIMEOUT_MS = 30_000;

/** The viewer's public config.json as it answered, or why it could not be read. */
async function readConfig(viewer: string): Promise<{ status: number | null; config: unknown; problem: string | null }> {
  try {
    const response = await fetch(`${viewer}/config.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok)
      return { status: response.status, config: null, problem: `config.json answered ${response.status}` };
    try {
      return { status: response.status, config: JSON.parse(text), problem: null };
    } catch {
      return { status: response.status, config: null, problem: 'config.json is not JSON' };
    }
  } catch (error) {
    return { status: null, config: null, problem: `config.json could not be read: ${String(error)}` };
  }
}

/** The run's own evidence files written before the browsers closed, by name, for the key search. */
function evidenceFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of ['header.json', 'preflight.json']) {
    const path = join(dir, name);
    if (existsSync(path)) files[name] = readFileSync(path, 'utf8');
  }
  return files;
}

/** Runs one live scenario against the deployment `target` names, with its evidence under the live folder. */
export async function runLiveScenario(name: string, target: Target, runId = newRunId()): Promise<ScenarioResult> {
  if (!(LIVE_SCENARIOS as readonly string[]).includes(name)) {
    console.error(`kit: ${name} does not run live, the live scenarios are ${LIVE_SCENARIOS.join(', ')}`);
    return { ok: false, failedAt: STOPPED_OUTSIDE_A_STEP };
  }
  return runLive(loadScenario(name), target, runId);
}

/** Runs `scenario` live against the deployment `target` names, whether or not it is one of the live scenarios. */
export async function runLive(scenario: Scenario, target: Target, runId = newRunId()): Promise<ScenarioResult> {
  const dir = join(LIVE_EVIDENCE_DIR, runId, scenario.name);
  mkdirSync(dir, { recursive: true });
  const timings: Record<string, number> = {};
  const refuse = (gate: PreflightCheck[]): ScenarioResult => {
    writeJson(join(dir, 'preflight.json'), gate);
    writeJson(join(dir, 'verdict.json'), {
      scenario: scenario.name,
      mode: 'live',
      ok: false,
      refusedBy: REFUSED_BY_GATE,
      gate,
    });
    for (const check of gate.filter((one) => !one.ok)) console.error(`kit: ${check.name}: ${check.detail}`);
    console.error(`kit: the live gate refused ${scenario.name}, see ${join(dir, 'preflight.json')}`);
    return { ok: false, failedAt: REFUSED_BY_GATE, ...(scenario.known ? { known: scenario.known } : {}) };
  };

  let begin = Date.now();
  const read = await readConfig(target.viewer);
  timings.configMs = Date.now() - begin;
  writeJson(join(dir, 'config.json'), read.config);
  let live: LiveDeployment;
  try {
    if (read.problem) throw new Error(read.problem);
    live = liveDeployment(target, read.config);
  } catch (error) {
    return refuse([
      { name: 'viewer', ok: read.status !== null, detail: `answered ${read.status ?? 'nothing'}` },
      { name: 'config', ok: false, detail: error instanceof Error ? error.message : String(error) },
    ]);
  }

  begin = Date.now();
  const gate = judgeLiveGate(await readLiveGate(live));
  const ensActors = ensActorsOf(scenario);
  const ensKey = ensActors.length ? readEnsKey(process.env) : null;
  if (ensKey) gate.push(...judgeEnsGate(await readEnsGate(live.ensRpc, ensKey, target.ens, ensActors)));
  const standingReadings = Object.fromEntries(
    standingActorsOf(scenario).map((actor) => [actor, readStandingAccount(process.env, actor)]),
  );
  gate.push(...judgeStandingGate(standingReadings, target.standing));
  if (needsServerCounts(scenario.steps)) gate.push(...judgeCountsGate(await readCountsGate(live.chatHealth)));
  const ownNodeActors = ownNodeActorsOf(scenario);
  if (ownNodeActors.length) gate.push(...judgeOwnNodeGate(await readOwnNodeGate(ownNodeActors, live.ownNodes)));
  timings.gateMs = Date.now() - begin;
  writeJson(join(dir, 'preflight.json'), gate);
  if (gate.some((check) => !check.ok)) return refuse(gate);

  const needsEvil = scenario.steps.some((step) => step.verb === 'evil' && !needsServerCounts([step]));
  const ensWallet = ensKey?.state === 'read' ? ensKey.wallet : null;
  const standing = standingAccounts(standingReadings, target.standing);
  const secrets = {
    ...(ensWallet ? { 'the ENS wallet key': ensWallet.key } : {}),
    ...standingSecrets(standing),
  };
  /**
   * The ENS wallet's key and a standing account's phrase and password are the live secrets the kit holds, so the run
   * fails when any of its evidence holds one. What
   * the Swarm ID site's answers cost is recorded on every run, from the actors' own counts, since the page and the
   * recorded network see only the answer the last attempt got.
   */
  const afterBrowsers = (actorDirs: string[], passed: boolean, texts: Record<string, string>): AfterBrowsers => {
    const finding = swarmIdFetchFinding(passed, readSwarmIdFetches(actorDirs));
    const searched = Object.keys(secrets);
    const leaks = searched.length ? evidenceLeaks(actorDirs, secrets, { ...texts, ...evidenceFiles(dir) }) : [];
    return {
      findings: {
        ...(finding ? { 'swarm id server errors': finding } : {}),
        ...(searched.length
          ? {
              'live secrets searched for': searched,
              'live secrets searched in': [
                'every actor’s network, console and traces',
                'the verdict',
                'header.json',
                'preflight.json',
              ],
            }
          : {}),
      },
      problems: leaks.length ? [`the evidence holds ${leaks.join(', ')}`] : [],
    };
  };
  let evil: EvilSite | null = null;
  const lock = readLock();
  return execute(scenario, runId, dir, {
    addresses: live.addresses,
    deployment: live.deployment,
    local: null,
    live,
    guard: liveGuard([...namedAddresses(live), LIVE_EVIL_ORIGIN]),
    wallet: ensWallet ? { swarmId: live.swarmId, rpc: live.ensRpc } : null,
    ensWallet,
    standing,
    header: {
      target: {
        name: target.name,
        viewer: target.viewer,
        stream: target.stream,
        alsoAllowed: target.alsoAllowed,
        ...(target.ens ? { ens: target.ens } : {}),
        ...(target.chatHealth ? { chatHealth: target.chatHealth } : {}),
        ...(Object.keys(target.ownNodes).length ? { ownNodes: target.ownNodes } : {}),
        ...(target.standing.length ? { standing: target.standing } : {}),
      },
      config: read.config,
      addresses: live.addresses.all(),
      commits: { kit: commitOf(REPO_DIR) },
      libraries: lock.libraries,
      timings,
    },
    afterBrowsers,
    async before() {
      if (!needsEvil) return;
      begin = Date.now();
      evil = await serveEvilSite(LIVE_EVIL_ORIGIN);
      timings.evilSiteMs = Date.now() - begin;
    },
    async after() {
      await (evil as EvilSite | null)?.close();
    },
  });
}

/** Every live scenario against `target`, one after another under one run id, and the suite's exit. */
export async function liveTest(target: Target): Promise<number> {
  const runId = newRunId();
  const results: ScenarioResult[] = [];
  for (const name of LIVE_SCENARIOS) {
    results.push(
      await runLiveScenario(name, target, runId).catch((error: unknown): ScenarioResult => {
        console.error(`kit: ${name} could not run: ${String(error)}`);
        return { ok: false, failedAt: STOPPED_OUTSIDE_A_STEP };
      }),
    );
  }
  console.log(`kit: live evidence in ${join(LIVE_EVIDENCE_DIR, runId)}`);
  return suiteStatus(results);
}

/** Reads the target file a live command names with `--target`. */
export function targetFrom(args: string[]): Target {
  const at = args.indexOf('--target');
  const file = at >= 0 ? args[at + 1] : undefined;
  if (!file) throw new Error('live mode needs --target <file>, the file that names the deployment');
  return readTarget(file);
}
