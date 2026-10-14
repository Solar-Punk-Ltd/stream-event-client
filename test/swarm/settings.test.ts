import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, type RuntimeConfig } from '../../src/config/runtimeConfig';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import { PROVIDER_KINDS } from '../../src/swarm/providerKinds';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';
import { Weeb3Provider } from '../../src/swarm/providers/weeb-3/weeb3Provider';
import { PROVIDER_REGISTRY } from '../../src/swarm/registry';
import { choiceForAddress, OWN_GATEWAY_ID, SINGLE_GATEWAY_ID, swarmSettingsFrom } from '../../src/swarm/settings';

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
  it('make a config that names only gatewayUrl one Bee gateway and the default', () => {
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee' }))).toEqual({
      gateways: [{ id: SINGLE_GATEWAY_ID, kind: 'bee-http', url: '/bee' }],
      defaultId: SINGLE_GATEWAY_ID,
      kinds: ['bee-http'],
      beeNodes: 'off',
    });
  });

  it('take the gateways, the default and the kinds from providers', () => {
    expect(swarmSettingsFrom(TWO_GATEWAYS)).toEqual({
      gateways: [
        { id: 'primary', kind: 'bee-http', label: 'Event gateway', url: PRIMARY },
        { id: 'backup', kind: 'bee-http', url: BACKUP },
      ],
      defaultId: 'primary',
      kinds: ['bee-http'],
      beeNodes: 'off',
    });
  });
});

describe('the node in this browser, weeb-3', () => {
  it('is not offered unless the deployment switches it on', () => {
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee' })).kinds).not.toContain('weeb-3');
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee', weeb3: { enabled: false } })).kinds).not.toContain('weeb-3');
  });

  it('is offered beside every other kind once switched on', () => {
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee', weeb3: { enabled: true } })).kinds).toEqual([
      'bee-http',
      'weeb-3',
    ]);
  });

  it('is offered once switched on even where providers narrows the kinds a viewer may add', () => {
    const narrowed = config({
      providers: { ...TWO_GATEWAYS.providers!, kinds: ['bee-http'] },
      weeb3: { enabled: true },
    });

    expect(swarmSettingsFrom(narrowed).kinds).toEqual(['bee-http', 'weeb-3']);
  });
});

describe('how far a Bee node of the viewer may be', () => {
  it('is this computer only when the config says nothing, as the viewer has always allowed', () => {
    expect(swarmSettingsFrom(config({ gatewayUrl: '/bee' })).beeNodes).toBe('off');
    expect(swarmSettingsFrom(TWO_GATEWAYS).beeNodes).toBe('off');
  });

  it('is what providers names', () => {
    expect(
      swarmSettingsFrom(config({ providers: { ...TWO_GATEWAYS.providers!, beeNodes: 'https-and-local-http' } }))
        .beeNodes,
    ).toBe('https-and-local-http');
  });
});

describe("the viewer's choice of gateway", () => {
  const settings = swarmSettingsFrom(TWO_GATEWAYS);

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

  it('makes a provider in this tab for weeb-3, and only weeb-3 brings its own player', () => {
    const provider = PROVIDER_REGISTRY['weeb-3'].create({ id: 'w', kind: 'weeb-3', url: '' }, {});

    expect(provider).toBeInstanceOf(Weeb3Provider);
    expect(provider.ownPlayer).toBeTypeOf('function');
    expect(
      PROVIDER_REGISTRY['bee-http'].create({ id: 'x', kind: 'bee-http', url: '/bee' }, {}).ownPlayer,
    ).toBeUndefined();
  });

  it('makes a Bee HTTP provider for a bee-http gateway', () => {
    const provider = PROVIDER_REGISTRY['bee-http'].create({ id: 'x', kind: 'bee-http', url: '/bee' }, {});

    expect(provider).toBeInstanceOf(BeeHttpProvider);
  });
});

describe('making the client from the settings', () => {
  it('reads from the default gateway alone, whatever it answers', async () => {
    const asked: string[] = [];
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      environment: { fetcher: primaryDownFetch(asked) },
    });

    const answer = await client.reader('player').readBytes(REFERENCE);

    expect(answer.kind).toBe('unavailable');
    expect(asked).toEqual([`${PRIMARY}/bytes/${REFERENCE}`]);
  });

  it("reads from the viewer's choice among the gateways offered", async () => {
    const asked: string[] = [];
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      choice: 'backup',
      environment: { fetcher: primaryDownFetch(asked) },
    });

    await client.reader('player').readBytes(REFERENCE);

    expect(asked).toEqual([`${BACKUP}/bytes/${REFERENCE}`]);
  });

  it('reads from the default when the choice names a gateway no longer offered', async () => {
    const asked: string[] = [];
    const client = createSwarmClient(swarmSettingsFrom(TWO_GATEWAYS), {
      choice: 'gone',
      environment: { fetcher: primaryDownFetch(asked) },
    });

    await client.reader('player').readBytes(REFERENCE);

    expect(asked).toEqual([`${PRIMARY}/bytes/${REFERENCE}`]);
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

  it("reads from a viewer's own node alone, never from the event gateway", async () => {
    const asked: string[] = [];
    const own = { id: 'own-node', kind: 'bee-http' as const, url: 'http://localhost:1633' };
    const client = createSwarmClient(swarmSettingsFrom(config({ gatewayUrl: PRIMARY })), {
      choice: own,
      environment: {
        fetcher: (async (input: RequestInfo | URL) => {
          asked.push(String(input));
          throw new TypeError('Failed to fetch');
        }) as typeof fetch,
      },
    });

    await client.reader('previews').readBytes(REFERENCE);

    expect(asked).toEqual([`http://localhost:1633/bytes/${REFERENCE}`]);
  });
});
