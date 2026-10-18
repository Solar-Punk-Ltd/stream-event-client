import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRequire } from 'node:module';

import installBrowser from '../../e2e/installBrowser.ts';
import { type Actor, startActor, type WalletSetup } from './actors.ts';
import { addressesFor } from './addresses.ts';
import { healthStatus, json } from './bee.ts';
import { launchForProfile } from './browser.ts';
import { type Deployment, type LocalStack, localDeployment, type SiteAddresses } from './deployment.ts';
import { coTenants, machine, snapshotMetrics, writeJson, writeMetricsDiff, writeServiceLogs } from './evidence.ts';
import { type Guard, LOCAL_GUARD } from './guard.ts';
import { readLock } from './lock.ts';
import { OutsideRequests } from './outside.ts';
import { EVIDENCE_DIR, REPO_DIR, SCENARIO_DIR } from './paths.ts';
import { judgePreflight } from './preflight.ts';
import { reachStack } from './reach.ts';
import { EXPECT, parseScenario, type Scenario, type ScenarioResult, suiteStatus, unknownVerbs } from './scenario.ts';
import { commitOf, down, readings, up } from './stack.ts';
import { composeEnv, readState } from './state.ts';
import type { AfterClose, Run } from './run.ts';
import type { LiveDeployment } from './target.ts';
import { CHECKS, VERBS } from './verbs.ts';
import type { TestWallet } from './wallet.ts';

interface StepResult {
  line: string;
  ok: boolean;
  ms: number;
  error?: string;
  screenshot?: string;
}

export function loadScenario(name: string): Scenario {
  const file = join(SCENARIO_DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`no scenario ${name} in ${SCENARIO_DIR}`);
  const scenario = parseScenario(JSON.parse(readFileSync(file, 'utf8')));
  const unknown = unknownVerbs(scenario, new Set(VERBS.keys()), new Set(CHECKS.keys()));
  if (unknown.length) throw new Error(`steps the kit has no verb for: ${unknown.join(' | ')}`);
  return scenario;
}

const playwrightVersion = () =>
  (createRequire(import.meta.url)('@playwright/test/package.json') as { version: string }).version;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
/** How much of the run id a scenario's texts carry, enough that two runs on one stack never share one. */
const RUN_TAG_LENGTH = 8;
export const newRunId = () => `${stamp()}-${randomBytes(4).toString('hex')}`;

/** Why a run that stopped outside every step failed, as its `failedAt`. */
export const STOPPED_OUTSIDE_A_STEP = 'the run stopped outside a step';
const REFUSED_BY_PREFLIGHT = 'the preflight';
/** Where a request stopped after the last step's look, up to the browsers closing, is judged. */
const AFTER_THE_LAST_STEP = 'after the last step, until the browsers closed';

/**
 * What a mode hands the shared run of a scenario: where it is pointed, what the browser guard lets through, the header's
 * fields of its own, and what it records around the steps.
 */
export interface ModeSetup {
  addresses: SiteAddresses;
  deployment: Deployment;
  local: LocalStack | null;
  live: LiveDeployment | null;
  guard: Guard;
  /** Where the kit's wallet is offered to Swarm ID's pages, null for no wallet at all. */
  wallet: WalletSetup | null;
  /** The wallet that owns the target's ENS name, live only. */
  ensWallet: TestWallet | null;
  header: Record<string, unknown>;
  /**
   * Reads the finished run's evidence once the browsers closed: findings to add to the verdict, and problems that fail
   * the run. `texts` is what the verdict will hold, so a reading can search it too.
   */
  afterBrowsers?(actorDirs: string[], passed: boolean, texts: Record<string, string>): AfterBrowsers;
  /** Taken before the browser starts. */
  before(): Promise<void>;
  /** Taken once the browsers closed and every check after them ran. */
  after(): Promise<void>;
}

export interface AfterBrowsers {
  findings: Record<string, unknown>;
  problems: string[];
}

