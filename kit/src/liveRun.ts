/**
 * Live mode: the scenarios that run as they are against a real deployment, group A of the live mode plan. A run reads
 * the viewer's public config, passes the live gate, and runs the scenario's steps with the browser guard letting
 * through only what the target and the config name. Nothing of the local stack is read or started, apart from the
 * hostile site, which is served from this machine.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { type EvilSite, serveEvilSite } from './evilSite.ts';
import { writeJson } from './evidence.ts';
import { liveGuard } from './guard.ts';
import { judgeLiveGate, namedAddresses, readLiveGate } from './liveGate.ts';
import { readLock } from './lock.ts';
import { LIVE_EVIDENCE_DIR, REPO_DIR } from './paths.ts';
import type { PreflightCheck } from './preflight.ts';
import { execute, loadScenario, newRunId, STOPPED_OUTSIDE_A_STEP } from './runner.ts';
import { type ScenarioResult, suiteStatus } from './scenario.ts';
import { commitOf } from './stack.ts';
import { LIVE_EVIL_ORIGIN, type LiveDeployment, liveDeployment, readTarget, type Target } from './target.ts';

/**
 * The scenarios that run live as they are: no wallet, no drive, nothing on the deployment beyond guest messages the
 * gateway pays for and Swarm ID accounts on its real site.
 */
export const LIVE_SCENARIOS = ['partitioned-storage', 'popup-blocked', 'eth-name-refused', 'evil-unlisted'] as const;

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

/** Runs one group A scenario against the deployment `target` names, with its evidence under the live folder. */
export async function runLiveScenario(name: string, target: Target, runId = newRunId()): Promise<ScenarioResult> {
  if (!(LIVE_SCENARIOS as readonly string[]).includes(name)) {
    console.error(`kit: ${name} does not run live, the live scenarios are ${LIVE_SCENARIOS.join(', ')}`);
    return { ok: false, failedAt: STOPPED_OUTSIDE_A_STEP };
  }
  const scenario = loadScenario(name);
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
  timings.gateMs = Date.now() - begin;
  writeJson(join(dir, 'preflight.json'), gate);
  if (gate.some((check) => !check.ok)) return refuse(gate);

  const needsEvil = scenario.steps.some((step) => step.verb === 'evil');
  let evil: EvilSite | null = null;
  const lock = readLock();
  return execute(scenario, runId, dir, {
    addresses: live.addresses,
    deployment: live.deployment,
    local: null,
    live,
    guard: liveGuard([...namedAddresses(live), LIVE_EVIL_ORIGIN]),
    header: {
      target: { name: target.name, viewer: target.viewer, stream: target.stream, alsoAllowed: target.alsoAllowed },
      config: read.config,
      addresses: live.addresses.all(),
      commits: { kit: commitOf(REPO_DIR) },
      libraries: lock.libraries,
      timings,
    },
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
