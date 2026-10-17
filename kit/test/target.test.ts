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