/** Where a problem the finished run's evidence shows is judged. */
const IN_THE_EVIDENCE = 'the evidence, once the browsers closed';

/** Runs one scenario against the stack that is up, writes its whole evidence, and says how it ended. */
export async function runScenario(name: string, runId = newRunId()): Promise<ScenarioResult> {
  const scenario = loadScenario(name);
  const state = readState();
  if (!state) {
    console.error('kit: no stack is up, run `pnpm kit up` first');
    return { ok: false, failedAt: STOPPED_OUTSIDE_A_STEP };
  }
  const lock = readLock();
  const addresses = addressesFor(state.addressing);
  const env = composeEnv(lock, addresses.all(), state);
  await reachStack();
  const dir = join(EVIDENCE_DIR, runId, scenario.name);
  mkdirSync(dir, { recursive: true });

  const gate = judgePreflight(await readings(addresses, state));
  writeJson(join(dir, 'preflight.json'), gate);
  if (gate.some((check) => !check.ok)) {
    writeJson(join(dir, 'verdict.json'), { scenario: scenario.name, ok: false, refusedBy: 'preflight', gate });
    console.error(`kit: the preflight refused ${scenario.name}, see ${join(dir, 'preflight.json')}`);
    return { ok: false, failedAt: REFUSED_BY_PREFLIGHT, ...(scenario.known ? { known: scenario.known } : {}) };
  }

  const nodes = { queen: addresses.queen, 'worker-1': addresses.worker1, 'worker-2': addresses.worker2 };
  let metricsBefore: Record<string, string> = {};
  const local = { addresses, state };
  return execute(scenario, runId, dir, {
    addresses,
    deployment: localDeployment(local),
    local,
    live: null,
    guard: LOCAL_GUARD,
    wallet: { swarmId: addresses.swarmId, rpc: addresses.ethereum },
    ensWallet: null,
    header: {
      commits: { viewer: commitOf(REPO_DIR), swarmId: lock.swarmId.commit, chatServer: lock.chatServer.commit },
      lock,
      bee: (await json<{ version: string }>(`${addresses.queen}/health`).catch(() => ({ version: 'unknown' }))).version,
      addressing: { scheme: state.addressing, addresses: addresses.all(), probe: state.probe },
    },
    async before() {
      metricsBefore = await snapshotMetrics(nodes, join(dir, 'metrics', 'before'));
      writeJson(join(dir, 'server-health-before.json'), await healthStatus(addresses.chatServer));
    },
    async after() {
      const metricsAfter = await snapshotMetrics(nodes, join(dir, 'metrics', 'after')).catch(() => null);
      if (metricsAfter) writeMetricsDiff(metricsBefore, metricsAfter, join(dir, 'metrics', 'diff'));
      writeJson(
        join(dir, 'server-health-after.json'),
        await healthStatus(addresses.chatServer).catch((error: unknown) => ({ error: String(error) })),
      );
      try {
        writeServiceLogs(env, join(dir, 'services'));
      } catch (error) {
        console.error(`kit: the service logs could not be written: ${String(error)}`);
      }
    },
  });
}

