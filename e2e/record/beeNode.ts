import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { docker, ownContainerId } from './docker';

/**
 * One funded Bee node on fdp-play's local chain, the smallest setup that answers the viewer's requests the way a real
 * gateway does. No real BZZ is spent. The settings are fdp-play 3.3.0's own, as the chat aggregator's live test bed
 * carries them (its test/live/cluster.mjs). That bed runs three nodes with a Bee built from source so chunks travel
 * between them. One node pushes to nobody, so the released Bee program serves here, swapped into fdp-play's funded
 * queen image.
 */
const BEE_VERSION = '2.8.3';
const FDP_PLAY_TAG = '2.6.0';
const QUEEN_IMAGE = `fairdatasociety/fdp-play-queen:${FDP_PLAY_TAG}`;
const CHAIN_IMAGE = 'fairdatasociety/fdp-play-blockchain';
const CHAIN_VERSION_LABELS = [
  'org.ethswarm.beefactory.blockchain-version',
  'org.fairdatasociety.fdp-play.blockchain-version',
];
const MINER = '0xCEeE442a149784faa65C35e328CCd64d874F9a02';
const CHAIN_ARGS = [
  '--allow-insecure-unlock',
  `--unlock=${MINER}`,
  '--password=/root/password',
  '--mine',
  `--miner.etherbase=${MINER}`,
  '--http',
  '--http.api=debug,web3,eth,txpool,net,personal',
  '--http.corsdomain=*',
  '--http.port=9545',
  '--http.addr=0.0.0.0',
  '--http.vhosts=*',
  '--maxpeers=0',
  '--networkid=4020',
  '--authrpc.vhosts=*',
  '--authrpc.addr=0.0.0.0',
];
const beeOptions = (chainRpc: string): Record<string, string> => ({
  'warmup-time': '0s',
  verbosity: '3',
  'swap-enable': 'true',
  mainnet: 'false',
  'swap-endpoint': chainRpc,
  'blockchain-rpc-endpoint': chainRpc,
  'swap-factory-address': '0xCfEB869F69431e42cdB54A4F4f105C19C080A601',
  password: 'password',
  'postage-stamp-address': '0x254dffcd3277C0b1660F6d42EFbB754edaBAbC2B',
  'price-oracle-address': '0x5b1869D9A4C187F2EAa108f3062412ecf0526b24',
  'redistribution-address': '0x9561C133DD8580860B6b7E504bC5Aa500f0f06a7',
  'staking-address': '0xD833215cBcc3f914bD1C9ece3EE7BF8B14f841bb',
  'postage-stamp-start-block': '1',
  'network-id': '4020',
  'full-node': 'true',
  'api-addr': '0.0.0.0:1633',
  'cors-allowed-origins': '*',
  'allow-private-cidrs': 'true',
  // Bee 2.8 no longer looks the token up on a chain it does not know, and fdp-play's settings predate that.
  'bzz-token-address': '0xe78A0F7E598Cc8b0Bb87894B0F60dD2a88d6a8Ab',
});

const LABEL = 'stream-event-client-recorder';
const NETWORK = 'viewer-record';
const CHAIN = 'viewer-record-chain';
const QUEEN = 'viewer-record-queen';
const BEE_API_PORT = 1633;
/** Where the node answers when this process runs on a machine rather than inside a container. */
const PUBLISHED_API_PORT = 11633;
/** Bee's default block time, which fdp-play leaves unset. */
const BLOCK_SECONDS = 5;

export { BEE_VERSION };

/** The node's API as this process reaches it, which is also where `vite preview` forwards the page's Bee requests. */
export function beeApiUrl(): string {
  return ownContainerId() ? `http://${QUEEN}:${BEE_API_PORT}` : `http://127.0.0.1:${PUBLISHED_API_PORT}`;
}

