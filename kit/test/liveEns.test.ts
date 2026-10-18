import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { bakedName } from '../src/ens.ts';
import {
  ENS_KEY_VARIABLE,
  ensActorsOf,
  ensNameFor,
  type EnsGateReadings,
  evidenceLeaks,
  judgeEnsGate,
  readEnsKey,
} from '../src/liveEns.ts';
import { parseScenario } from '../src/scenario.ts';

/** A key whose worth is nothing anywhere: the secp256k1 key 1. */
const KEY = `0x${'0'.repeat(63)}1` as const;
const KEY_ADDRESS = privateKeyToAccount(KEY).address;
const ENS = { actor: 'alice', address: KEY_ADDRESS, name: 'flowkit-alice.example.eth' };

const HEALTHY: EnsGateReadings = {
  key: { state: 'read', address: KEY_ADDRESS },
  expected: ENS,
  actors: ['alice'],
  forward: { address: KEY_ADDRESS, problem: null },
  reverse: { name: ENS.name, problem: null },
};

const failed = (readings: EnsGateReadings) =>
  judgeEnsGate(readings)
    .filter((check) => !check.ok)
    .map((check) => check.name);

describe('readEnsKey', () => {
  it('reads a 0x 32-byte hex key from KIT_ENS_KEY, and says missing or malformed without the value', () => {
    expect(ENS_KEY_VARIABLE).toBe('KIT_ENS_KEY');
    const read = readEnsKey({ KIT_ENS_KEY: KEY });
    expect(read.state).toBe('read');
    expect(read.state === 'read' && read.wallet.address).toBe(KEY_ADDRESS);
    expect(readEnsKey({})).toEqual({ state: 'missing' });
    expect(readEnsKey({ KIT_ENS_KEY: '' })).toEqual({ state: 'missing' });
    expect(readEnsKey({ KIT_ENS_KEY: KEY.slice(2) })).toEqual({ state: 'malformed' });
    expect(readEnsKey({ KIT_ENS_KEY: `${KEY}00` })).toEqual({ state: 'malformed' });
  });
});

describe('ensActorsOf', () => {
  it('names the actors whose account a scenario makes with the ENS wallet', () => {
    const scenario = parseScenario({
      name: 's',
      description: 'd',
      profile: 'plain',
      actors: { alice: {}, bob: {} },
      steps: ['alice create-account wallet --ens-name', 'bob create-account passkey', 'alice ens on'],
    });
    expect(ensActorsOf(scenario)).toEqual(['alice']);
    expect(ensActorsOf({ ...scenario, steps: scenario.steps.slice(1) })).toEqual([]);
  });
});

describe('judgeEnsGate', () => {
  it('passes a key whose wallet is the target named, whose name resolves to it and back', () => {
    expect(failed(HEALTHY)).toEqual([]);
  });

  it('refuses a missing key, naming the variable and how a run gets it, and never a value', () => {
    const checks = judgeEnsGate({ ...HEALTHY, key: { state: 'missing' } });
    const key = checks.find((check) => check.name === 'ens key')!;
    expect(key.ok).toBe(false);
    expect(key.detail).toMatch(/KIT_ENS_KEY/);
    expect(key.detail).toMatch(/pnpm kit live run .* in its environment/);
    expect(failed({ ...HEALTHY, key: { state: 'malformed' } })).toContain('ens key');
  });

  it('refuses a key whose wallet is not the one the target names', () => {
    const other = privateKeyToAccount(`0x${'0'.repeat(63)}2`).address;
    expect(failed({ ...HEALTHY, key: { state: 'read', address: other } })).toEqual(['ens wallet']);
  });

  it('accepts the target address in any case', () => {
    expect(failed({ ...HEALTHY, expected: { ...ENS, address: ENS.address.toLowerCase() } })).toEqual([]);
  });

  it('refuses a target with no ens field, or one naming an actor the scenario does not give the wallet', () => {
    expect(failed({ ...HEALTHY, expected: undefined })).toContain('ens target');
    expect(failed({ ...HEALTHY, expected: { ...ENS, actor: 'bob' } })).toContain('ens target');
  });

  it('refuses a name that does not resolve forward to the wallet, or back to the name', () => {
    expect(failed({ ...HEALTHY, forward: { address: null, problem: null } })).toEqual(['ens forward']);
    const other = privateKeyToAccount(`0x${'0'.repeat(63)}3`).address;
    expect(failed({ ...HEALTHY, forward: { address: other, problem: null } })).toEqual(['ens forward']);
    expect(failed({ ...HEALTHY, reverse: { name: 'someone-else.eth', problem: null } })).toEqual(['ens reverse']);
    expect(failed({ ...HEALTHY, reverse: { name: null, problem: 'the endpoint did not answer' } })).toEqual([
      'ens reverse',
    ]);
  });
});

describe('ensNameFor', () => {
  it('is the baked name locally and the target name live', () => {
    expect(ensNameFor({ live: null }, 'alice')).toBe(bakedName('alice'));
    expect(ensNameFor({ live: { target: { ens: ENS } } }, 'alice')).toBe(ENS.name);
  });

  it('refuses live an actor the target gives no name, and locally an actor the snapshot has none for', () => {
    expect(() => ensNameFor({ live: { target: { ens: ENS } } }, 'bob')).toThrow(/bob/);
    expect(() => ensNameFor({ live: { target: {} } }, 'alice')).toThrow(/ens/);
    expect(() => ensNameFor({ live: null }, 'carol')).toThrow(/carol/);
  });
});

describe('evidenceLeaks', () => {
  it('finds the key in an actor folder’s network, console or trace, and names where without the key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-ens-'));
    const alice = join(dir, 'alice');
    const bob = join(dir, 'bob');
    mkdirSync(alice);
    mkdirSync(bob);
    writeFileSync(join(alice, 'network.har'), '{}');
    writeFileSync(join(alice, 'console.log'), `signed with ${KEY}`);
    writeFileSync(join(bob, 'network.har'), '{}');
    const found = evidenceLeaks([alice, bob], { 'ens wallet key': KEY }, { verdict: 'clean' });
    expect(found).toEqual([`ens wallet key in ${join('alice', 'console.log')}`]);
    expect(found.join()).not.toContain(KEY.slice(2));
    expect(evidenceLeaks([bob], { 'ens wallet key': KEY }, { verdict: KEY })).toEqual(['ens wallet key in verdict']);
  });
});
