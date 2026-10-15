import { Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from '../../src/config/runtimeConfig';
import { onlyGateway } from '../../src/features/gateway/gatewayProbe';
import { statusRows } from '../../src/features/gateway/providerStatus';
import { reportText } from '../../src/features/gateway/report';
import { runSourceChecks } from '../../src/features/gateway/sourceChecks';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import { gatewayName, swarmSettingsFrom } from '../../src/swarm/settings';
import { allSources, sourceName } from '../../src/swarm/sources';

const EVENT = 'https://event.example.com';
const BACKUP = 'https://backup.example.com';
const CHAT_READ = 'https://chat-read.example.com';
const CHAT_WRITE = 'https://chat-write.example.com';
/** The node a viewer saved in their browser, which is theirs and must not travel in a report of another. */
const SAVED_OWN_NODE = 'http://localhost:1633';
const KEY = 'd'.repeat(64);
const CATALOG_OWNER = '0x' + '1'.repeat(40);

const parsed = parseRuntimeConfig({
  catalog: { owner: CATALOG_OWNER, topic: 'event-streams' },
  providers: {
    gateways: [
      { id: 'event', kind: 'bee-http', label: 'Event gateway', url: EVENT },
      { id: 'backup', kind: 'bee-http', url: BACKUP },
    ],
    default: 'event',
  },
  chat: {
    enabled: true,
    readUrl: CHAT_READ,
    writeUrl: CHAT_WRITE,
    gsocResourceId: KEY,
    gsocTopic: 'the-inbox',
    feedOwner: '0x' + 'b'.repeat(40),
    pollIntervalMs: 500,
  },
});
if (!parsed.ok) {
  throw new Error('the test config does not parse');
}
const config = parsed.config;
const settings = swarmSettingsFrom(config);
const OWN_NODE = { id: 'added-1', type: 'bee-node' as const, name: 'My Bee node', url: SAVED_OWN_NODE };
const sources = allSources(settings, [OWN_NODE]);

/** Answers every request with a 502, so the report carries a failure. */
const failing = (async () => new Response('', { status: 502 })) as typeof fetch;

async function reportOfBackup(): Promise<string> {
  // The app's own client, on the viewer's own node, with the chat history read at the chat read address.
  const inUse = createSwarmClient(settings, {
    choice: { id: OWN_NODE.id, kind: 'bee-http', url: SAVED_OWN_NODE },
    routes: { chat: { id: 'event', kind: 'bee-http', url: CHAT_READ } },
    environment: { fetcher: failing },
  });
  await inUse.reader('player').readBytes('ab'.repeat(32));
  await inUse.reader('chat').readChunk('cd'.repeat(32));
  await inUse.reader('stream-list').readFeedHead(CATALOG_OWNER, Topic.fromString('event-streams'));

  const backup = settings.gateways.find(({ id }) => id === 'backup')!;
  const results = await runSourceChecks(
    { type: 'gateway', url: backup.url },
    {
      client: createSwarmClient(onlyGateway(backup), { environment: { fetcher: failing } }),
      catalog: config.catalog,
      knownStreams: [],
      pageOrigin: 'https://viewer.example.com',
      pageProtocol: 'https:',
      localNetworkRequests: false,
    },
  );

  return reportText({
    tested: { name: gatewayName(settings, backup.id), address: backup.url, type: 'gateway', results },
    status: statusRows(inUse.activity(), (id) => sourceName(sources, id)),
    build: 'stream-event-client 0.1.0, built 2026-10-07T00:00:00.000Z',
    browser: 'Mozilla/5.0 (test)',
    atMs: Date.UTC(2026, 9, 7, 12),
  });
}

describe('the diagnostics a viewer copies', () => {
  it('holds the checks, the status, the build and the browser', async () => {
    const report = await reportOfBackup();

    expect(report).toContain('Checks of Gateway backup (https://backup.example.com)');
    expect(report).toContain('Answers over https: passed');
    expect(report).toContain('Reads a chunk: failed. It answers with an error (HTTP 502).');
    expect(report).toContain("Reads this event's stream list: not run, an earlier check failed.");
    expect(report).toContain('Chat: Reads from Event gateway.');
    expect(report).toContain('Video: Reads from My Bee node.');
    expect(report).toContain('Build: stream-event-client 0.1.0');
    expect(report).toContain('Browser: Mozilla/5.0 (test)');
  });

  it('holds no address but the checked source, no key and nothing from the viewer’s saved node', async () => {
    const report = await reportOfBackup();

    for (const kept of [EVENT, CHAT_READ, CHAT_WRITE, SAVED_OWN_NODE, 'localhost', KEY]) {
      expect(report).not.toContain(kept);
    }
    expect(report.match(/[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi)).toEqual([BACKUP]);
    expect(report).not.toMatch(/[0-9a-f]{40}/i);
  });

  it('says when no source was checked', () => {
    expect(reportText({ tested: null, status: [], build: 'b', browser: 'x', atMs: 0 })).toContain(
      'No source was checked.',
    );
  });
});