async function waitFor<T>(what: string, probe: () => Promise<T | null | false>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${lastError ? `: ${String(lastError)}` : ''}`);
}

async function json<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} answered ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function chainImage(): string {
  const labels =
    JSON.parse(docker(['image', 'inspect', QUEEN_IMAGE, '--format', '{{json .Config.Labels}}']).stdout) ?? {};
  const key = CHAIN_VERSION_LABELS.find((label) => labels[label]);
  return `${CHAIN_IMAGE}:${key ? labels[key] : 'latest'}`;
}

function beeImage(): string {
  const context = mkdtempSync(join(tmpdir(), 'viewer-record-bee-'));
  writeFileSync(
    join(context, 'Dockerfile'),
    `FROM ethersphere/bee:${BEE_VERSION} AS release\nFROM ${QUEEN_IMAGE}\nCOPY --from=release /usr/local/bin/bee /usr/local/bin/bee\n`,
  );
  const tag = `viewer-record-queen:${BEE_VERSION}`;
  docker(['build', '--label', LABEL, '-t', tag, context]);
  return tag;
}

export function stopBeeNode(): void {
  docker(['container', 'rm', '-f', QUEEN, CHAIN], { allowFailure: true });
  const self = ownContainerId();
  if (self) docker(['network', 'disconnect', '-f', NETWORK, self], { allowFailure: true });
  docker(['network', 'rm', NETWORK], { allowFailure: true });
}

/** Starts the chain and the node, and resolves once the node is ready to stamp and store. */
export async function startBeeNode(): Promise<void> {
  stopBeeNode();
  docker(['network', 'create', '--label', LABEL, NETWORK]);
  const self = ownContainerId();
  if (self) docker(['network', 'connect', NETWORK, self]);

  docker(['pull', QUEEN_IMAGE]);
  docker(['run', '-d', '--label', LABEL, '--network', NETWORK, '--name', CHAIN, chainImage(), ...CHAIN_ARGS]);
  const env = Object.entries(beeOptions(`http://${CHAIN}:9545`)).flatMap(([key, value]) => [
    '-e',
    `BEE_${key.toUpperCase().replace(/-/g, '_')}=${value}`,
  ]);
  const publish = self ? [] : ['-p', `127.0.0.1:${PUBLISHED_API_PORT}:${BEE_API_PORT}`];
  docker([
    'run',
    '-d',
    '--label',
    LABEL,
    '--network',
    NETWORK,
    '--name',
    QUEEN,
    ...publish,
    ...env,
    beeImage(),
    'start',
  ]);

  await waitFor(
    'the node to become ready',
    async () => {
      const running = docker(['container', 'inspect', '-f', '{{.State.Running}}', QUEEN]).stdout === 'true';
      if (!running)
        throw new Error(`the node exited:\n${docker(['logs', '--tail', '60', QUEEN], { allowFailure: true }).stderr}`);
      return (await fetch(`${beeApiUrl()}/readiness`, { signal: AbortSignal.timeout(5000) })).ok;
    },
    300_000,
  );
}

/** A mutable batch sized from the chain's current price to last a week, once the node can stamp with it. */
export async function buyStamp(depth: number): Promise<string> {
  const url = beeApiUrl();
  const { currentPrice } = await json<{ currentPrice: string }>(`${url}/chainstate`);
  const amount = BigInt(currentPrice) * BigInt((7 * 86_400) / BLOCK_SECONDS) + 1n;
  const { batchID } = await json<{ batchID: string }>(`${url}/stamps/${amount}/${depth}`, {
    method: 'POST',
    headers: { immutable: 'false' },
    timeoutMs: 180_000,
  });
  await waitFor(
    'the stamp to become usable',
    async () => (await json<{ usable: boolean }>(`${url}/stamps/${batchID}`)).usable,
    300_000,
  );
  return batchID;
}

/** The whole log of both containers, for the run's artifact. */
export function nodeLogs(): Record<string, string> {
  return Object.fromEntries(
    [QUEEN, CHAIN].map((name) => {
      const logs = docker(['logs', '--timestamps', name], { allowFailure: true });
      return [name, `${logs.stdout}\n${logs.stderr}`];
    }),
  );
}
