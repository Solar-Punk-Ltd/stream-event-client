/**
 * The ENS snapshot bake: Ethereum mainnet forked with anvil from a public endpoint, the allow list record and two test
 * names set by impersonating their owners, every lookup the kit makes run once so the fork has fetched what they touch,
 * and the whole state dumped. The kit boots that state offline as its Ethereum chain, so nothing at run time needs the
 * public endpoint. Run by hand when a name or the record must change: `pnpm kit bake-ens`. The public endpoint keeps
 * only recent state, so a bake forks from a block near its head.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { resolveVerifiedEnsName } from '@solarpunkltd/swarm-id';
import { createSiteAllowList } from '@solarpunkltd/swarm-id/internal';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  type Hex,
  http,
  labelhash,
  namehash,
  parseAbi,
  parseEther,
} from 'viem';
import { mainnet } from 'viem/chains';

import { Addressing, addressesFor } from './addresses.ts';
import {
  ALLOW_LIST_KEY,
  ALLOW_LIST_NAME,
  bakedName,
  bakedWalletAddress,
  canonicalState,
  ENS_ACTORS,
  ETHEREUM_IMAGE_DIR,
  OFFLINE_ANVIL_ARGS,
  STATE_IN_IMAGE,
  type SnapshotRecord,
  SNAPSHOT_FILE,
  STATE_FILE_NAME,
  TEST_NAME_PARENT,
} from './ens.ts';
import { readLock } from './lock.ts';

/** The public mainnet endpoint the bake forks from. Read only here, never by the kit at run time. */
const BAKE_RPC = 'https://ethereum-rpc.publicnode.com';
const BAKE_PORT = 18546;
const BAKE_CONTAINER = 'flow-kit-ens-bake';
const CHECK_PORT = 18547;
const CHECK_CONTAINER = 'flow-kit-ens-check';
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
/** How far behind the head the bake forks, so the block is final enough and still inside the endpoint's window. */
const BLOCKS_BEHIND_HEAD = 4n;
/** Seconds between the bake's blocks, counted from the fork block's own time, so two bakes mine the same blocks. */
const BLOCK_INTERVAL_S = 12;
/** An address with no ENS name, made from a fixed phrase, whose lookup brings the no-name path into the snapshot. */
const NAMELESS: Hex = '0x00000000000000000000000000000000f10ccafe';

const registryAbi = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
]);
const resolverAbi = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function setAddr(bytes32 node, address a)',
]);
const reverseAbi = parseAbi(['function setName(string name) returns (bytes32)']);

