import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { KIT_DIR } from '../src/paths.ts';
import { LIVE_EVIL_ORIGIN, liveDeployment, parseTarget, readTarget } from '../src/target.ts';

const EXAMPLE_TARGET = join(KIT_DIR, 'targets', 'example.json');
const config = () =>
  JSON.parse(readFileSync(join(KIT_DIR, 'test', 'fixtures', 'live-config.json'), 'utf8')) as Record<string, unknown>;
/** The address of the secp256k1 key 1, which the fixture's inbox key is. */
const KEY_ONE_ADDRESS = '7e5f4552091a69125d5dfcb7b8c2659029395bdf';

describe('parseTarget', () => {
  it('reads the example target the repository carries', () => {
    const target = readTarget(EXAMPLE_TARGET);
    expect(target.name).toBe('example');
    expect(target.viewer).toBe('https://viewer.example.com');
    expect(target.stream).toEqual({
      mediaType: 'video',
      owner: '0000000000000000000000000000000000000000',
      topic: '00000000-0000-0000-0000-000000000000',
      title: 'Example stream',
    });
  });

  it('refuses a viewer that is not a plain origin, a stream owner that is not an address, and an unknown field', () => {
    const good = JSON.parse(readFileSync(EXAMPLE_TARGET, 'utf8')) as Record<string, unknown>;
    expect(() => parseTarget({ ...good, viewer: 'https://viewer.example.com/app' })).toThrow(/viewer/);
    expect(() => parseTarget({ ...good, viewer: 'viewer.example.com' })).toThrow(/viewer/);
    expect(() => parseTarget({ ...good, stream: { ...(good.stream as object), owner: 'not an address' } })).toThrow(
      /owner/,
    );
    expect(() => parseTarget({ ...good, stamp: 'ab' })).toThrow();
  });

  it('takes an optional ens field naming the actor, its wallet address and its name', () => {
    const { ens: _placeholder, ...good } = JSON.parse(readFileSync(EXAMPLE_TARGET, 'utf8')) as Record<string, unknown>;
    const ens = { actor: 'alice', address: '0x0000000000000000000000000000000000000001', name: 'alice.example.eth' };
    expect(parseTarget({ ...good, ens }).ens).toEqual(ens);
    expect(parseTarget(good).ens).toBeUndefined();
    expect(() => parseTarget({ ...good, ens: { ...ens, address: 'not an address' } })).toThrow(/ens.address/);
    expect(() => parseTarget({ ...good, ens: { ...ens, name: 'no-dot' } })).toThrow(/ens.name/);
    expect(() => parseTarget({ ...good, ens: { ...ens, key: '0x01' } })).toThrow();
  });

  it('takes outside origins the deployment reads on its own, each a plain origin with why it is read', () => {
    const good = JSON.parse(readFileSync(EXAMPLE_TARGET, 'utf8')) as Record<string, unknown>;
    const reads = { origin: 'https://swarm.example.net', why: "Swarm ID's own Swarm gateway" };
    expect(parseTarget({ ...good, alsoAllowed: [reads] }).alsoAllowed).toEqual([reads]);
    expect(parseTarget(good).alsoAllowed).toEqual([]);
    expect(() => parseTarget({ ...good, alsoAllowed: [{ ...reads, origin: 'https://swarm.example.net/x' }] })).toThrow(
      /alsoAllowed/,
    );
    expect(() => parseTarget({ ...good, alsoAllowed: [{ origin: reads.origin }] })).toThrow(/why/);
  });
});

describe('parseTarget standing', () => {
  const good = () => JSON.parse(readFileSync(EXAMPLE_TARGET, 'utf8')) as Record<string, unknown>;
  const alice = {
    actor: 'alice',
    address: '0x0000000000000000000000000000000000000001',
    drives: ['aa'.repeat(32), 'bb'.repeat(32)],
  };

  it('takes standing accounts, each an actor, its account address and its drives in the order they are used', () => {
    expect(parseTarget({ ...good(), standing: [alice] }).standing).toEqual([alice]);
    const { standing: _example, ...none } = good();
    expect(parseTarget(none).standing).toEqual([]);
  });

  it('refuses a drive that is not a batch id, an account with no drive, and a phrase or password in the file', () => {
    expect(() => parseTarget({ ...good(), standing: [{ ...alice, drives: ['7ec2f440'] }] })).toThrow(/standing/);
    expect(() => parseTarget({ ...good(), standing: [{ ...alice, drives: [] }] })).toThrow(/standing/);
    expect(() => parseTarget({ ...good(), standing: [{ ...alice, address: 'nope' }] })).toThrow(/standing/);
    expect(() => parseTarget({ ...good(), standing: [{ ...alice, phrase: 'x' }] })).toThrow();
    expect(() => parseTarget({ ...good(), standing: [{ ...alice, password: 'x' }] })).toThrow();
  });
});

