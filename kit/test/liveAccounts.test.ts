import { describe, expect, it } from 'vitest';

import {
  judgeStandingGate,
  nextStandingDrive,
  readStandingAccount,
  standingAccounts,
  standingActorsOf,
  standingSecrets,
  standingVariables,
} from '../src/liveAccounts.ts';
import { parseScenario } from '../src/scenario.ts';

/** Twenty-four words of the right shape, which open no account anywhere since their checksum is never checked here. */
const PHRASE = Array.from({ length: 24 }, () => 'abandon').join(' ');
const PASSWORD = 'a password of the right length';
const DRIVE_ONE = 'aa'.repeat(32);
const DRIVE_TWO = 'bb'.repeat(32);
const STANDING = [
  { actor: 'alice', address: '0x0000000000000000000000000000000000000001', drives: [DRIVE_ONE, DRIVE_TWO] },
];

const env = (values: Record<string, string>) => values as Record<string, string | undefined>;

describe('standingVariables', () => {
  it('names an actor’s phrase and password variables by the actor', () => {
    expect(standingVariables('alice')).toEqual({ phrase: 'KIT_ALICE_PHRASE', password: 'KIT_ALICE_PASSWORD' });
  });
});

describe('readStandingAccount', () => {
  it('reads the phrase and the password, the phrase with its spacing made single', () => {
    const read = readStandingAccount(
      env({ KIT_ALICE_PHRASE: ` ${PHRASE.replaceAll(' ', '  ')}\n`, KIT_ALICE_PASSWORD: PASSWORD }),
      'alice',
    );
    expect(read).toEqual({ state: 'read', account: { phrase: PHRASE, password: PASSWORD } });
  });

  it('reads a phrase written as a numbered list, as a password manager keeps it, without its numbers', () => {
    const words = PHRASE.split(' ').slice(0, 12);
    const numbered = words.map((word, at) => `${at + 1}. ${word}`).join(' ');
    expect(readStandingAccount(env({ KIT_ALICE_PHRASE: numbered, KIT_ALICE_PASSWORD: PASSWORD }), 'alice')).toEqual({
      state: 'read',
      account: { phrase: words.join(' '), password: PASSWORD },
    });
    const outOfOrder = words.map((word, at) => `${at === 0 ? 2 : at + 1}. ${word}`).join(' ');
    expect(
      readStandingAccount(env({ KIT_ALICE_PHRASE: outOfOrder, KIT_ALICE_PASSWORD: PASSWORD }), 'alice').state,
    ).toBe('malformed');
  });

  it('names the variables that are missing, and never a value', () => {
    expect(readStandingAccount(env({}), 'alice')).toEqual({
      state: 'missing',
      variables: ['KIT_ALICE_PHRASE', 'KIT_ALICE_PASSWORD'],
    });
    expect(readStandingAccount(env({ KIT_ALICE_PHRASE: PHRASE, KIT_ALICE_PASSWORD: '' }), 'alice')).toEqual({
      state: 'missing',
      variables: ['KIT_ALICE_PASSWORD'],
    });
  });

  it('refuses a phrase that is not 12 to 24 lower-case words and a password shorter than Swarm ID takes, saying neither', () => {
    const read = readStandingAccount(
      env({ KIT_ALICE_PHRASE: 'Abandon two words', KIT_ALICE_PASSWORD: 'short' }),
      'alice',
    );
    expect(read.state).toBe('malformed');
    const text = JSON.stringify(read);
    expect(text).toMatch(/KIT_ALICE_PHRASE/);
    expect(text).toMatch(/KIT_ALICE_PASSWORD/);
    expect(text).not.toMatch(/Abandon|short"/);
    expect(
      readStandingAccount(env({ KIT_ALICE_PHRASE: `${PHRASE} abandon`, KIT_ALICE_PASSWORD: PASSWORD }), 'alice').state,
    ).toBe('malformed');
  });
});

describe('standingActorsOf', () => {
  it('names the actors a scenario buys a drive for, since live mode gives them a standing account and its drives', () => {
    const scenario = parseScenario({
      name: 's',
      description: 'd',
      profile: 'plain',
      actors: { alice: {}, bob: {} },
      steps: [
        'alice create-account password',
        'alice buy-drive depth=20',
        'bob create-account wallet',
        'alice buy-drive depth=20',
      ],
    });
    expect(standingActorsOf(scenario)).toEqual(['alice']);
  });
});

describe('judgeStandingGate', () => {
  const read = { state: 'read', account: { phrase: PHRASE, password: PASSWORD } } as const;
  const failed = (...args: Parameters<typeof judgeStandingGate>) =>
    judgeStandingGate(...args)
      .filter((check) => !check.ok)
      .map((check) => check.detail);

  it('passes an actor whose variables are read and whom the target names with an address and drives', () => {
    expect(failed({ alice: read }, STANDING)).toEqual([]);
    expect(judgeStandingGate({ alice: read }, STANDING).map((check) => check.name)).toEqual([
      'standing account alice',
      'standing target alice',
    ]);
  });

  it('refuses missing variables naming them and how a run gets them, and never holds a value', () => {
    const [detail] = failed(
      { alice: { state: 'missing', variables: ['KIT_ALICE_PHRASE', 'KIT_ALICE_PASSWORD'] } },
      STANDING,
    );
    expect(detail).toMatch(/KIT_ALICE_PHRASE and KIT_ALICE_PASSWORD are not set/);
    expect(detail).toMatch(/secret store/);
    expect(JSON.stringify(judgeStandingGate({ alice: read }, STANDING))).not.toContain(PHRASE);
    expect(JSON.stringify(judgeStandingGate({ alice: read }, STANDING))).not.toContain(PASSWORD);
  });

  it('refuses an actor the target names no standing account for', () => {
    expect(failed({ alice: read }, [])).toEqual([
      'the target names no standing account for alice, with its address and its drives',
    ]);
    expect(failed({ bob: read }, STANDING)).toEqual([
      'the target names no standing account for bob, with its address and its drives',
    ]);
  });
});

describe('nextStandingDrive', () => {
  it('gives the standing drives in the target’s order, one for each drive the scenario buys', () => {
    expect(nextStandingDrive('alice', [DRIVE_ONE, DRIVE_TWO], [])).toBe(DRIVE_ONE);
    expect(nextStandingDrive('alice', [DRIVE_ONE, DRIVE_TWO], [DRIVE_ONE])).toBe(DRIVE_TWO);
  });

  it('refuses once every standing drive is used, since live mode never buys one', () => {
    expect(() => nextStandingDrive('alice', [DRIVE_ONE], [DRIVE_ONE])).toThrow(
      /alice's standing account has no drive left for this step, and live mode never buys one/,
    );
  });
});

describe('standingAccounts and standingSecrets', () => {
  it('holds an account for each actor read and named, and names both its secrets for the evidence search', () => {
    const read = { state: 'read', account: { phrase: PHRASE, password: PASSWORD } } as const;
    const accounts = standingAccounts(
      { alice: read, bob: read, carol: { state: 'missing', variables: ['x'] } },
      STANDING,
    );
    expect([...accounts.keys()]).toEqual(['alice']);
    expect(accounts.get('alice')).toEqual({
      address: STANDING[0].address,
      drives: [DRIVE_ONE, DRIVE_TWO],
      credentials: { phrase: PHRASE, password: PASSWORD },
    });
    expect(standingSecrets(accounts)).toEqual({ "alice's recovery phrase": PHRASE, "alice's password": PASSWORD });
  });
});
