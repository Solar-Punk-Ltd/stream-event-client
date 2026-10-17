import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { Bee, Identifier, PrivateKey } from '@ethersphere/bee-js';
import { resolveVerifiedEnsName } from '@solarpunkltd/swarm-id';

import installBrowser from '../../e2e/installBrowser.ts';
import { publishFinishedStream } from '../../e2e/record/publish.ts';
import { type Addresses, Addressing, addressesFor } from './addresses.ts';
import {
  buyStamp,
  chainId,
  healthStatus,
  heartbeatBack,
  overlayOf,
  peerIdOf,
  readBee,
  readStamp,
  waitFor,
} from './bee.ts';
import { compose, docker, PROJECT, services } from './docker.ts';
import { readSnapshot } from './ens.ts';
import { prepareLibraries } from './libraries.ts';
import { type KitLock, readLock } from './lock.ts';
import { daemonCheck, judgePreflight, type PreflightCheck, type PreflightReadings } from './preflight.ts';
import { launchPartitioned } from './browser.ts';
import { probe } from './probe.ts';
import { busyPorts, leaveStack, reachStack } from './reach.ts';
import { composeEnv, forgetState, type KitState, readState, writeState } from './state.ts';

/** The depth of every batch the kit buys for its own services, as the event's own are. */
const SERVICE_STAMP_DEPTH = 20;
/** The inbox's identifier, which with the mined key makes the one address every chat message is written to. */
const GSOC_IDENTIFIER = 'flow-kit-chat';
/** How close the inbox address lands to the queen, the chat server's own `pnpm mine` default. */
const GSOC_PROXIMITY = 12;
const STREAM = { streamTopic: 'flow-kit-stream', catalogTopic: 'flow-kit-catalog', title: 'Flow kit test pattern' };
/** Each node of the three-node cluster is connected to the other two before anything is written. */
const MIN_PEERS = 2;

function readBees(addresses: Addresses) {
  return Promise.all([
    readBee('queen', addresses.queen),
    readBee('worker-1', addresses.worker1),
    readBee('worker-2', addresses.worker2),
  ]);
}

/** bee-compose's containers have fixed names, so another project holding them means another cluster is running. */
const BEE_COMPOSE_CONTAINERS = [
  'bee-compose-queen',
  'bee-compose-blockchain',
  'bee-compose-worker-1',
  'bee-compose-worker-2',
];
const APP_SERVICES = ['ethereum', 'swarm-id', 'swarm-id-strict', 'signaling', 'chat-server', 'gateway', 'evil'];

function since(start: number): number {
  return Date.now() - start;
}

function log(line: string): void {
  console.log(`kit: ${line}`);
}

/** The daemon the kit talks to: `DOCKER_HOST` when set, as the CLI reads it first, else the current context's. */
function dockerHost(): string {
  if (process.env.DOCKER_HOST !== undefined) return process.env.DOCKER_HOST;
  return docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { allowFailure: true }).stdout;
}

/**
 * Whether the Docker daemon is on this machine, printed as the gate prints it, which `kit libraries` and `kit bake-ens`
 * ask before they build or run a container. `kit up` asks the same through its whole gate.
 */
export function daemonIsLocal(): boolean {
  return report([daemonCheck(dockerHost())]);
}

function dockerMemory(): number {
  return Number(docker(['info', '--format', '{{.MemTotal}}']).stdout) || 0;
}

/** bee-compose containers that exist under a project other than the kit's, which `kit up` would collide with. */
function foreignClusters(): string[] {
  return BEE_COMPOSE_CONTAINERS.filter((name) => {
    const found = docker(
      ['container', 'inspect', '-f', '{{index .Config.Labels "com.docker.compose.project"}}', name],
      {
        allowFailure: true,
      },
    );
    return found.status === 0 && found.stdout !== PROJECT;
  });
}

