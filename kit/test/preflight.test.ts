import { describe, expect, it } from 'vitest';

import { daemonCheck, judgePreflight, type PreflightReadings } from '../src/preflight.ts';

const HEALTHY: PreflightReadings = {
  addresses: { viewer: 'http://127.0.0.1:4180', bee: 'http://localhost:1633' },
  memoryBytes: 8 * 1024 ** 3,
  chainId: '0x64',
  bees: [
    { name: 'queen', ready: true, peers: 2 },
    { name: 'worker-1', ready: true, peers: 2 },
  ],
  stamps: [{ name: 'gateway', usable: true, usedFraction: 0.1 }],
  chatServer: { status: 200, heartbeatBack: true },
};

const failed = (readings: PreflightReadings) =>
  judgePreflight(readings)
    .filter((check) => !check.ok)
    .map((check) => check.name);

describe('judgePreflight', () => {
  it('refuses an Ethereum chain whose ENS lookup does not give the baked name', () => {
    const ens = { wallet: '0xab', expected: 'flowkit-alice.solarpunkid.eth' };
    expect(failed({ ...HEALTHY, ens: { ...ens, found: 'flowkit-alice.solarpunkid.eth' } })).toEqual([]);
    expect(failed({ ...HEALTHY, ens: { ...ens, found: null } })).toEqual(['ens']);
  });

  it('takes a daemon on a local socket or a loopback address, and refuses one elsewhere', () => {
    for (const host of ['unix:///var/run/docker.sock', 'npipe:////./pipe/docker_engine', 'tcp://127.0.0.1:2375']) {
      expect(failed({ ...HEALTHY, dockerHost: host }), host).toEqual([]);
    }
    for (const host of ['tcp://192.0.2.10:2376', 'ssh://builder@203.0.113.5', '']) {
      expect(failed({ ...HEALTHY, dockerHost: host }), host).toEqual(['docker daemon']);
    }
  });

  it('passes a healthy stack', () => {
    expect(failed(HEALTHY)).toEqual([]);
  });

  it('refuses a non-local address, too little memory and a chain that does not answer', () => {
    expect(
      failed({
        ...HEALTHY,
        addresses: { viewer: 'https://viewer.example.com' },
        memoryBytes: 1024 ** 3,
        chainId: null,
      }),
    ).toEqual(['local addresses', 'memory', 'chain']);
  });

  it('refuses a port another program holds, naming it', () => {
    const checks = judgePreflight({ ...HEALTHY, busyPorts: ['viewer 4180'] });
    expect(checks.filter((check) => !check.ok).map((check) => [check.name, check.detail])).toEqual([
      ['ports', 'held by another program: viewer 4180'],
    ]);
  });

  it('refuses a Bee that is not ready or is short of peers', () => {
    expect(
      failed({
        ...HEALTHY,
        bees: [
          { name: 'queen', ready: false, peers: 2 },
          { name: 'worker-1', ready: true, peers: 0 },
        ],
      }),
    ).toEqual(['bee queen', 'bee worker-1']);
  });

  it('refuses a stamp that is not usable or is past 80 percent, and an unhealthy chat server', () => {
    expect(
      failed({
        ...HEALTHY,
        stamps: [
          { name: 'gateway', usable: false, usedFraction: 0 },
          { name: 'server', usable: true, usedFraction: 0.8 },
        ],
        chatServer: { status: 503, heartbeatBack: true },
      }),
    ).toEqual(['stamp gateway', 'stamp server', 'chat server']);
  });

  it('refuses a chat server that answers healthy before any heartbeat came back through the inbox', () => {
    expect(failed({ ...HEALTHY, chatServer: { status: 200, heartbeatBack: false } })).toEqual(['chat server']);
  });

  it('holds an inbox stamp to being usable alone, since re-stamping the one inbox address keeps its bucket full', () => {
    expect(
      failed({
        ...HEALTHY,
        stamps: [
          { name: 'gateway', usable: true, usedFraction: 1, inbox: true },
          { name: 'inbox down', usable: false, usedFraction: 1, inbox: true },
        ],
      }),
    ).toEqual(['stamp inbox down']);
  });

  it('skips what is not read yet, so the same gate runs before and after the stack is up', () => {
    expect(failed({ addresses: HEALTHY.addresses, memoryBytes: HEALTHY.memoryBytes })).toEqual([]);
  });
});

describe('daemonCheck', () => {
  it('is the gate a command that only builds or runs containers asks, before it starts any', () => {
    expect(daemonCheck('unix:///var/run/docker.sock').ok).toBe(true);
    expect(daemonCheck('tcp://192.0.2.10:2376')).toMatchObject({ name: 'docker daemon', ok: false });
  });
});
