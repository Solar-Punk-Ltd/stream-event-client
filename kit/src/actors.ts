import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { type Addresses, isLocalRequest } from './addresses.ts';
import type { ActorSettings } from './scenario.ts';
import { UntracedSegments } from './untraced.ts';
import { exposeWallet, type TestWallet } from './wallet.ts';

/** The name the page's message recorder keeps what the viewer's window was sent under. */
const RECEIVED = '__flowKitReceived';

/**
 * One person in a scenario: a browser context of their own, so their storage is theirs alone, recorded whole. The
 * password is made for this run and lives in memory only.
 */
export interface Actor {
  name: string;
  context: BrowserContext;
  /** The viewer's page, once a verb opened it. */
  viewer: Page | null;
  /** A first-party page of Swarm ID, where the account lives. */
  idPage: Page | null;
  /** The hostile site's page in this actor's context, once a security verb opened it. */
  evilPage: Page | null;
  password: string;
  /** The actor's wallet once an account secured with one is made, held in memory only. */
  wallet: TestWallet | null;
  /** How the actor chats in the viewer: as a guest, signed in with Swarm ID, or not at all. */
  session: 'guest' | 'swarm-id' | null;
  /** The name the viewer shows for the actor once they chat, read from its banner. */
  chatName: string | null;
  dir: string;
  /** Every request the browser guard stopped because it was going to a host off this machine, in order. */
  blocked: string[];
  /** Runs `step` with the trace paused, for a step that shows a secret or hands one back from the page. */
  untraced<T>(step: () => Promise<T>): Promise<T>;
  /** The stretches run with the trace paused, and whether one failed in the step now running. */
  segments: UntracedSegments;
  /** Everything the viewer's own window was sent with postMessage, as text with bytes in hex. */
  received(): Promise<string>;
  close(): Promise<void>;
}

/** Writes each console line of every page of the context, popups and frames' pages included, as it arrives. */
function recordConsole(context: BrowserContext, file: string): void {
  const watch = (page: Page) => {
    // The frame the line came from, not the page, so a line of Swarm ID's frame inside the viewer reads as Swarm ID's.
    page.on('console', (message) =>
      appendFileSync(
        file,
        `${new Date().toISOString()} ${message.type()} ${message.location().url || page.url()} ${message.text()}\n`,
      ),
    );
    page.on('pageerror', (error) =>
      appendFileSync(file, `${new Date().toISOString()} pageerror ${page.url()} ${error}\n`),
    );
  };
  context.on('page', watch);
}

/** What the kit's script leaves in a Swarm ID document it ran in, so a document it missed can be told apart. */
const PREPARED = '__flowKitPrepared';

/**
 * Puts the kit's settings into every document of Swarm ID's origin before its own scripts run: the local Bee node and
 * chain as the person's network settings, in the frames' partitioned storage as well as Swarm ID's own, and the test
 * wallet in its top-level pages. Swarm ID's sign-in window opens from its button frame, and that window's first
 * document can run before the context's init scripts reach it (then neither the wallet nor the settings are there,
 * and the window reads the public gateway), so such a window gets the settings and is loaded once more,
 * which the init scripts do reach. Loading it again keeps its address, which carries the sign-in request. The
 * document is never rewritten on its way in: a fulfilled document loses its address space, and Chrome then refuses
 * its requests to loopback.
 */
async function prepareSwarmIdDocuments(context: BrowserContext, addresses: Addresses, walletScript: string) {
  const settings = JSON.stringify({ beeNodeUrl: `${addresses.queen}/`, gnosisRpcUrl: addresses.chain });
  const script = `if (location.origin === ${JSON.stringify(addresses.swarmId)}) {
    localStorage.setItem('swarm-id-network-settings', ${JSON.stringify(settings)});
    window.${PREPARED} = true;
  }
  ${walletScript}`;
  await context.addInitScript({ content: script });
  context.on('page', (page) => {
    void page
      .waitForLoadState('domcontentloaded')
      .then(async () => {
        if (new URL(page.url()).origin !== addresses.swarmId) return;
        if (await page.evaluate((marker) => marker in window, PREPARED)) return;
        await page.evaluate(script);
        await page.reload();
      })
      .catch(() => undefined);
  });
}

