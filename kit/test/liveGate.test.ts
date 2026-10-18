import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { judgeLiveGate, type LiveGateReadings, namedAddresses, unnamedAddresses } from '../src/liveGate.ts';
import { KIT_DIR } from '../src/paths.ts';
import { liveDeployment, parseTarget, readTarget } from '../src/target.ts';

const HEALTHY: LiveGateReadings = {
  addresses: {
    viewer: 'https://viewer.example.com',
    swarmId: 'https://id.example.com',
    gateway: 'https://viewer.example.com/bee',
    chatRead: 'https://gateway.example.com/chat',
    evil: 'http://[::1]:4998',
  },
  named: [
    'https://viewer.example.com',
    'https://id.example.com',
    'https://viewer.example.com/bee',
    'https://gateway.example.com/chat',
  ],
  servedHere: ['evil'],
  viewer: 200,
  config: null,
  swarmId: 200,
  catalogue: { status: 200, problem: null, streams: 3 },
  stream: { listed: true, state: 'vod' },
  chat: { status: 404, beeAnswer: true },
};

const failed = (readings: LiveGateReadings) =>
  judgeLiveGate(readings)
    .filter((check) => !check.ok)
    .map((check) => check.name);

describe('unnamedAddresses', () => {
  it('names an address the target and config do not name, a local one included', () => {
    expect(unnamedAddresses(HEALTHY.addresses, HEALTHY.named, HEALTHY.servedHere)).toEqual([]);
    expect(
      unnamedAddresses(
        { ...HEALTHY.addresses, queen: 'http://localhost:1633', other: 'https://elsewhere.example.net' },
        HEALTHY.named,
        HEALTHY.servedHere,
      ),
    ).toEqual(['queen: http://localhost:1633', 'other: https://elsewhere.example.net']);
  });

  it('takes a named address with or without its trailing slash, and nothing under it', () => {
    expect(unnamedAddresses({ chat: 'https://gateway.example.com/chat/' }, HEALTHY.named, [])).toEqual([]);
    expect(unnamedAddresses({ chat: 'https://gateway.example.com/chat/more' }, HEALTHY.named, [])).toEqual([
      'chat: https://gateway.example.com/chat/more',
    ]);
  });

  it('holds what is served from this machine to a local development host', () => {
    expect(unnamedAddresses({ evil: 'https://evil.example.net' }, HEALTHY.named, HEALTHY.servedHere)).toEqual([
      'evil: https://evil.example.net, which is served from this machine',
    ]);
  });
});

describe('judgeLiveGate', () => {
  it('passes a deployment where everything answers and the stream is listed', () => {
    expect(failed(HEALTHY)).toEqual([]);
  });

  it('refuses an address the target and config do not name, never one for not being local', () => {
    expect(failed({ ...HEALTHY, addresses: { ...HEALTHY.addresses, bee: 'https://bee.example.net' } })).toEqual([
      'named addresses',
    ]);
  });

  it('refuses a viewer, a config, a Swarm ID site or a gateway that does not answer', () => {
    expect(failed({ ...HEALTHY, viewer: 503 })).toEqual(['viewer']);
    expect(failed({ ...HEALTHY, viewer: null })).toEqual(['viewer']);
    expect(failed({ ...HEALTHY, config: 'chat.feedOwner: must be an Ethereum address' })).toEqual(['config']);
    expect(failed({ ...HEALTHY, swarmId: 404 })).toEqual(['swarm id']);
    expect(failed({ ...HEALTHY, catalogue: { status: 502, problem: 'answered 502', streams: 0 } })).toEqual([
      'gateway',
    ]);
  });

  it('refuses a stream that is not in the catalogue', () => {
    expect(failed({ ...HEALTHY, stream: { listed: false, state: null } })).toEqual(['stream']);
  });

  it('takes a chat that answers as Bee does, a feed with no message yet included, and refuses any other answer', () => {
    expect(failed({ ...HEALTHY, chat: { status: 200, beeAnswer: true } })).toEqual([]);
    expect(failed({ ...HEALTHY, chat: { status: 404, beeAnswer: false } })).toEqual(['chat']);
    expect(failed({ ...HEALTHY, chat: { status: 502, beeAnswer: true } })).toEqual(['chat']);
    expect(failed({ ...HEALTHY, chat: { status: null, beeAnswer: false } })).toEqual(['chat']);
  });
});

describe('namedAddresses', () => {
  const config = JSON.parse(readFileSync(join(KIT_DIR, 'test', 'fixtures', 'live-config.json'), 'utf8')) as unknown;
  const target = readTarget(join(KIT_DIR, 'targets', 'example.json'));

  it('names the target, every address of the config, and what the target allows besides', () => {
    expect(namedAddresses(liveDeployment(target, config))).toEqual([
      'https://viewer.example.com',
      'https://viewer.example.com/bee',
      'https://gateway.example.com/chat',
      'https://gateway.example.com/chat',
      'https://id.example.com',
      'https://ethereum-rpc.example.org',
      'http://127.0.0.1:4996',
    ]);
    const wider = parseTarget({ ...target, alsoAllowed: [{ origin: 'https://swarm.example.net', why: 'its reads' }] });
    expect(namedAddresses(liveDeployment(wider, config))).toContain('https://swarm.example.net');
  });
});
