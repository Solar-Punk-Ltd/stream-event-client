/**
 * A hostile site: a page on a site of its own that embeds Swarm ID and tries to sign in to it. It does only what any
 * site does through the library, so what it cannot reach is the browser's and Swarm ID's doing, not the page's good
 * behaviour. The kit reads its result through the functions it puts on `window`. The Swarm ID origin and the app name
 * come from the page's own query string, so one build serves both the listed and the unlisted check.
 */
import { SwarmIdClient } from '@solarpunkltd/swarm-id';

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const params = new URLSearchParams(location.search);
const swarmIdOrigin = params.get('swarmId') ?? '';
const appName = params.get('app') ?? 'Hostile site';
const state = document.getElementById('state')!;
const say = (text: string) => {
  state.textContent = text;
};

interface EvilApi {
  init: Promise<{ ok: boolean; error?: string }>;
  info(): { identity: string | null; hasBinding: boolean };
  chatKey(): Promise<string>;
  batch(): Promise<string | null>;
  /** Asks Swarm ID's frame to stamp one content chunk, and says whether it was stamped or refused. */
  stamp(): Promise<{ stamped: boolean; error?: string }>;
  disconnect(): Promise<void>;
}

/** A content chunk's body: the 8-byte little-endian span, then the payload. */
function contentChunk(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const body = new Uint8Array(8 + payload.length);
  new DataView(body.buffer).setBigUint64(0, BigInt(payload.length), true);
  body.set(payload, 8);
  return body;
}

let lastInfo: { identity: string | null; hasBinding: boolean } = { identity: null, hasBinding: false };

const client = new SwarmIdClient({
  iframeOrigin: swarmIdOrigin,
  metadata: { name: appName },
  popupMode: 'popup',
  onConnectionChange: (info) => {
    lastInfo = { identity: info.identity?.address ?? null, hasBinding: Boolean(info.chatBinding) };
    say(`connection: ${lastInfo.identity ?? 'signed out'}${lastInfo.hasBinding ? ' (bound)' : ''}`);
  },
});

const api: EvilApi = {
  init: client
    .initialize()
    .then(() => {
      client.mountButton(document.getElementById('signin')!, {
        action: 'sign-in',
        config: { text: 'Sign in with Swarm ID', ariaLabel: 'Sign in with Swarm ID' },
      });
      say('ready');
      return { ok: true };
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      say(`init failed: ${message}`);
      return { ok: false, error: message };
    }),
  info: () => lastInfo,
  chatKey: () => client.getChatKey().then(toHex),
  batch: () => client.getPostageBatch().then((batch) => batch?.batchID ?? null),
  stamp: () =>
    client.stampChunk({ kind: 'content', data: contentChunk('stamped by the hostile site') }).then(
      () => ({ stamped: true }),
      (error: unknown) => ({ stamped: false, error: error instanceof Error ? error.message : String(error) }),
    ),
  disconnect: () => client.disconnect(),
};

(window as unknown as { __evil: EvilApi }).__evil = api;