export async function startActor(
  browser: Browser,
  name: string,
  settings: ActorSettings,
  addresses: Addresses,
  dir: string,
): Promise<Actor> {
  mkdirSync(join(dir, 'steps'), { recursive: true });
  // A service worker's requests can pass the context's routing, and the viewer's Weeb3 fake needs none.
  const context = await browser.newContext({
    recordHar: { path: join(dir, 'network.har'), content: 'embed' },
    serviceWorkers: 'block',
  });
  recordConsole(context, join(dir, 'console.log'));
  const blocked: string[] = [];
  let wallet: TestWallet | null = null;
  const walletScript = await exposeWallet(context, addresses.swarmId, addresses.ethereum, () => wallet);
  await prepareSwarmIdDocuments(context, addresses, walletScript);
  // Every address the kit uses is local, so a request elsewhere is something under test reaching out, and the run
  // that let it through would depend on a network the kit does not control.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (isLocalRequest(url)) return route.fallback();
    blocked.push(`${route.request().method()} ${url}`);
    return route.abort('blockedbyclient');
  });
  let chunk = 0;
  const traceFile = () => join(dir, `trace-${String(++chunk).padStart(2, '0')}.zip`);
  const segments = new UntracedSegments(
    () => context.tracing.stopChunk({ path: traceFile() }),
    () => context.tracing.startChunk(),
  );
  await context.tracing.start({ screenshots: true, snapshots: true });
  await context.tracing.startChunk();

  await context.addInitScript(
    ({ viewer, ownNode, chatSource, received }) => {
      if (location.origin !== viewer || window.top !== window) return;
      const toText = (value: unknown) =>
        JSON.stringify(value, (_key, item: unknown) =>
          ArrayBuffer.isView(item)
            ? Array.from(new Uint8Array(item.buffer, item.byteOffset, item.byteLength), (b) =>
                b.toString(16).padStart(2, '0'),
              ).join('')
            : item instanceof ArrayBuffer
              ? Array.from(new Uint8Array(item), (b) => b.toString(16).padStart(2, '0')).join('')
              : item,
        );
      const log: string[] = [];
      Object.assign(window, { [received]: log });
      window.addEventListener('message', (event) => {
        try {
          log.push(toText(event.data));
        } catch {
          log.push(String(event.data));
        }
      });
      if (chatSource === 'bee' && !sessionStorage.getItem('flow-kit-seeded')) {
        sessionStorage.setItem('flow-kit-seeded', '1');
        localStorage.setItem(
          'swarm-sources',
          JSON.stringify([{ id: 'added-1', type: 'bee-node', name: 'My Bee node', url: ownNode }]),
        );
        localStorage.setItem(
          'swarm-routing',
          JSON.stringify({
            mode: 'per-part',
            source: 'gateway',
            parts: { player: 'gateway', 'stream-list': 'gateway', previews: 'gateway', chat: 'added-1' },
          }),
        );
      }
    },
    {
      viewer: addresses.viewer,
      ownNode: addresses.worker2,
      chatSource: settings.chatSource,
      received: RECEIVED,
    },
  );

  const actor: Actor = {
    name,
    context,
    viewer: null,
    idPage: null,
    evilPage: null,
    password: randomBytes(16).toString('hex'),
    get wallet() {
      return wallet;
    },
    set wallet(value) {
      wallet = value;
    },
    session: null,
    chatName: null,
    dir,
    blocked,
    segments,
    untraced: (step) => segments.run(step),
    async received() {
      if (!actor.viewer || actor.viewer.isClosed()) return '';
      return actor.viewer.evaluate(
        (key) => ((window as unknown as Record<string, string[]>)[key] ?? []).join('\n'),
        RECEIVED,
      );
    },
    async close() {
      await context.tracing.stopChunk({ path: traceFile() }).catch(() => undefined);
      await context.tracing.stop().catch(() => undefined);
      await context.close();
    },
  };
  return actor;
}
