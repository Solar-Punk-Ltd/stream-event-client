import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import { PROVIDER_KINDS } from '../../src/swarm/providerKinds';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';
import { PROVIDER_REGISTRY } from '../../src/swarm/registry';
import { SINGLE_GATEWAY_ID, swarmSettingsFrom } from '../../src/swarm/settings';

const OWNER = '0x' + '1'.repeat(40);
const CATALOG = { owner: OWNER, topic: 'event-streams' };
const REFERENCE = 'ef'.repeat(32);

const PRIMARY = 'https://primary.example.com';
const BACKUP = 'https://backup.example.com';

function config(raw: Record<string, unknown>): RuntimeConfig {
  const result = parseRuntimeConfig({ catalog: CATALOG, ...raw });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return result.config;
}

const TWO_GATEWAYS = config({
  providers: {
    gateways: [
      { id: 'primary', kind: 'bee-http', label: 'Event gateway', url: PRIMARY },
      { id: 'backup', kind: 'bee-http', url: BACKUP },
    ],
    default: 'primary',
    fallback: 'backup',
  },
});

/** Every read of the primary fails and every read of the backup is served, and both are logged. */
function primaryDownFetch(asked: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.startsWith(PRIMARY)) {
      throw new TypeError('Failed to fetch');
    }
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
}

describe('the Swarm settings', () => {
  it('make a config that names only gatewayUrl one Bee gateway, the default, with no fallback', () => {
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee' }))).toEqual({
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: '/bee' }],
      defaultId: SINGLE_GATEWAY_ID,
      fallbackId: null,
      kinds: [...PROVIDER_KINDS],
    });
  });

  it('take the gateways, the default, the fallback and the kinds from providers', () => {
    expect(swarmSettingsFrom(TWO_GATEWAYS)).toEqual({
      gateways: [
        { id: 'primary', kind: 'bee-http', label: 'Event gateway', url: PRIMARY },
        { id: 'backup', kind: 'bee-http', url: BACKUP },
      ],
      defaultId: 'primary',
      fallbackId: 'backup',
      kinds: [...PROVIDER_KINDS],
    });
  });
});

describe('the registry of provider kinds', () => {
  it('has a label and a maker for every kind a config may name', () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual([...PROVIDER_KINDS].sort());
    for (const kind of PROVIDER_KINDS) {
      expect(PROVIDER_REGISTRY[kind].label).not.toBe('');
    }
  });

  it('makes a Bee HTTP provider for a bee-http gateway', () => {
    const provider = PROVIDER_REGISTRY['bee-http'].create({ id: 'x', kind: 'bee-http', url: '/bee' }, {});

    expect(provider).toBeInstanceOf(BeeHttpProvider);
  });
});

describe('making the client from the settings', () => {
  it('reads from the default gateway, and from the fallback when the default fails', async () => {
    const asked: string[] = [];
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      environment: { fetcher: primaryDownFetch(asked) },
    });

    const answer = await client.reader('player').readBytes(REFERENCE);

    expect(answer.kind).toBe('content');
    expect(asked).toEqual([`${PRIMARY}/bytes/${REFERENCE}`, `${BACKUP}/bytes/${REFERENCE}`]);
    expect(client.health().map(({ id }) => id)).toEqual(['primary', 'backup']);
  });

  it("reads from the viewer's choice among the gateways offered", async () => {
    const asked: string[] = [];
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      choice: 'backup',
      environment: { fetcher: primaryDownFetch(asked) },
    });

    await client.reader('player').readBytes(REFERENCE);

    expect(asked).toEqual([`${BACKUP}/bytes/${REFERENCE}`]);
    expect(client.health().map(({ id }) => id)).toEqual(['backup']);
  });

  it('reads from the default when the choice names a gateway no longer offered', async () => {
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), { choice: 'gone' });

    expect(client.health().map(({ id }) => id)).toEqual(['primary', 'backup']);
  });

  it("reads from a viewer's own gateway, with the deployment's fallback behind it", async () => {
    const asked: string[] = [];
    const own = { id: 'own-node', kind: 'bee-http' as const, url: 'http://localhost:1633' };
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      choice: own,
      environment: { fetcher: primaryDownFetch(asked) },
    });

    await client.reader('previews').readBytes(REFERENCE);

    expect(asked).toEqual([`http://localhost:1633/bytes/${REFERENCE}`]);
    expect(client.health().map(({ id }) => id)).toEqual(['own-node', 'backup']);
  });
});