function docker(args: string[], { allowFailure = false } = {}): string {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure)
    throw new Error(`docker ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
  return result.stdout.trim();
}

interface JsonRpcCall {
  method: string;
  params?: unknown[];
}

/**
 * A local endpoint in front of the bake chain that forwards every request and keeps each `eth_call` it saw, so the
 * state those reads touched can be found afterwards. A fork fetches what a read touches but keeps it out of the dump,
 * which holds only what was written.
 */
async function recordingProxy(target: string) {
  const calls: unknown[][] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(body) as JsonRpcCall | JsonRpcCall[];
      for (const call of Array.isArray(parsed) ? parsed : [parsed]) {
        if (call.method === 'eth_call' && call.params) calls.push(call.params);
      }
      fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        .then(async (answer) => {
          response.writeHead(answer.status, { 'content-type': 'application/json' });
          response.end(await answer.text());
        })
        .catch((error: unknown) => {
          response.writeHead(502);
          response.end(String(error));
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => server.close() };
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const answer = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await answer.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

interface Prestate {
  balance?: Hex;
  nonce?: number;
  code?: Hex;
  storage?: Record<Hex, Hex>;
}

/**
 * Writes every account, code and storage slot the recorded reads touched back into the chain as it is, which makes
 * them part of the dump. What each read touched comes from tracing it again with the prestate tracer.
 */
async function pinReadState(url: string, calls: unknown[][]): Promise<number> {
  const touched = new Map<string, Prestate>();
  for (const [call, block] of calls) {
    const prestate = await rpc<Record<string, Prestate>>(url, 'debug_traceCall', [
      call,
      block ?? 'latest',
      { tracer: 'prestateTracer' },
    ]);
    for (const [address, account] of Object.entries(prestate)) {
      const known = touched.get(address) ?? {};
      touched.set(address, { ...known, ...account, storage: { ...known.storage, ...account.storage } });
    }
  }
  let slots = 0;
  for (const [address, account] of touched) {
    if (account.code && account.code !== '0x') await rpc(url, 'anvil_setCode', [address, account.code]);
    for (const [slot, value] of Object.entries(account.storage ?? {})) {
      await rpc(url, 'anvil_setStorageAt', [address, slot, value]);
      slots++;
    }
  }
  return slots;
}

async function waitForChain(url: string): Promise<void> {
  const client = createPublicClient({ transport: http(url, { retryCount: 0 }) });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await client.getChainId().catch(() => null)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('the bake chain never answered');
}

/**
 * Every lookup the kit makes, through the very library Swarm ID and the viewer read ENS with: each baked wallet's name,
 * a wallet with none, and the allow list record. Refuses when an answer is not what the bake set.
 */
async function runLookups(url: string): Promise<SnapshotRecord['names']> {
  const names = {} as SnapshotRecord['names'];
  for (const actor of ENS_ACTORS) {
    const wallet = bakedWalletAddress(actor);
    const found = await resolveVerifiedEnsName(wallet, { rpcUrl: url, timeoutMs: 120_000 });
    if (found !== bakedName(actor))
      throw new Error(`${wallet} reads as ${found ?? 'no name'}, not ${bakedName(actor)}`);
    names[actor] = { name: found, wallet };
  }
  const none = await resolveVerifiedEnsName(NAMELESS, { rpcUrl: url, timeoutMs: 120_000 });
  if (none !== undefined) throw new Error(`the nameless wallet reads as ${none}`);
  // Swarm ID takes only https origins from the record, so the viewer's own origin there is read and set aside.
  const allowed = await createSiteAllowList({ rpcUrl: url, ensName: ALLOW_LIST_NAME, recordKey: ALLOW_LIST_KEY }).check(
    'https://site.example.org',
  );
  if (allowed.allowed) throw new Error('the allow list let a site in that the record does not name');
  return names;
}

/** Boots the dumped state the way the kit does, with no endpoint behind it, and runs every lookup against it. */
async function verifyOffline(state: Buffer, image: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'flow-kit-ens-'));
  const file = join(dir, 'mainnet-fork.json');
  writeFileSync(file, gunzipSync(state));
  docker(['rm', '-f', CHECK_CONTAINER], { allowFailure: true });
  try {
    docker([
      'create',
      '--name',
      CHECK_CONTAINER,
      '-p',
      `127.0.0.1:${CHECK_PORT}:8545`,
      '--entrypoint',
      'anvil',
      image,
      ...OFFLINE_ANVIL_ARGS,
    ]);
    docker(['cp', file, `${CHECK_CONTAINER}:${STATE_IN_IMAGE}`]);
    docker(['start', CHECK_CONTAINER]);
    const url = `http://127.0.0.1:${CHECK_PORT}`;
    await waitForChain(url);
    await runLookups(url);
    console.log('kit: the snapshot answers every lookup offline');
  } finally {
    docker(['rm', '-f', CHECK_CONTAINER], { allowFailure: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bakes the snapshot from `block`, or from a block just behind the endpoint's head, and returns what it made. */
export async function bakeEns({ block }: { block?: bigint } = {}): Promise<SnapshotRecord> {
  const lock = readLock();
  const viewerOrigin = addressesFor(Addressing.LOOPBACK).viewer;
  const forkBlock =
    block ?? (await createPublicClient({ transport: http(BAKE_RPC) }).getBlockNumber()) - BLOCKS_BEHIND_HEAD;
  console.log(`kit: baking ENS from mainnet block ${forkBlock}`);

  docker(['rm', '-f', BAKE_CONTAINER], { allowFailure: true });
  docker([
    'run',
    '-d',
    '--name',
    BAKE_CONTAINER,
    '-p',
    `127.0.0.1:${BAKE_PORT}:8545`,
    '--entrypoint',
    'anvil',
    `ghcr.io/foundry-rs/foundry:${lock.foundry}`,
    '--fork-url',
    BAKE_RPC,
    '--fork-block-number',
    String(forkBlock),
    '--chain-id',
    '1',
    '--host',
    '0.0.0.0',
    '--port',
    '8545',
  ]);
  try {
    const url = `http://127.0.0.1:${BAKE_PORT}`;
    await waitForChain(url);
    const transport = http(url, { timeout: 120_000 });
    const chain = { ...mainnet, rpcUrls: { default: { http: [url] } } };
    const test = createTestClient({ chain, mode: 'anvil', transport });
    const reader = createPublicClient({ chain, transport });
    const forked = await reader.getBlock({ blockNumber: forkBlock });
    await test.setNextBlockTimestamp({ timestamp: forked.timestamp + BigInt(BLOCK_INTERVAL_S) });
    await test.setBlockTimestampInterval({ interval: BLOCK_INTERVAL_S });

    /** Sends one call as `from`, an owner the fork lets the bake act for, and waits for it to be mined. */
    const actAs = async (from: Hex, send: (wallet: ReturnType<typeof createWalletClient>) => Promise<Hex>) => {
      await test.impersonateAccount({ address: from });
      await test.setBalance({ address: from, value: parseEther('1') });
      const hash = await send(createWalletClient({ account: from, chain, transport }));
      const receipt = await reader.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`a bake transaction from ${from} reverted`);
      await test.stopImpersonatingAccount({ address: from });
    };

    const parentNode = namehash(TEST_NAME_PARENT);
    const owner = await reader.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: 'owner',
      args: [parentNode],
    });
    const resolver = await reader.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: 'resolver',
      args: [parentNode],
    });
    const reverseRegistrar = await reader.readContract({
      address: ENS_REGISTRY,
      abi: registryAbi,
      functionName: 'owner',
      args: [namehash('addr.reverse')],
    });
    console.log(`kit: ${TEST_NAME_PARENT} is owned by ${owner}, its resolver ${resolver}`);

    await actAs(owner, (wallet) =>
      wallet.writeContract({
        account: owner,
        chain,
        address: resolver,
        abi: resolverAbi,
        functionName: 'setText',
        args: [namehash(ALLOW_LIST_NAME), ALLOW_LIST_KEY, viewerOrigin],
      }),
    );
    for (const actor of ENS_ACTORS) {
      const wallet = bakedWalletAddress(actor);
      const name = bakedName(actor);
      const label = name.slice(0, -(TEST_NAME_PARENT.length + 1));
      await actAs(owner, (client) =>
        client.writeContract({
          account: owner,
          chain,
          address: ENS_REGISTRY,
          abi: registryAbi,
          functionName: 'setSubnodeRecord',
          args: [parentNode, labelhash(label), wallet, resolver, 0n],
        }),
      );
      await actAs(wallet, (client) =>
        client.writeContract({
          account: wallet,
          chain,
          address: resolver,
          abi: resolverAbi,
          functionName: 'setAddr',
          args: [namehash(name), wallet],
        }),
      );
      await actAs(wallet, (client) =>
        client.writeContract({
          account: wallet,
          chain,
          address: reverseRegistrar,
          abi: reverseAbi,
          functionName: 'setName',
          args: [name],
        }),
      );
    }

    const proxy = await recordingProxy(url);
    let names: SnapshotRecord['names'];
    try {
      names = await runLookups(proxy.url);
    } finally {
      proxy.close();
    }
    const slots = await pinReadState(url, proxy.calls);
    console.log(`kit: ${proxy.calls.length} reads touched ${slots} storage slots, all kept in the snapshot`);

    const dumped = (await test.dumpState()) as Hex;
    const canonical = canonicalState(gunzipSync(Buffer.from(dumped.slice(2), 'hex')).toString('utf8'));
    const compressed = gzipSync(canonical, { level: 9 });
    writeFileSync(join(ETHEREUM_IMAGE_DIR, STATE_FILE_NAME), compressed);
    const accounts =
      (
        JSON.parse(gunzipSync(compressed).toString('utf8')) as {
          accounts?: Record<string, { code?: string; storage?: Record<string, string> }>;
        }
      ).accounts ?? {};
    for (const [address, account] of Object.entries(accounts)) {
      console.log(
        `kit:   ${address} code ${((account.code?.length ?? 2) - 2) / 2} bytes, ${Object.keys(account.storage ?? {}).length} slots`,
      );
    }
    await verifyOffline(compressed, `ghcr.io/foundry-rs/foundry:${lock.foundry}`);
    const record: SnapshotRecord = {
      forkBlock: String(forkBlock),
      rpc: BAKE_RPC,
      anvil: lock.foundry,
      allowList: { name: ALLOW_LIST_NAME, key: ALLOW_LIST_KEY, value: viewerOrigin },
      names,
      nameless: NAMELESS,
      stateSha256: createHash('sha256').update(canonical).digest('hex'),
    };
    writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`kit: baked ${compressed.length} bytes, state sha256 ${record.stateSha256}`);
    return record;
  } finally {
    docker(['rm', '-f', BAKE_CONTAINER], { allowFailure: true });
  }
}
