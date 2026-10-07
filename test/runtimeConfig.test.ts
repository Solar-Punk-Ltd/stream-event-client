import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_URL,
  configProblemText,
  enabledChat,
  loadRuntimeConfig,
  parseRuntimeConfig,
  type RuntimeConfigResult,
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

describe('the providers settings', () => {
  const EVENT = { id: 'event', kind: 'bee-http', label: 'Event gateway', url: '/bee' };
  const BACKUP = { id: 'backup', kind: 'bee-http', url: 'https://backup.example.com' };
  const PROVIDERS = { gateways: [EVENT, BACKUP], default: 'event', fallback: 'backup', kinds: ['bee-http'] };
  const { gatewayUrl: _left, ...WITHOUT_GATEWAY } = VALID;
  const withProviders = (providers: Record<string, unknown>) =>
    parseRuntimeConfig({ ...WITHOUT_GATEWAY, providers: { ...PROVIDERS, ...providers } });

  it('accepts the gateways offered, the default, the fallback and the kinds offered', () => {
    const result = withProviders({});

    expect(result).toEqual({ ok: true, config: { ...WITHOUT_GATEWAY, providers: PROVIDERS } });
  });

  it('leaves gatewayUrl out of a config that names providers, since nothing reads it there', () => {
    const result = withProviders({ default: 'backup', fallback: 'event' });

    expect(result.ok && 'gatewayUrl' in result.config).toBe(false);
  });

  it('accepts no fallback and no list of kinds', () => {
    const { fallback: _fallback, kinds: _kinds, ...bare } = PROVIDERS;

    expect(parseRuntimeConfig({ ...WITHOUT_GATEWAY, providers: bare }).ok).toBe(true);
  });

  it('refuses gatewayUrl beside providers, which replaces it', () => {
    expect(problemOf(parseRuntimeConfig({ ...VALID, providers: PROVIDERS }))).toContain('providers');
  });

  it('refuses a config with neither, naming gatewayUrl', () => {
    expect(problemOf(parseRuntimeConfig(WITHOUT_GATEWAY))).toContain('gatewayUrl');
  });

  it('refuses a default or a fallback that names no gateway offered', () => {
    expect(problemOf(withProviders({ default: 'elsewhere' }))).toContain('providers.default');
    expect(problemOf(withProviders({ fallback: 'elsewhere' }))).toContain('providers.fallback');
  });

  it('refuses a fallback that is the default', () => {
    expect(problemOf(withProviders({ fallback: 'event' }))).toContain('providers.fallback');
  });

  it('refuses two gateways under one id', () => {
    expect(problemOf(withProviders({ gateways: [EVENT, { ...BACKUP, id: 'event' }] }))).toContain(
      'providers.gateways.1.id',
    );
  });

  it('refuses no gateways at all', () => {
    expect(problemOf(withProviders({ gateways: [] }))).toContain('providers.gateways');
  });

  it('refuses a kind this build does not carry, in a gateway and in the kinds offered', () => {
    expect(problemOf(withProviders({ gateways: [{ ...EVENT, kind: 'ipfs' }] }))).toContain('providers.gateways.0');
    expect(problemOf(withProviders({ kinds: ['ipfs'] }))).toContain('providers.kinds');
  });

  it("refuses a gateway's address as gatewayUrl is refused, placeholder included", () => {
    for (const url of ['bee', '//gateway.example.com', '<the event gateway>']) {
      expect(problemOf(withProviders({ gateways: [{ ...EVENT, url }], fallback: undefined }))).toContain(
        'providers.gateways.0.url',
      );
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
