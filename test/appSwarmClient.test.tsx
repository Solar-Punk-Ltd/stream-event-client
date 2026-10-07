// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppContextProvider, useAppContext } from '../src/app/AppProvider';
import { parseRuntimeConfig, type RuntimeConfig } from '../src/config/runtimeConfig';
import { gatewayClock } from '../src/shared/gatewayClock';
import type { SwarmClient } from '../src/swarm/client';
import { mount, settle, type Mounted } from './helpers/dom';

const OWNER = '0x' + '1'.repeat(40);
const REFERENCE = 'ef'.repeat(32);
const EVENT_GATEWAY = 'https://event.example.com';
const BACKUP_GATEWAY = 'https://backup.example.com';
const OWN_NODE = 'http://localhost:1633';
/** Where a viewer's chosen gateway survives a reload, as the provider keeps it. */
const GATEWAY_STORAGE_KEY = 'swarm-gateway-url';

function config(): RuntimeConfig {
  const result = parseRuntimeConfig({
    catalog: { owner: OWNER, topic: 'event-streams' },
    providers: {
      gateways: [
        { id: 'event', kind: 'bee-http', url: EVENT_GATEWAY },
        { id: 'backup', kind: 'bee-http', url: BACKUP_GATEWAY },
      ],
      default: 'event',
      fallback: 'backup',
    },
  });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return result.config;
}

type Context = ReturnType<typeof useAppContext>;

const realFetch = globalThis.fetch;
let asked: string[];
/** The `Date` every answer carries. */
let serverDate: string;
let mounted: Mounted | null = null;
let context: Context | null = null;

function Probe() {
  context = useAppContext();
  return null;
}

function start(): Context {
  mounted = mount(createElement(AppContextProvider, { config: config(), children: createElement(Probe) }));
  return context!;
}

const current = (): Context => context!;

async function readThrough(swarm: SwarmClient): Promise<string> {
  const before = asked.length;
  await swarm.reader('previews').readBytes(REFERENCE);
  return asked.slice(before).join(' ');
}

describe("the app's Swarm client", () => {
  beforeEach(() => {
    asked = [];
    serverDate = 'Wed, 30 Sep 2026 07:16:57 GMT';
    localStorage.clear();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response('', { status: 404, headers: { date: serverDate } });
    }) as typeof fetch;
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    context = null;
    globalThis.fetch = realFetch;
  });

  it('is made once at start from the config, reading the default gateway', async () => {
    const { swarm } = start();
    await settle();

    expect(current().swarm).toBe(swarm);
    expect(await readThrough(swarm)).toBe(`${EVENT_GATEWAY}/bytes/${REFERENCE}`);
    expect(current().gatewayUrl).toBe(EVENT_GATEWAY);
    expect(current().defaultGatewayUrl).toBe(EVENT_GATEWAY);
  });

  it("starts on the viewer's saved choice", async () => {
    localStorage.setItem(GATEWAY_STORAGE_KEY, OWN_NODE);
    const { swarm } = start();
    await settle();

    expect(await readThrough(swarm)).toBe(`${OWN_NODE}/bytes/${REFERENCE}`);
  });

  it('is rebuilt on the node the viewer picks, and back on the event gateway', async () => {
    start();
    await settle();

    current().setGatewayUrl(OWN_NODE);
    await settle();
    expect(await readThrough(current().swarm)).toBe(`${OWN_NODE}/bytes/${REFERENCE}`);

    current().setGatewayUrl(current().defaultGatewayUrl);
    await settle();
    expect(await readThrough(current().swarm)).toBe(`${EVENT_GATEWAY}/bytes/${REFERENCE}`);
  });

  it("keeps the shared gateway clock from every answer's server time", async () => {
    const { swarm } = start();
    await settle();
    const before = gatewayClock.offsetMs();

    serverDate = 'Thu, 01 Jan 2099 00:00:00 GMT';
    await swarm.reader('previews').readBytes(REFERENCE);

    expect(gatewayClock.offsetMs()).toBeGreaterThan(before);
  });
});
