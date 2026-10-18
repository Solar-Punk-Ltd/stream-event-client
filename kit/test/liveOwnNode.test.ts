import { describe, expect, it } from 'vitest';

import { ownNodeOf } from '../src/deployment.ts';
import { judgeOwnNodeGate, ownNodeActorsOf } from '../src/liveOwnNode.ts';
import { parseScenario } from '../src/scenario.ts';

const scenario = (actors: Record<string, unknown>, steps: string[]) =>
  parseScenario({ name: 'some-scenario', description: 'a scenario', profile: 'partitioned', actors, steps });

describe('ownNodeActorsOf', () => {
  it('names the actors who start reading from their own node and those who connect it later', () => {
    expect(ownNodeActorsOf(scenario({ alice: { chatSource: 'bee' }, bob: {} }, ['bob sign-in viewer']))).toEqual([
      'alice',
    ]);
    expect(
      ownNodeActorsOf(scenario({ alice: {}, bob: {} }, ['alice connect-source bee', 'bob sign-in viewer'])),
    ).toEqual(['alice']);
  });

  it('leaves out an actor who connects only the gateway or Weeb3, and names each actor once', () => {
    expect(
      ownNodeActorsOf(scenario({ alice: {} }, ['alice connect-source gateway', 'alice connect-source weeb3'])),
    ).toEqual([]);
    expect(ownNodeActorsOf(scenario({ alice: { chatSource: 'bee' } }, ['alice connect-source bee']))).toEqual([
      'alice',
    ]);
  });
});

describe('judgeOwnNodeGate', () => {
  const failing = (reading: Parameters<typeof judgeOwnNodeGate>[0][number]) =>
    judgeOwnNodeGate([reading]).filter((check) => !check.ok);

  it('passes when the tunnel answers as a Bee node', () => {
    expect(failing({ actor: 'alice', address: 'http://127.0.0.1:4996', status: 200, version: '2.8.3' })).toEqual([]);
    expect(
      judgeOwnNodeGate([{ actor: 'alice', address: 'http://127.0.0.1:4996', status: 200, version: '2.8.3' }])[0],
    ).toMatchObject({ name: 'own node alice', ok: true, detail: expect.stringMatching(/Bee 2\.8\.3/) });
  });

  it('refuses without an own node for the actor in the target, naming the tunnel to open and where to name it', () => {
    const [check] = failing({ actor: 'alice', address: null, status: null, version: null });
    expect(check.name).toBe('own node alice');
    expect(check.detail).toMatch(/ssh -N -L 4996:<the node's API address> <the node's host>/);
    expect(check.detail).toMatch(/ownNodes/);
  });

  it('refuses a tunnel that answers nothing, or answers as something that is not Bee', () => {
    expect(
      failing({ actor: 'alice', address: 'http://127.0.0.1:4996', status: null, version: null })[0].detail,
    ).toMatch(/answered nothing.*ssh -N -L/);
    expect(failing({ actor: 'alice', address: 'http://127.0.0.1:4996', status: 200, version: null })[0].detail).toMatch(
      /not as Bee/,
    );
    expect(
      failing({ actor: 'alice', address: 'http://127.0.0.1:4996', status: 503, version: '2.8.3' })[0].detail,
    ).toMatch(/503/);
  });
});

describe('ownNodeOf', () => {
  const local = { addresses: { worker2: 'http://localhost:16332' } };

  it('is the local stack’s worker-2 for every actor locally', () => {
    expect(ownNodeOf({ local, live: null } as never, 'bob')).toBe('http://localhost:16332');
  });

  it('is the target’s own node for the actor live, and a refusal naming the field when it names none', () => {
    const live = { ownNodes: { alice: 'http://127.0.0.1:4996' } };
    expect(ownNodeOf({ local: null, live } as never, 'alice')).toBe('http://127.0.0.1:4996');
    expect(() => ownNodeOf({ local: null, live } as never, 'bob')).toThrow(/bob.*ownNodes/);
  });
});
