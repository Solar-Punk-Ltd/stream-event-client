import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { Addressing, addressesFor } from '../src/addresses.ts';
import {
  bakedName,
  bakedWalletAddress,
  canonicalState,
  ENS_ACTORS,
  ETHEREUM_IMAGE_DIR,
  OFFLINE_ANVIL_ARGS,
  readSnapshot,
  STATE_FILE_NAME,
} from '../src/ens.ts';
import { readLock } from '../src/lock.ts';
import { composeEnv } from '../src/state.ts';

describe('canonicalState', () => {
  it('orders blocks and transactions by number, so two dumps of one chain read the same', () => {
    const block = (n: number) => ({ header: { number: `0x${n.toString(16)}` }, transactions: [] });
    const tx = (n: number, i: number) => ({ info: { transaction_index: i }, block_number: `0x${n.toString(16)}` });
    const one = {
      block: {},
      accounts: {},
      blocks: [block(3), block(1), block(2)],
      transactions: [tx(2, 0), tx(1, 1), tx(1, 0)],
    };
    const two = {
      block: {},
      accounts: {},
      blocks: [block(2), block(3), block(1)],
      transactions: [tx(1, 0), tx(2, 0), tx(1, 1)],
    };
    expect(canonicalState(JSON.stringify(one))).toBe(canonicalState(JSON.stringify(two)));
    expect(
      JSON.parse(canonicalState(JSON.stringify(one))).blocks.map(
        (b: { header: { number: string } }) => b.header.number,
      ),
    ).toEqual(['0x1', '0x2', '0x3']);
  });
});

describe('baked wallets', () => {
  it('are the same on every bake, and each has its own name', () => {
    expect(bakedWalletAddress('alice')).toBe(bakedWalletAddress('alice'));
    expect(bakedWalletAddress('alice')).not.toBe(bakedWalletAddress('bob'));
    expect(bakedName('bob')).toBe('flowkit-bob.solarpunkid.eth');
  });
});

describe('the committed snapshot', () => {
  it('names the wallets the fixed phrases derive, so the keys and the names belong together', () => {
    const snapshot = readSnapshot();
    for (const actor of ENS_ACTORS) {
      expect(snapshot.names[actor]).toEqual({ name: bakedName(actor), wallet: bakedWalletAddress(actor) });
    }
  });

  it('is the state its record hashes, so the image boots what the bake verified', () => {
    const state = gunzipSync(readFileSync(join(ETHEREUM_IMAGE_DIR, STATE_FILE_NAME)));
    expect(createHash('sha256').update(state).digest('hex')).toBe(readSnapshot().stateSha256);
  });

  it('boots with the arguments the bake checked it with, handed to the image by the kit', () => {
    const env = composeEnv(readLock(), addressesFor(Addressing.LOOPBACK).all(), null);
    expect(env.KIT_ETHEREUM_ARGS).toBe(OFFLINE_ANVIL_ARGS.join(' '));
    expect(readFileSync(join(ETHEREUM_IMAGE_DIR, 'Dockerfile'), 'utf8')).toMatch(/^ENTRYPOINT \["anvil"\]$/m);
  });
});