/** Everything the gate can read of a stack, the part not yet up left out. */
export async function readings(addresses: Addresses, state: KitState | null): Promise<PreflightReadings> {
  const out: PreflightReadings = {
    addresses: addresses.all(),
    dockerHost: dockerHost(),
    memoryBytes: dockerMemory(),
  };
  out.chainId = await chainId(addresses.chain);
  out.minPeers = MIN_PEERS;
  out.bees = await readBees(addresses);
  if (state) {
    out.stamps = await Promise.all([
      readStamp('gateway', addresses.worker1, state.stamps.gateway).then((reading) => ({ ...reading, inbox: true })),
      readStamp('server', addresses.worker2, state.stamps.server),
    ]);
    const health = await healthStatus(addresses.chatServer);
    out.chatServer = { status: health.status, heartbeatBack: heartbeatBack(health.body) };
    const { name, wallet } = readSnapshot().names.alice;
    const found = await resolveVerifiedEnsName(wallet, { rpcUrl: addresses.ethereum, timeoutMs: 10_000 });
    out.ens = { wallet, expected: name, found: found ?? null };
  }
  return out;
}

function report(checks: PreflightCheck[]): boolean {
  for (const check of checks) console.log(`  ${check.ok ? 'ok    ' : 'REFUSE'} ${check.name}: ${check.detail}`);
  return checks.every((check) => check.ok);
}

function viewerConfig(addresses: Addresses, state: KitState) {
  return {
    theme: 'swarm',
    themeSwitcher: true,
    gatewayUrl: '/bee',
    catalog: { owner: state.stream.owner, topic: state.stream.catalogTopic },
    chat: {
      enabled: true,
      readUrl: '/bee',
      writeUrl: addresses.gateway,
      gsocResourceId: state.gsocKey,
      gsocTopic: state.gsocIdentifier,
      feedOwner: state.feedOwner,
      pollIntervalMs: 1000,
    },
    swarmId: { url: addresses.swarmId },
    ensRpcUrl: addresses.ethereum,
  };
}

