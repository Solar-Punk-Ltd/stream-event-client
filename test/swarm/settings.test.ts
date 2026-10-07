import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import { PROVIDER_KINDS } from '../../src/swarm/providerKinds';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';
import { PROVIDER_REGISTRY } from '../../src/swarm/registry';
import {
  choiceForAddress,
  defaultGateway,
  OWN_GATEWAY_ID,
  SINGLE_GATEWAY_ID,
  swarmSettingsFrom,
} from '../../src/swarm/settings';

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
  it('make a config that names only gatewayUrl one Bee gateway, the default and the fallback', () => {
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee' }))).toEqual({
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: '/bee' }],
      defaultId: SINGLE_GATEWAY_ID,
      fallbackId: SINGLE_GATEWAY_ID,
      kinds: [...PROVIDER_KINDS],
    });
  });

  it('make the default gateway the fallback when providers names none', () => {
    const { fallback: _named, ...providers } = TWO_GATEWAYS.providers!;

    expect(swarmSettingsFrom(config({ providers })).fallbackId).toBe('primary');
  });

  it('have no fallback when providers switches it off', () => {
    expect(swarmSettingsFrom(config({ providers: { ...TWO_GATEWAYS.providers!, fallback: false } })).fallbackId).toBe(
      null,
    );
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

describe("the viewer's choice of gateway", () => {
  const settings = swarmSettingsFrom(TWO_GATEWAYS);

  it('is the default gateway until the viewer picks another', () => {
    expect(defaultGateway(settings)).toEqual({ id: 'primary', kind: 'bee-http', label: 'Event gateway', url: PRIMARY });
  });

  it('names an offered gateway by its address, a trailing slash either side', () => {
    expect(choiceForAddress(settings, `${BACKUP}/`)).toEqual({ id: 'backup', kind: 'bee-http', url: BACKUP });
  });

  it("is the viewer's own Bee node for an address the settings do not offer", () => {
    expect(choiceForAddress(settings, 'http://localhost:1633')).toEqual({
      id: OWN_GATEWAY_ID,
      kind: 'bee-http',
      url: 'http://localhost:1633',
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
    expect(client.health().map(({ id }) => id)).toEqual(['backup', 'primary']);
  });

  it('reads from the default when the choice names a gateway no longer offered', async () => {
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), { choice: 'gone' });

    expect(client.health().map(({ id }) => id)).toEqual(['primary', 'backup']);
  });

  it("reads a feature from the gateway its route names, every other feature from the viewer's choice", async () => {
    const asked: string[] = [];
    const chatRead = { id: 'chat-read', kind: 'bee-http' as const, url: 'https://chat-read.example.com' };
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      choice: 'backup',
      routes: { chat: chatRead },
      environment: { fetcher: primaryDownFetch(asked) },
    });

    await client.reader('chat').readChunk(REFERENCE);
    await client.reader('player').readBytes(REFERENCE);

    expect(asked).toEqual([`https://chat-read.example.com/chunks/${REFERENCE}`, `${BACKUP}/bytes/${REFERENCE}`]);
  });

  it("reads from a viewer's own node with the event gateway behind it, for a config naming only gatewayUrl", async () => {
    const own = { id: 'own-node', kind: 'bee-http' as const, url: 'http://localhost:1633' };
    const client = createSwarmClient(swarmSettingsFrom(config({ gatewayUrl: PRIMARY })), { choice: own });

    expect(client.health().map(({ id }) => id)).toEqual(['own-node', SINGLE_GATEWAY_ID]);
  });

  it('has nothing behind the event gateway when the viewer is on it and the config names no other', () => {
    const client = createSwarmClient(swarmSettingsFrom(config({ gatewayUrl: PRIMARY })));

    expect(client.health().map(({ id }) => id)).toEqual([SINGLE_GATEWAY_ID]);
  });

  it('puts the event gateway behind a viewer who picked the fallback gateway itself', () => {
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), { choice: 'backup' });

    expect(client.health().map(({ id }) => id)).toEqual(['backup', 'primary']);
  });

  it('has no fallback behind any choice when the config switches it off', () => {
    const settings = swarmSettingsFrom(config({ providers: { ...TWO_GATEWAYS.providers!, fallback: false } }));
    const own = { id: 'own-node', kind: 'bee-http' as const, url: 'http://localhost:1633' };

    expect(
      createSwarmClient(settings, { choice: own })
        .health()
        .map(({ id }) => id),
    ).toEqual(['own-node']);
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
