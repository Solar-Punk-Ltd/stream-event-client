import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Hex, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { KIT_DIR } from './paths.ts';

/** The baked snapshot and the image that boots it, offline, as the kit's Ethereum chain. */
export const ETHEREUM_IMAGE_DIR = join(KIT_DIR, 'images', 'ethereum');
export const SNAPSHOT_FILE = join(ETHEREUM_IMAGE_DIR, 'snapshot.json');
export const STATE_FILE_NAME = 'mainnet-fork.json.gz';

/** Where the snapshot sits inside the Ethereum image, decompressed. */
export const STATE_IN_IMAGE = '/tmp/mainnet-fork.json';
/** How the kit's Ethereum chain starts: from the snapshot, with mainnet's chain id, and never asking any endpoint. */
export const OFFLINE_ANVIL_ARGS = [
  '--load-state',
  STATE_IN_IMAGE,
  '--chain-id',
  '1',
  '--host',
  '0.0.0.0',
  '--port',
  '8545',
];

/** The name whose text record Swarm ID reads its allow list of sites from, and the record's key. */
export const ALLOW_LIST_NAME = 'solarpunkid.eth';
export const ALLOW_LIST_KEY = 'buzz.solarpunk.sites';
/**
 * The parent of every test name. Its owner is impersonated in the bake to set the allow list record anyway, so the
 * same impersonation makes the test names under it.
 */
export const TEST_NAME_PARENT = ALLOW_LIST_NAME;

/** The actors the bake gives an ENS name, each with a wallet of its own. */
export const ENS_ACTORS = ['alice', 'bob'] as const;
export type EnsActor = (typeof ENS_ACTORS)[number];

/**
 * A baked wallet's key, derived from a fixed phrase, so every bake makes the same wallets and the key is public by
 * construction: it is worth something only on the kit's own chain, where the snapshot gives it a name.
 */
export function bakedWalletKey(actor: EnsActor): Hex {
  return keccak256(toBytes(`flow-kit ens wallet ${actor}`));
}

export function bakedWalletAddress(actor: EnsActor): Hex {
  return privateKeyToAccount(bakedWalletKey(actor)).address;
}

/** The ENS name the bake gives an actor's wallet, forward and reverse. */
export function bakedName(actor: EnsActor): string {
  return `flowkit-${actor}.${TEST_NAME_PARENT}`;
}

/** What one bake made, written beside its state, so the kit and a later bake know what the snapshot holds. */
export interface SnapshotRecord {
  /** The mainnet block the bake forked from, which the public endpoint serves only while it is recent. */
  forkBlock: string;
  rpc: string;
  anvil: string;
  allowList: { name: string; key: string; value: string };
  names: Record<EnsActor, { name: string; wallet: string }>;
  /** A wallet with no name, looked up in the bake so the no-name path is in the snapshot too. */
  nameless: string;
  /** sha256 of the decompressed state, the same for two bakes of the same inputs. */
  stateSha256: string;
}

export function readSnapshot(): SnapshotRecord {
  return JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as SnapshotRecord;
}

interface DumpedChain {
  blocks?: { header: { number: string } }[];
  transactions?: { block_number: string; info: { transaction_index: number } }[];
}

/**
 * anvil's dump with its blocks and transactions in chain order. anvil writes both from a hash map, so two dumps of the
 * same chain list them in different orders, and only an ordered dump can be compared byte for byte.
 */
export function canonicalState(dumped: string): string {
  const chain = JSON.parse(dumped) as DumpedChain;
  chain.blocks?.sort((a, b) => Number(BigInt(a.header.number) - BigInt(b.header.number)));
  chain.transactions?.sort(
    (a, b) =>
      Number(BigInt(a.block_number) - BigInt(b.block_number)) || a.info.transaction_index - b.info.transaction_index,
  );
  return JSON.stringify(chain);
}