/** Creates the viewer with this stack's config.json copied in, since a bind mount would resolve on the daemon. */
function startViewer(env: Record<string, string>, addresses: Addresses, state: KitState): void {
  compose(['up', '--no-start', '--force-recreate', 'viewer'], env);
  const dir = mkdtempSync(join(tmpdir(), 'flow-kit-viewer-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(viewerConfig(addresses, state), null, 2));
  compose(['cp', join(dir, 'config.json'), 'viewer:/usr/share/nginx/html/config.json'], env);
  compose(['start', 'viewer'], env);
}

/** The Swarm ID routes the verbs open, which its development server compiles the first time a browser asks for them. */
const SWARM_ID_ROUTES = ['/', '/account/new', '/connect', '/dev', '/button'];

/**
 * Opens each Swarm ID route the scenarios use once in a browser, so the development server has compiled them before
 * the first scenario. A fresh server can take over a minute for the first page, past a step's budget.
 */
async function warmSwarmId(addresses: Addresses): Promise<void> {
  const start = Date.now();
  const { browser } = await launchPartitioned();
  try {
    const page = await browser.newPage();
    for (const route of SWARM_ID_ROUTES) {
      await page.goto(`${addresses.swarmId}${route}`, { waitUntil: 'networkidle', timeout: 300_000 });
    }
    // The strict build serves the unlisted check's proxy frame, compiled on first request like the rest.
    for (const route of ['/', '/proxy']) {
      await page.goto(`${addresses.swarmIdStrict}${route}`, { waitUntil: 'networkidle', timeout: 300_000 });
    }
  } finally {
    await browser.close();
  }
  log(`Swarm ID's routes compiled in ${(since(start) / 1000).toFixed(1)} s`);
}

async function answers(url: string): Promise<boolean> {
  return (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok;
}

/** The commit a checkout is at, marked dirty when it holds changes no commit has, for every run's header. */
export function commitOf(dir: string): string {
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) return 'unknown';
  const changes = spawnSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
  return `${head.stdout.trim()}${changes.stdout.trim() ? '-dirty' : ''}`;
}

async function provision(lock: KitLock, addresses: Addresses, addressing: Addressing, probed: KitState['probe']) {
  const timings: Record<string, number> = {};
  let start = Date.now();
  const env = composeEnv(lock, addresses.all(), null);
  compose(['up', '-d', 'blockchain', 'queen'], env);
  await reachStack();
  const peerId = await waitFor('the queen to name its peer id', () => peerIdOf(addresses.queen), {
    timeoutMs: 180_000,
  });
  const bootnode = `/dns4/queen/tcp/1634/p2p/${peerId}`;
  compose(['up', '-d', 'worker-1', 'worker-2'], { ...env, QUEEN_BOOTNODE: bootnode });
  timings.nodesStarted = since(start);

  start = Date.now();
  await waitFor(
    `every node ready with ${MIN_PEERS} peers`,
    async () => (await readBees(addresses)).every((bee) => bee.ready && bee.peers >= MIN_PEERS),
    { timeoutMs: 300_000 },
  );
  timings.nodesReady = since(start);

  start = Date.now();
  log('buying the gateway, server and publishing stamps');
  // Bee runs one purchase at a time per node and answers a second with 429, so each node buys one batch, all at once.
  const [gateway, server, publish] = await Promise.all([
    buyStamp(addresses.worker1, SERVICE_STAMP_DEPTH),
    buyStamp(addresses.worker2, SERVICE_STAMP_DEPTH),
    buyStamp(addresses.queen, SERVICE_STAMP_DEPTH),
  ]);
  const stamps = { gateway, server, publish };
  timings.stamps = since(start);

  start = Date.now();
  log('publishing the stream and the stream list');
  const bee = new Bee(addresses.queen);
  const { owner } = await publishFinishedStream(bee, stamps.publish, STREAM);
  const overlay = await overlayOf(addresses.queen);
  const gsocKey = bee.messaging.gsocMine(overlay, Identifier.fromString(GSOC_IDENTIFIER), GSOC_PROXIMITY).toHex();
  const feedKey = new PrivateKey(randomBytes(32));
  timings.seeded = since(start);

  const state: KitState = {
    createdAt: new Date().toISOString(),
    addressing,
    bootnode,
    probe: probed,
    stamps,
    feedKey: feedKey.toHex(),
    feedOwner: feedKey.publicKey().address().toHex(),
    gsocKey,
    gsocIdentifier: GSOC_IDENTIFIER,
    stream: { owner, topic: STREAM.streamTopic, title: STREAM.title, catalogTopic: STREAM.catalogTopic },
    chatTopic: `chat-${STREAM.streamTopic}`,
    timings,
  };
  writeState(state);
  return state;
}

/** `kit up`: refuses before starting anything unsafe, brings the stack up, and refuses again if it is not healthy. */
export async function up({ fresh }: { fresh: boolean }): Promise<number> {
  const begin = Date.now();
  const lock = readLock();
  if (fresh) await down({ fresh: true });

  const foreign = foreignClusters();
  if (foreign.length) {
    console.error(`kit: another bee-compose cluster holds ${foreign.join(', ')}. Stop it first, it would collide.`);
    return 1;
  }

  installBrowser();
  let state = readState();
  const probed = state?.probe ?? (await probe());
  if (!probed.chosen) {
    console.error(`kit: ${probed.reason}`);
    return 1;
  }
  const asked = process.env.KIT_ADDRESSING as Addressing | undefined;
  if (state && asked && asked !== state.addressing) {
    console.error(`kit: the stack that is up serves ${state.addressing}, so KIT_ADDRESSING=${asked} needs --fresh`);
    return 1;
  }
  const addressing = state?.addressing ?? asked ?? probed.chosen;
  const addresses = addressesFor(addressing);
  log(`addresses: ${addressing}, ${probed.reason}`);
  const running = new Set(
    services(composeEnv(lock, addresses.all(), state))
      .filter((service) => service.State === 'running')
      .map((service) => service.Service),
  );
  const gate = {
    addresses: addresses.all(),
    dockerHost: dockerHost(),
    memoryBytes: dockerMemory(),
    busyPorts: await busyPorts(running),
  };
  if (!report(judgePreflight(gate))) return 1;

  let start = Date.now();
  prepareLibraries(lock);
  compose(['build'], composeEnv(lock, addresses.all(), state), { inherit: true });
  const built = since(start);

  if (state) {
    compose(['up', '-d', 'blockchain', 'queen', 'worker-1', 'worker-2'], composeEnv(lock, addresses.all(), state));
    await reachStack();
    const kept = state;
    const queenReady = await waitFor(
      'the queen to answer',
      async () => (await readBee('queen', addresses.queen)).ready,
      {
        timeoutMs: 180_000,
      },
    ).catch(() => false);
    if (!queenReady) {
      // A slow queen says nothing about the kept values, so nothing is thrown away on its account.
      console.error('kit: the queen did not answer within 3 minutes, so the kept stack was left as it is');
      return 1;
    }
    const known = await waitFor(
      'the queen to know the kept stamp',
      async () => (await readStamp('publish', addresses.queen, kept.stamps.publish)).usable,
      { timeoutMs: 60_000 },
    ).catch(() => false);
    if (!known) {
      log('the kept values name stamps this cluster does not have, so the stack is made again');
      await down({ fresh: true });
      state = null;
    }
  }
  state ??= await provision(lock, addresses, addressing, probed);
  const env = composeEnv(lock, addresses.all(), state);

  start = Date.now();
  compose(['up', '-d', ...APP_SERVICES], env);
  startViewer(env, addresses, state);
  await reachStack();
  await waitFor('Swarm ID to answer', () => answers(`${addresses.swarmId}/`), { timeoutMs: 300_000 });
  await waitFor('the strict Swarm ID to answer', () => answers(`${addresses.swarmIdStrict}/`), { timeoutMs: 300_000 });
  await waitFor('the hostile site to answer', () => answers(`${addresses.evil}/`));
  await warmSwarmId(addresses);
  await waitFor('the Ethereum chain to answer', async () => (await chainId(addresses.ethereum)) === '0x1');
  await waitFor('the signaling server to answer', () => answers(`${addresses.signaling}/healthz`));
  await waitFor('the gateway to answer', () => answers(`${addresses.gateway}/health`));
  await waitFor('the viewer to serve its config', () => answers(`${addresses.viewer}/config.json`));
  await waitFor(
    'the chat server to answer healthy with a heartbeat back',
    async () => {
      const health = await healthStatus(addresses.chatServer);
      return health.status === 200 && heartbeatBack(health.body);
    },
    { timeoutMs: 180_000 },
  );
  const servicesUp = since(start);

  const ok = report(judgePreflight(await readings(addresses, state)));
  const total = since(begin);
  state.timings = { ...state.timings, built, servicesUp, total };
  writeState(state);
  log(
    `up in ${(total / 1000).toFixed(1)} s (${Object.entries(state.timings)
      .map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`)
      .join(', ')})`,
  );
  for (const [part, address] of Object.entries(addresses.all())) log(`  ${part.padEnd(10)} ${address}`);
  return ok ? 0 : 1;
}

/** `kit down`: stops every container and keeps the volumes, or with `fresh` removes them and the generated values. */
export async function down({ fresh }: { fresh: boolean }): Promise<number> {
  const lock = readLock();
  const state = readState();
  const addresses = addressesFor(state?.addressing ?? Addressing.LOOPBACK);
  leaveStack();
  const args = fresh ? ['down', '-v', '--remove-orphans'] : ['stop'];
  compose(args, composeEnv(lock, addresses.all(), state), { inherit: true });
  if (fresh) forgetState();
  log(fresh ? 'down, volumes and generated values removed' : 'stopped, volumes kept');
  return 0;
}

/** `kit status`: each container, each check of the gate, and where each part answers. */
export async function status(): Promise<number> {
  const lock = readLock();
  const state = readState();
  const addresses = addressesFor(state?.addressing ?? Addressing.LOOPBACK);
  const env = composeEnv(lock, addresses.all(), state);
  const running = services(env);
  if (!running.length) {
    log('no stack is up');
    return 1;
  }
  await reachStack();
  for (const service of running) {
    console.log(`  ${service.Service.padEnd(12)} ${service.State}${service.Health ? ` (${service.Health})` : ''}`);
  }
  const ok = report(judgePreflight(await readings(addresses, state)));
  for (const [part, address] of Object.entries(addresses.all())) console.log(`  ${part.padEnd(10)} ${address}`);
  if (state) log(`made ${state.createdAt}, addressing ${state.addressing}`);
  return ok ? 0 : 1;
}