describe('parseTarget chatHealth', () => {
  const good = () => {
    const { chatHealth: _example, ...rest } = JSON.parse(readFileSync(EXAMPLE_TARGET, 'utf8')) as Record<
      string,
      unknown
    >;
    return rest;
  };

  it('takes the local end of the tunnel to the chat server, a loopback origin, and leaves it out when not given', () => {
    expect(parseTarget({ ...good(), chatHealth: 'http://127.0.0.1:4997' }).chatHealth).toBe('http://127.0.0.1:4997');
    expect(parseTarget({ ...good(), chatHealth: 'http://localhost:4997' }).chatHealth).toBe('http://localhost:4997');
    expect(parseTarget(good()).chatHealth).toBeUndefined();
  });

  it('refuses a chatHealth that is not on this machine or carries a path, since only a tunnel reaches it', () => {
    expect(() => parseTarget({ ...good(), chatHealth: 'http://192.0.2.10:4997' })).toThrow(/chatHealth/);
    expect(() => parseTarget({ ...good(), chatHealth: 'http://127.0.0.1:4997/health' })).toThrow(/chatHealth/);
  });
});

describe('liveDeployment', () => {
  const target = readTarget(EXAMPLE_TARGET);

  it('takes every address from the target and the config, a path resolved on the viewer origin', () => {
    const live = liveDeployment(target, config());
    expect(live.viewer).toBe('https://viewer.example.com');
    expect(live.gateway).toBe('https://viewer.example.com/bee');
    expect(live.chatRead).toBe('https://gateway.example.com/chat');
    expect(live.chatWrite).toBe('https://gateway.example.com/chat');
    expect(live.swarmId).toBe('https://id.example.com');
    expect(live.ensRpc).toBe('https://ethereum-rpc.example.org');
    expect(live.catalog).toEqual({ owner: '0000000000000000000000000000000000000000', topic: 'example-catalog' });
  });

  it('names the chat feed by the stream topic and the inbox owner by the inbox key', () => {
    const live = liveDeployment(target, config());
    expect(live.deployment.chatTopic).toBe('chat-00000000-0000-0000-0000-000000000000');
    expect(live.deployment.feedOwner).toBe('0000000000000000000000000000000000000000');
    expect(live.deployment.inboxOwner).toBe(KEY_ONE_ADDRESS);
    expect(live.deployment.chatWrite).toBe('https://gateway.example.com/chat');
    expect(live.deployment.stream).toEqual(target.stream);
  });

  it('takes the inbox key and identifier from the config, which every sender writes with', () => {
    const live = liveDeployment(target, config());
    expect(live.inbox).toEqual({
      key: '0000000000000000000000000000000000000000000000000000000000000001',
      identifier: 'example-chat-inbox',
    });
  });

  it('carries the chat server health address only when the target names one', () => {
    const { chatHealth: _example, ...untunnelled } = JSON.parse(readFileSync(EXAMPLE_TARGET, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(liveDeployment(parseTarget(untunnelled), config()).chatHealth).toBeNull();
    expect(liveDeployment(target, config()).chatHealth).toBe('http://127.0.0.1:4997');
  });

  it('serves the hostile site from this machine and puts every address the run uses in its table', () => {
    const live = liveDeployment(target, config());
    expect(live.addresses.evil).toBe(LIVE_EVIL_ORIGIN);
    expect(live.addresses.all()).toEqual({
      viewer: 'https://viewer.example.com',
      swarmId: 'https://id.example.com',
      gateway: 'https://viewer.example.com/bee',
      chatRead: 'https://gateway.example.com/chat',
      chatWrite: 'https://gateway.example.com/chat',
      ensRpc: 'https://ethereum-rpc.example.org',
      evil: LIVE_EVIL_ORIGIN,
    });
  });

  it('refuses a config the viewer itself would refuse, and one without the parts live mode reads', () => {
    expect(() => liveDeployment(target, { ...config(), catalog: { owner: 'x', topic: 't' } })).toThrow(/catalog/);
    expect(() => liveDeployment(target, { ...config(), chat: { enabled: false } })).toThrow(/chat/);
    const { swarmId: _swarmId, ...noSwarmId } = config();
    expect(() => liveDeployment(target, noSwarmId)).toThrow(/swarmId/);
    const { ensRpcUrl: _ens, ...noEns } = config();
    expect(() => liveDeployment(target, noEns)).toThrow(/ensRpcUrl/);
  });
});
