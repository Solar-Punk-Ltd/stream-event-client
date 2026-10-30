import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  chatSiteOrigins,
  CONFIG_URL,
  configProblemText,
  enabledChat,
  ensRpcUrl,
  experimentalEnabled,
  loadRuntimeConfig,
  parseRuntimeConfig,
  type RuntimeConfigResult,
  swarmIdUrl,
} from '../src/config/runtimeConfig';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const OWNER = '0x' + '1'.repeat(40);

const VALID = {
  gatewayUrl: '/bee',
  catalog: { owner: OWNER, topic: 'event-streams' },
};

const CHAT = {
  enabled: true,
  readUrl: 'http://localhost:1633',
  writeUrl: 'http://localhost:1733',
  gsocResourceId: 'a'.repeat(64),
  gsocTopic: 'chat',
  feedOwner: OWNER,
  pollIntervalMs: 500,
};

function problemOf(result: RuntimeConfigResult): string {
  if (result.ok) {
    throw new Error('expected the config to be refused');
  }
  return result.problem;
}

function answering(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe('checking the runtime config', () => {
  it('accepts a gateway path on this site, a feed owner and a topic', () => {
    const result = parseRuntimeConfig(VALID);

    expect(result).toEqual({ ok: true, config: VALID });
  });

  it('accepts an absolute http or https gateway', () => {
    for (const gatewayUrl of ['http://localhost:1633', 'https://gateway.example.com/']) {
      expect(parseRuntimeConfig({ ...VALID, gatewayUrl }).ok).toBe(true);
    }
  });

  it('accepts an owner written without the 0x prefix', () => {
    expect(parseRuntimeConfig({ ...VALID, catalog: { ...VALID.catalog, owner: '2'.repeat(40) } }).ok).toBe(true);
  });

  it('accepts a chat block, and no chat block at all', () => {
    expect(parseRuntimeConfig({ ...VALID, chat: CHAT }).ok).toBe(true);
    expect(parseRuntimeConfig(VALID).ok).toBe(true);
  });

  it('refuses a config that is not an object', () => {
    for (const raw of [null, 'config', 42, []]) {
      expect(parseRuntimeConfig(raw).ok).toBe(false);
    }
  });

  it('refuses a gateway that is neither a path on this site nor an http address', () => {
    for (const gatewayUrl of ['', 'bee', '//gateway.example.com', 'ftp://gateway.example.com', 'javascript:alert(1)']) {
      expect(problemOf(parseRuntimeConfig({ ...VALID, gatewayUrl }))).toContain('gatewayUrl');
    }
  });

  it('refuses an owner that is not an Ethereum address, naming the field', () => {
    for (const owner of ['', '0x1234', 'z'.repeat(40), '0x' + '1'.repeat(41)]) {
      expect(problemOf(parseRuntimeConfig({ ...VALID, catalog: { ...VALID.catalog, owner } }))).toContain(
        'catalog.owner',
      );
    }
  });

  it('refuses an empty topic, naming the field', () => {
    expect(problemOf(parseRuntimeConfig({ ...VALID, catalog: { ...VALID.catalog, topic: '' } }))).toContain(
      'catalog.topic',
    );
  });

  it('refuses a value still holding the example placeholder, and says so', () => {
    const problem = problemOf(
      parseRuntimeConfig({ ...VALID, catalog: { ...VALID.catalog, topic: '<stream list topic>' } }),
    );

    expect(problem).toContain('catalog.topic');
    expect(problem).toContain('placeholder');
  });

  it('refuses a missing catalog', () => {
    expect(problemOf(parseRuntimeConfig({ gatewayUrl: '/bee' }))).toContain('catalog');
  });

  it('refuses a chat block of the wrong shape, naming the field', () => {
    expect(problemOf(parseRuntimeConfig({ ...VALID, chat: { ...CHAT, pollIntervalMs: 'fast' } }))).toContain(
      'chat.pollIntervalMs',
    );
    expect(problemOf(parseRuntimeConfig({ ...VALID, chat: { ...CHAT, enabled: 'yes' } }))).toContain('chat.enabled');
  });
  it('names every field it refused, not only the first', () => {
    const problem = problemOf(parseRuntimeConfig({ gatewayUrl: '', catalog: { owner: '', topic: '' } }));

    expect(problem).toContain('gatewayUrl');
    expect(problem).toContain('catalog.owner');
    expect(problem).toContain('catalog.topic');
  });
});

describe('the chat settings', () => {
  const withChat = (chat: Record<string, unknown>) => parseRuntimeConfig({ ...VALID, chat: { ...CHAT, ...chat } });

  it('accepts a read and a write endpoint each on this site or at an http or https address', () => {
    for (const url of ['/chat-bee', 'http://localhost:1633', 'https://chat.example.com']) {
      expect(withChat({ readUrl: url }).ok).toBe(true);
      expect(withChat({ writeUrl: url }).ok).toBe(true);
    }
  });

  it('refuses the single chat.beeUrl of before, naming the two fields that replace it', () => {
    const problem = problemOf(withChat({ beeUrl: 'https://chat.example.com' }));
    expect(problem).toContain('chat.beeUrl');
    expect(problem).toContain('chat.readUrl');
    expect(problem).toContain('chat.writeUrl');
  });

  it('refuses a chat block with no write endpoint, naming it', () => {
    const { writeUrl: _, ...readOnly } = CHAT;
    expect(problemOf(parseRuntimeConfig({ ...VALID, chat: readOnly }))).toContain('chat.writeUrl');
  });

  it('refuses, when chat is on, a field still holding the example placeholder, naming it', () => {
    for (const field of ['readUrl', 'writeUrl', 'gsocResourceId', 'gsocTopic', 'feedOwner']) {
      const problem = problemOf(withChat({ [field]: '<example>' }));
      expect(problem).toContain(`chat.${field}`);
    }
  });

  it('refuses, when chat is on, an empty field, naming it', () => {
    for (const field of ['readUrl', 'writeUrl', 'gsocResourceId', 'gsocTopic', 'feedOwner']) {
      expect(problemOf(withChat({ [field]: '' }))).toContain(`chat.${field}`);
    }
  });

  it('refuses a chat endpoint that is neither a path on this site nor an http address', () => {
    for (const url of ['bee', '//chat.example.com', 'ftp://chat.example.com']) {
      expect(problemOf(withChat({ readUrl: url }))).toContain('chat.readUrl');
      expect(problemOf(withChat({ writeUrl: url }))).toContain('chat.writeUrl');
    }
  });

  it('refuses a feed owner that is not an Ethereum address', () => {
    expect(problemOf(withChat({ feedOwner: '0x1234' }))).toContain('chat.feedOwner');
  });

  it('refuses a GSOC key that is not 32 bytes of hex', () => {
    for (const gsocResourceId of ['abc', 'z'.repeat(64), 'a'.repeat(63)]) {
      expect(problemOf(withChat({ gsocResourceId }))).toContain('chat.gsocResourceId');
    }
    expect(withChat({ gsocResourceId: '0x' + 'b'.repeat(64) }).ok).toBe(true);
  });

  it('refuses a poll interval that is not a positive whole number of milliseconds', () => {
    for (const pollIntervalMs of [0, -500, 1.5, '500']) {
      expect(problemOf(withChat({ pollIntervalMs }))).toContain('chat.pollIntervalMs');
    }
  });

  it('refuses a chat block that is on but misses a field', () => {
    const { gsocTopic: _, ...missing } = CHAT;
    expect(problemOf(parseRuntimeConfig({ ...VALID, chat: missing }))).toContain('chat.gsocTopic');
  });

  it('accepts a chat block that is off whatever its other fields hold, placeholders included', () => {
    expect(
      parseRuntimeConfig({
        ...VALID,
        chat: { enabled: false, readUrl: '<chat reads>', beeUrl: '<old field>', feedOwner: '<owner>' },
      }).ok,
    ).toBe(true);
    expect(parseRuntimeConfig({ ...VALID, chat: { enabled: false } }).ok).toBe(true);
  });

  it('hands the chat settings on only when chat is on', () => {
    const on = parseRuntimeConfig({ ...VALID, chat: CHAT });
    const off = parseRuntimeConfig({ ...VALID, chat: { ...CHAT, enabled: false } });
    const absent = parseRuntimeConfig(VALID);

    expect(on.ok && enabledChat(on.config)).toEqual(CHAT);
    expect(off.ok && enabledChat(off.config)).toBeNull();
    expect(absent.ok && enabledChat(absent.config)).toBeNull();
  });
});

describe('the other sites that serve this chat', () => {
  const SITES = ['https://mirror.example.com', 'https://viewer.example.eth.limo', 'https://example.org:8443'];

  it('hands on the https origins a deployment lists, and none when it lists none or chat is off', () => {
    const listed = parseRuntimeConfig({ ...VALID, chat: { ...CHAT, siteOrigins: SITES } });
    const empty = parseRuntimeConfig({ ...VALID, chat: { ...CHAT, siteOrigins: [] } });
    const unset = parseRuntimeConfig({ ...VALID, chat: CHAT });
    const off = parseRuntimeConfig({ ...VALID, chat: { ...CHAT, enabled: false, siteOrigins: SITES } });

    expect(listed.ok && chatSiteOrigins(listed.config)).toEqual(SITES);
    expect(empty.ok && chatSiteOrigins(empty.config)).toEqual([]);
    expect(unset.ok && chatSiteOrigins(unset.config)).toEqual([]);
    expect(off.ok && chatSiteOrigins(off.config)).toEqual([]);
  });

  it('refuses an entry that is not a bare https origin as a browser writes it, naming the entry', () => {
    for (const site of [
      'http://mirror.example.com',
      'https://mirror.example.com/',
      'https://mirror.example.com/chat',
      'https://Mirror.example.com',
      'https://mirror.example.com:443',
      'https://user@mirror.example.com',
      'mirror.example.com',
      '',
      '<another site>',
    ]) {
      const problem = problemOf(parseRuntimeConfig({ ...VALID, chat: { ...CHAT, siteOrigins: [SITES[0], site] } }));
      expect(problem).toContain('chat.siteOrigins.1');
    }
  });

  it('refuses a site listed twice, naming the second', () => {
    const siteOrigins = [SITES[0], SITES[1], SITES[0]];
    const problem = problemOf(parseRuntimeConfig({ ...VALID, chat: { ...CHAT, siteOrigins } }));
    expect(problem).toContain('chat.siteOrigins.2: is listed twice');
  });

  it('refuses a single site not written as a list', () => {
    expect(problemOf(parseRuntimeConfig({ ...VALID, chat: { ...CHAT, siteOrigins: SITES[0] } }))).toContain(
      'chat.siteOrigins',
    );
  });
});

describe('the Swarm ID setting', () => {
  it('accepts the Swarm ID site as an http or https origin, and no setting at all', () => {
    for (const url of ['https://id.example.com', 'https://id.example.com:8443', 'http://localhost:5500']) {
      expect(parseRuntimeConfig({ ...VALID, chat: CHAT, swarmId: { url } }).ok).toBe(true);
    }
    expect(parseRuntimeConfig({ ...VALID, chat: CHAT }).ok).toBe(true);
  });

  it('refuses an address with a path, a trailing slash or another scheme, naming the field', () => {
    for (const url of ['https://id.example.com/', 'https://id.example.com/proxy', 'id.example.com', 'wss://id.x']) {
      expect(problemOf(parseRuntimeConfig({ ...VALID, chat: CHAT, swarmId: { url } }))).toContain('swarmId.url');
    }
  });

  it('refuses the example placeholder', () => {
    const swarmId = { url: '<Swarm ID site>' };
    expect(problemOf(parseRuntimeConfig({ ...VALID, chat: CHAT, swarmId }))).toContain('placeholder');
  });

  it('offers Swarm ID only beside a chat that is on, since it signs chat messages and nothing else', () => {
    const swarmId = { url: 'https://id.example.com' };
    const on = parseRuntimeConfig({ ...VALID, chat: CHAT, swarmId });
    const off = parseRuntimeConfig({ ...VALID, chat: { ...CHAT, enabled: false }, swarmId });
    const unset = parseRuntimeConfig({ ...VALID, chat: CHAT });

    expect(on.ok && swarmIdUrl(on.config)).toBe('https://id.example.com');
    expect(off.ok && swarmIdUrl(off.config)).toBeNull();
    expect(unset.ok && swarmIdUrl(unset.config)).toBeNull();
  });
});

describe('the experimental setting', () => {
  it('is on unless set, and a deployment may turn it off', () => {
    const unset = parseRuntimeConfig(VALID);
    const on = parseRuntimeConfig({ ...VALID, experimental: true });
    const off = parseRuntimeConfig({ ...VALID, experimental: false });

    expect(unset.ok && experimentalEnabled(unset.config)).toBe(true);
    expect(on.ok && experimentalEnabled(on.config)).toBe(true);
    expect(off.ok && experimentalEnabled(off.config)).toBe(false);
  });

  it('refuses anything but true or false, naming the field', () => {
    for (const experimental of ['false', 0, null, {}]) {
      expect(problemOf(parseRuntimeConfig({ ...VALID, experimental }))).toBe('experimental: must be true or false');
    }
  });

  it('turned off, offers no Swarm ID even where the deployment names one', () => {
    const swarmId = { url: 'https://id.example.com' };
    const off = parseRuntimeConfig({ ...VALID, chat: CHAT, swarmId, experimental: false });

    expect(off.ok && swarmIdUrl(off.config)).toBeNull();
  });
});

describe('the ENS endpoint setting', () => {
  const ENDPOINT = 'https://ethereum-rpc.example.org';

  it('accepts an https address, with a path, http on a local development host, and no setting at all', () => {
    for (const url of [
      ENDPOINT,
      'https://ethereum-rpc.example.org/v1/mainnet',
      'https://ethereum-rpc.example.org:8443',
      'http://localhost:8545',
      'http://127.0.0.1:8545',
      'http://[::1]:8545',
      'http://node.localhost:8545',
    ]) {
      expect(parseRuntimeConfig({ ...VALID, chat: CHAT, ensRpcUrl: url }).ok).toBe(true);
    }
    expect(parseRuntimeConfig({ ...VALID, chat: CHAT }).ok).toBe(true);
  });

  it('refuses a path on this site, another scheme, plain http elsewhere, a malformed address, an empty value and the example placeholder, naming the field', () => {
    for (const url of [
      '/eth',
      'wss://ethereum-rpc.example.org',
      'ethereum-rpc.example.org',
      '',
      '<ENS endpoint>',
      'http://ethereum-rpc.example.org',
      'http://192.0.2.10:8545',
      'http://localhost.example.org',
      'https://ethereum rpc.example.org',
      'https://user:secret@ethereum-rpc.example.org',
      'https://',
    ]) {
      expect(problemOf(parseRuntimeConfig({ ...VALID, chat: CHAT, ensRpcUrl: url }))).toContain('ensRpcUrl');
    }
  });

  it('looks names up only beside a chat that is on, since only chat messages show them', () => {
    const on = parseRuntimeConfig({ ...VALID, chat: CHAT, ensRpcUrl: ENDPOINT });
    const off = parseRuntimeConfig({ ...VALID, chat: { ...CHAT, enabled: false }, ensRpcUrl: ENDPOINT });
    const unset = parseRuntimeConfig({ ...VALID, chat: CHAT });

    expect(on.ok && ensRpcUrl(on.config)).toBe(ENDPOINT);
    expect(off.ok && ensRpcUrl(off.config)).toBeNull();
    expect(unset.ok && ensRpcUrl(unset.config)).toBeNull();
  });
});

describe('weeb-3', () => {
  it('reads no weeb3 block a deployment still writes, since the page offers weeb-3 everywhere', () => {
    const result = parseRuntimeConfig({ ...VALID, weeb3: { enabled: 'yes' } });

    expect(result.ok && 'weeb3' in result.config).toBe(false);
  });

  it('refuses weeb-3 among the gateways a deployment offers, since a viewer adds it in their own browser', () => {
    const { gatewayUrl: _left, ...withoutGateway } = VALID;
    const providers = { gateways: [{ id: 'w', kind: 'weeb-3', url: '/weeb-3' }], default: 'w' };

    expect(problemOf(parseRuntimeConfig({ ...withoutGateway, providers }))).toContain('must be one of bee-http');
  });
});

describe('the providers settings', () => {
  const EVENT = { id: 'event', kind: 'bee-http', label: 'Event gateway', url: '/bee' };
  const BACKUP = { id: 'backup', kind: 'bee-http', url: 'https://backup.example.com' };
  const PROVIDERS = { gateways: [EVENT, BACKUP], default: 'event' };
  const { gatewayUrl: _left, ...WITHOUT_GATEWAY } = VALID;
  const withProviders = (providers: Record<string, unknown>) =>
    parseRuntimeConfig({ ...WITHOUT_GATEWAY, providers: { ...PROVIDERS, ...providers } });

  it('accepts the gateways offered and the default', () => {
    const result = withProviders({});

    expect(result).toEqual({ ok: true, config: { ...WITHOUT_GATEWAY, providers: PROVIDERS } });
  });

  it('leaves gatewayUrl out of a config that names providers, since nothing reads it there', () => {
    const result = withProviders({ default: 'backup' });

    expect(result.ok && 'gatewayUrl' in result.config).toBe(false);
  });

  it('refuses gatewayUrl beside providers, which replaces it', () => {
    expect(problemOf(parseRuntimeConfig({ ...VALID, providers: PROVIDERS }))).toContain('providers');
  });

  it('refuses a config with neither, naming gatewayUrl', () => {
    expect(problemOf(parseRuntimeConfig(WITHOUT_GATEWAY))).toContain('gatewayUrl');
  });

  it('refuses a default that names no gateway offered', () => {
    expect(problemOf(withProviders({ default: 'elsewhere' }))).toContain('providers.default');
  });

  it('reads no fallback a deployment still names, since nothing switches source by itself', () => {
    const result = withProviders({ fallback: 'backup' });

    expect(result.ok && 'fallback' in (result.config.providers ?? {})).toBe(false);
  });

  it('refuses two gateways under one id', () => {
    expect(problemOf(withProviders({ gateways: [EVENT, { ...BACKUP, id: 'event' }] }))).toContain(
      'providers.gateways.1.id',
    );
  });

  it('refuses no gateways at all', () => {
    expect(problemOf(withProviders({ gateways: [] }))).toContain('providers.gateways');
  });

  it('refuses a gateway of a kind this build does not carry', () => {
    expect(problemOf(withProviders({ gateways: [{ ...EVENT, kind: 'ipfs' }] }))).toContain('providers.gateways.0');
  });

  it('reads no kinds and no Bee node level a deployment still writes, since the page decides what it offers', () => {
    const result = withProviders({ kinds: ['bee-http'], beeNodes: 'https' });

    expect(result.ok && result.config.providers).toEqual(PROVIDERS);
  });

  it("refuses a gateway's address as gatewayUrl is refused, placeholder included", () => {
    for (const url of ['bee', '//gateway.example.com', '<the event gateway>']) {
      expect(problemOf(withProviders({ gateways: [{ ...EVENT, url }] }))).toContain('providers.gateways.0.url');
    }
  });
});

describe('the example config the repository ships', () => {
  const example = JSON.parse(readFileSync(join(ROOT, 'public', 'config.json'), 'utf8')) as unknown;

  it('is refused until its placeholders are filled in, so it can never pass for a real deployment', () => {
    expect(problemOf(parseRuntimeConfig(example))).toContain('placeholder');
  });

  it('ships the chat off', () => {
    expect((example as { chat?: { enabled?: unknown } }).chat?.enabled).toBe(false);
  });

  it('is valid once the placeholders are filled in', () => {
    const filled = JSON.parse(
      JSON.stringify(example)
        .replace(/"<[^"]*owner[^"]*>"/g, JSON.stringify(OWNER))
        .replace(/"<[^"]*>"/g, '"a-value"'),
    ) as unknown;

    expect(parseRuntimeConfig(filled).ok).toBe(true);
  });
});

describe('loading the runtime config', () => {
  it('reads it from beside the page', () => {
    expect(CONFIG_URL).toBe('./config.json');
  });

  it('asks for it uncached', async () => {
    let asked: RequestInit | undefined;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      asked = init;
      return new Response(JSON.stringify(VALID));
    }) as typeof fetch;

    await loadRuntimeConfig(fetchFn);

    expect(asked?.cache).toBe('no-store');
  });

  it('hands back the checked config', async () => {
    expect(await loadRuntimeConfig(answering(JSON.stringify(VALID)))).toEqual({ ok: true, config: VALID });
  });

  it('says so when the page cannot reach it', async () => {
    const unreachable = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    expect(problemOf(await loadRuntimeConfig(unreachable))).toContain('could not be read');
  });

  it('says so when the server answers with an error, naming the status', async () => {
    expect(problemOf(await loadRuntimeConfig(answering('not here', 404)))).toContain('404');
  });

  it('says so when it is not JSON', async () => {
    expect(problemOf(await loadRuntimeConfig(answering('<!doctype html><html></html>')))).toContain('not JSON');
  });

  it('says so when it does not pass the check', async () => {
    expect(problemOf(await loadRuntimeConfig(answering(JSON.stringify({ gatewayUrl: '/bee' }))))).toContain('catalog');
  });
});

describe('the text a page shows when it has no config', () => {
  it('says the page cannot start and why, instead of showing an empty list', () => {
    const text = configProblemText({ ok: false, problem: 'catalog.owner: not an address' });

    expect(text.title).toMatch(/cannot start/i);
    expect(text.detail).toContain('catalog.owner: not an address');
    expect(text.hint).toContain('config.json');
  });
});
