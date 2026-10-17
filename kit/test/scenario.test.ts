import { describe, expect, it } from 'vitest';

import { parseScenario, parseStep, suiteStatus, unknownVerbs } from '../src/scenario.ts';

describe('parseStep', () => {
  it('reads the actor, the verb, quoted text and options', () => {
    expect(parseStep('alice send "hello there, bob" --stamp mine')).toEqual({
      actor: 'alice',
      verb: 'send',
      args: ['hello there, bob'],
      options: { stamp: 'mine' },
      line: 'alice send "hello there, bob" --stamp mine',
    });
    expect(parseStep('alice buy-drive depth=20')).toMatchObject({
      verb: 'buy-drive',
      args: [],
      options: { depth: '20' },
    });
  });

  it('reads an expect step, whose first word is the check', () => {
    expect(parseStep('expect chat-feed alice 2')).toMatchObject({
      actor: null,
      verb: 'expect',
      args: ['chat-feed', 'alice', '2'],
    });
  });

  it('refuses an unclosed quote and a step with no verb', () => {
    expect(() => parseStep('alice send "never closed')).toThrow(/quote/);
    expect(() => parseStep('alice')).toThrow(/verb/);
  });
});

describe('parseScenario', () => {
  it('takes a name, a browser profile, the actors and the steps', () => {
    const scenario = parseScenario({
      name: 'my-stamp-send',
      profile: 'partitioned',
      actors: { alice: {} },
      steps: ['alice create-account password'],
    });
    expect(scenario.steps[0]).toMatchObject({ actor: 'alice', verb: 'create-account', args: ['password'] });
  });

  it('refuses a step naming an actor the scenario does not have', () => {
    expect(() =>
      parseScenario({ name: 'x', profile: 'plain', actors: { alice: {} }, steps: ['bob sign-in viewer'] }),
    ).toThrow(/bob/);
  });
});

describe('unknownVerbs', () => {
  it('names every step whose verb or check is not registered, before anything runs', () => {
    const scenario = parseScenario({
      name: 'x',
      profile: 'plain',
      actors: { alice: {} },
      steps: ['alice send hi', 'alice fly away', 'expect chat-feed', 'expect moon'],
    });
    expect(unknownVerbs(scenario, new Set(['send']), new Set(['chat-feed']))).toEqual([
      'alice fly away',
      'expect moon',
    ]);
  });

  it('reads a flag with no value, at the end or before another option, as true', () => {
    expect(parseStep('alice create-account wallet --ens-name').options).toEqual({ 'ens-name': 'true' });
    expect(parseStep('alice x --a --b 2').options).toEqual({ a: 'true', b: '2' });
  });
});

describe('known', () => {
  it('names the finding and the step it must fail at, which must be one of the steps', () => {
    const base = { name: 'x', profile: 'plain', actors: { alice: {} }, steps: ['alice send hi', 'expect chat-feed'] };
    expect(parseScenario({ ...base, known: { finding: 'a finding', failsAt: 'expect chat-feed' } }).known).toEqual({
      finding: 'a finding',
      failsAt: 'expect chat-feed',
    });
    expect(() => parseScenario({ ...base, known: { finding: 'a finding', failsAt: 'expect moon' } })).toThrow(
      /expect moon/,
    );
    expect(() => parseScenario({ ...base, known: 'a finding' })).toThrow();
  });
});

describe('accepted', () => {
  it('names a limit the scenario passes with on purpose, so its pass is not read as a fix', () => {
    const base = { name: 'x', profile: 'plain', actors: { alice: {} }, steps: ['alice send hi'] };
    expect(parseScenario({ ...base, accepted: { limit: 'the viewer trusts its endpoint' } }).accepted).toEqual({
      limit: 'the viewer trusts its endpoint',
    });
    expect(() => parseScenario({ ...base, accepted: { limit: '' } })).toThrow();
    expect(() =>
      parseScenario({
        ...base,
        accepted: { limit: 'a limit' },
        known: { finding: 'a finding', failsAt: 'alice send hi' },
      }),
    ).toThrow(/both/);
  });
});

describe('suiteStatus', () => {
  const known = { finding: 'a finding', failsAt: 'expect chat-feed' };

  it('passes when every scenario passed and every known one failed at its pinned step', () => {
    expect(suiteStatus([{ ok: true }, { ok: false, known, failedAt: 'expect chat-feed' }])).toBe(0);
  });

  it('fails on an unknown failure, and on a known scenario that passed, which needs its finding looked at', () => {
    expect(suiteStatus([{ ok: false, failedAt: 'alice send hi' }])).toBe(1);
    expect(suiteStatus([{ ok: true, known }])).toBe(1);
  });

  it('fails on a known scenario that failed anywhere but its pinned step, which proves nothing of its finding', () => {
    expect(suiteStatus([{ ok: false, known, failedAt: 'alice send hi' }])).toBe(1);
    expect(suiteStatus([{ ok: false, known }])).toBe(1);
  });
});