/** Runs a scenario's steps in a browser set up as `mode` says, writes its evidence into `dir`, and says how it ended. */
export async function execute(
  scenario: Scenario,
  runId: string,
  dir: string,
  mode: ModeSetup,
): Promise<ScenarioResult> {
  const started = new Date();
  await mode.before();

  const results: StepResult[] = [];
  let failed = false;
  let failedAt: string | undefined;
  /** Why the run stopped outside any step, when something the steps do not catch threw. */
  let crashed: string | undefined;
  const findings: Record<string, unknown> = {};
  const afterClose: AfterClose[] = [];
  let outside: OutsideRequests | undefined;
  /**
   * Records what the browser guard stopped since the last look, and throws on a request to a host the run does not
   * name that the release is not known to make.
   */
  const judgeOutside = (when: string) => {
    const { known, unknown } = outside?.since() ?? { known: [], unknown: [] };
    const recorded = (findings['outside requests stopped'] as unknown[] | undefined) ?? [];
    findings['outside requests stopped'] = [...recorded, ...known.map((request) => ({ step: when, ...request }))];
    if (unknown.length) throw new Error(`requests to hosts the run does not name, stopped: ${unknown.join(', ')}`);
  };
  let browser: Awaited<ReturnType<typeof launchForProfile>>['browser'] | undefined;
  const actors = new Map<string, Actor>();
  try {
    installBrowser();
    const launched = await launchForProfile(scenario.profile, mode.guard);
    browser = launched.browser;
    const header = {
      runId,
      mode: mode.live ? 'live' : 'local',
      scenario: scenario.name,
      description: scenario.description,
      started: started.toISOString(),
      ...mode.header,
      browser: { name: 'chromium', version: browser.version(), playwright: playwrightVersion(), args: launched.args },
      machine: machine(),
      coTenants: coTenants(),
    };
    writeJson(join(dir, 'header.json'), header);

    const environment = {
      viewer: mode.addresses.viewer,
      guard: mode.guard,
      local: mode.local?.addresses ?? null,
      wallet: mode.wallet,
      swarmIdFetchedByKit: mode.live?.swarmId ?? null,
    };
    for (const [actorName, settings] of Object.entries(scenario.actors)) {
      actors.set(
        actorName,
        await startActor(browser, actorName, settings, environment, join(dir, 'actors', actorName)),
      );
    }
    const run: Run = {
      id: runId.slice(-RUN_TAG_LENGTH),
      addresses: mode.addresses,
      deployment: mode.deployment,
      local: mode.local,
      live: mode.live,
      ensWallet: mode.ensWallet,
      actor: (actorName) => {
        const actor = actors.get(actorName);
        if (!actor) throw new Error(`no actor ${actorName}`);
        return actor;
      },
      actors: [...actors.values()],
      sent: [],
      secrets: new Map(),
      guardControls: new Set(),
      findings,
      afterClose,
    };
    outside = new OutsideRequests(run.actors, run.guardControls);
    for (const [index, step] of scenario.steps.entries()) {
      if (failed) {
        results.push({ line: step.line, ok: false, ms: 0, error: 'not run, an earlier step failed' });
        continue;
      }
      const begin = Date.now();
      console.log(`kit: ${step.line}`);
      const result: StepResult = { line: step.line, ok: true, ms: 0 };
      for (const actor of run.actors) actor.segments.clear();
      try {
        const verb = step.verb === EXPECT ? CHECKS.get(step.args[0]) : VERBS.get(step.verb);
        await verb!(run, step);
        judgeOutside(step.line);
      } catch (error) {
        failed = true;
        failedAt = step.line;
        result.ok = false;
        result.error = error instanceof Error ? error.message : String(error);
        console.error(`kit:   failed: ${result.error}`);
      }
      result.ms = Date.now() - begin;
      const owner = step.actor ? run.actor(step.actor) : run.actors[0];
      const shot = [owner?.viewer, owner?.idPage].find((candidate) => candidate && !candidate.isClosed());
      if (run.actors.some((actor) => actor.segments.failedInside)) {
        result.screenshot = 'none, the step failed while a secret could be on screen';
      } else if (shot && owner) {
        const file = `${String(index + 1).padStart(2, '0')}-${step.verb === EXPECT ? step.args[0] : step.verb}.png`;
        await shot.screenshot({ path: join(owner.dir, 'steps', file), fullPage: true }).catch(() => undefined);
        result.screenshot = join('actors', owner.name, 'steps', file);
      }
      results.push(result);
    }
  } catch (error) {
    failed = true;
    failedAt ??= STOPPED_OUTSIDE_A_STEP;
    crashed = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`kit: ${scenario.name} stopped: ${crashed}`);
  } finally {
    for (const actor of actors.values()) await actor.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  try {
    judgeOutside(AFTER_THE_LAST_STEP);
  } catch (error) {
    failed = true;
    failedAt ??= AFTER_THE_LAST_STEP;
    results.push({
      line: AFTER_THE_LAST_STEP,
      ok: false,
      ms: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  for (const { step, check } of crashed ? [] : afterClose) {
    try {
      await check();
    } catch (error) {
      failed = true;
      failedAt ??= step;
      results.push({
        line: `${step}, after the browsers closed`,
        ok: false,
        ms: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (mode.afterBrowsers) {
    const actorsDir = join(dir, 'actors');
    const actorDirs = existsSync(actorsDir) ? readdirSync(actorsDir).map((name) => join(actorsDir, name)) : [];
    const texts = { 'the verdict': JSON.stringify({ results, findings, crashed }) };
    try {
      const read = mode.afterBrowsers(actorDirs, !failed, texts);
      Object.assign(findings, read.findings);
      if (read.problems.length) {
        failed = true;
        failedAt ??= IN_THE_EVIDENCE;
        results.push({ line: IN_THE_EVIDENCE, ok: false, ms: 0, error: read.problems.join('; ') });
      }
    } catch (error) {
      failed = true;
      failedAt ??= IN_THE_EVIDENCE;
      results.push({ line: IN_THE_EVIDENCE, ok: false, ms: 0, error: `could not be read: ${String(error)}` });
    }
  }

  await mode.after().catch((error: unknown) => console.error(`kit: recording after the run failed: ${String(error)}`));

  const finished = new Date();
  const verdict = {
    scenario: scenario.name,
    mode: mode.live ? 'live' : 'local',
    ok: !failed,
    runId,
    started: started.toISOString(),
    finished: finished.toISOString(),
    seconds: (finished.getTime() - started.getTime()) / 1000,
    steps: results,
    ...(scenario.known ? { known: scenario.known } : {}),
    ...(scenario.accepted ? { accepted: scenario.accepted } : {}),
    ...(failedAt ? { failedAt } : {}),
    ...(crashed ? { crashed } : {}),
    findings,
  };
  writeJson(join(dir, 'verdict.json'), verdict);
  const result: ScenarioResult = {
    ok: verdict.ok,
    ...(scenario.known ? { known: scenario.known } : {}),
    ...(failedAt ? { failedAt } : {}),
  };
  const outcome = !scenario.known
    ? verdict.ok
      ? scenario.accepted
        ? `passed, with an accepted limit: ${scenario.accepted.limit}`
        : 'passed'
      : 'FAILED'
    : suiteStatus([result]) === 0
      ? 'known red at its pinned step, as expected'
      : verdict.ok
        ? 'PASSED though known red'
        : `FAILED at "${failedAt}", not at its pinned step "${scenario.known.failsAt}"`;
  console.log(`kit: ${scenario.name} ${outcome} in ${verdict.seconds.toFixed(1)} s, evidence in ${dir}`);
  return result;
}

/** Every scenario the kit holds, by name. */
function scenarioNames(): string[] {
  return readdirSync(SCENARIO_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

/** The whole kit in one command, for one CI job: a fresh stack, every scenario, then down. */
export async function test(): Promise<number> {
  try {
    const upStatus = await up({ fresh: true });
    if (upStatus !== 0) return upStatus;
    const runId = newRunId();
    const results: ScenarioResult[] = [];
    for (const name of scenarioNames()) {
      const { known } = loadScenario(name);
      results.push(
        await runScenario(name, runId).catch((error: unknown): ScenarioResult => {
          console.error(`kit: ${name} could not run: ${String(error)}`);
          return { ok: false, failedAt: STOPPED_OUTSIDE_A_STEP, ...(known ? { known } : {}) };
        }),
      );
    }
    return suiteStatus(results);
  } finally {
    await down({ fresh: true });
  }
}
