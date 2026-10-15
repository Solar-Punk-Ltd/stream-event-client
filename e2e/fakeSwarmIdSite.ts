import { Bytes, ChunkBuilder, Identifier, PrivateKey, Span } from '@ethersphere/bee-js';
import type { Page } from '@playwright/test';

import { PREVIEW_ORIGIN } from './recording';
import { accountOf, signChatBinding } from './record/chatBinding';

/** A made-up origin for the Swarm ID site, answered by the page's own route before any request leaves it. */
export const FAKE_SWARM_ID_ORIGIN = 'https://id.example.test';

/** Throwaway keys, each a repeated byte so no key-shaped literal is kept. They hold nothing anywhere. */
const ACCOUNT_KEY = Uint8Array.from({ length: 32 }, () => 0x3c);
const CHAT_KEY = new PrivateKey('5a'.repeat(32));
const SPAN_BYTES = 8;
/** What a stamp's header value is as long as, in bytes, so a node reading the fake one sees the right shape. */
const STAMP_BYTES = 113;

/** The stamp the fake Swarm ID gives this site, in the library's shape. */
export interface FakeSiteStamp {
  label: string;
  utilization: number;
  usable: boolean;
  exists: boolean;
  batchTTL?: number;
}

export const ACCOUNT_NAME = 'Ida';
export const CHAT_ADDRESS = CHAT_KEY.publicKey().address().toHex();

/** Where the library loads Swarm ID's button frame from, beside its session frame at `/proxy`. */
const BUTTON_PATH = '/button';

/** What the fake's two frames, the session frame and the button, tell each other with, as Swarm ID's do. */
const CHANNEL = 'fake-swarm-id';

/**
 * The session frame's side of the library's messages, only as far as signing in, picking a stamp and stamping go. It
 * never says it shares Swarm ID's storage, as a frame on another site than Swarm ID cannot in Chrome, so the library's
 * own `connect()` refuses and only the button signs in. When the button's window hands over, the frame reports the
 * session again, signed in, with the id of the stamp the site now uses.
 */
const PROXY_SCRIPT = `
const info = __INFO__;
const chatKey = __CHAT_KEY__;
let signedIn = __SIGNED_IN__;
let parentOrigin = null;
parent.postMessage({ type: 'proxyInitialized' }, '*');
const reportOf = async () => {
  if (!signedIn) {
    return { type: 'connectionInfoChanged', canUpload: false };
  }
  const postageBatchId = await window.fakeSwarmIdSiteStampId();
  return { type: 'connectionInfoChanged', canUpload: true, uploadMode: 'user-stamp', ...info, ...(postageBatchId ? { postageBatchId } : {}) };
};
new BroadcastChannel('${CHANNEL}').onmessage = async () => {
  signedIn = true;
  parent.postMessage(await reportOf(), parentOrigin);
};
addEventListener('message', async (event) => {
  const message = event.data;
  const send = (reply) => event.source.postMessage(reply, event.origin);
  const answer = (reply) => send({ requestId: message.requestId, ...reply });
  switch (message.type) {
    case 'parentIdentify': {
      parentOrigin = event.origin;
      const report = await reportOf();
      send({ type: 'proxyReady', authenticated: signedIn, parentOrigin: event.origin });
      send(report);
      return;
    }
    case 'getChatKey':
      return answer({ type: 'getChatKeyResponse', chatKey: new Uint8Array(chatKey) });
    case 'setBeeApiUrl':
      return answer({ type: 'setBeeApiUrlResponse', beeApiUrl: message.beeApiUrl });
    case 'getPostageBatch':
      return answer({ type: 'getPostageBatchResponse', postageBatch: await window.fakeSwarmIdSiteStamp() });
    case 'stampChunk': {
      const { identifier, data, signer } = message.chunk;
      const stamped = await window.fakeSwarmIdStamp(identifier, Array.from(data), signer.privateKey);
      return answer({ type: 'stampChunkResponse', ...stamped });
    }
    default:
      return answer({ type: 'error', error: 'not in this fake', code: 'internal' });
  }
});
`;

/**
 * Swarm ID's button frame, drawn with the label and look the site hands it. Its click plays the Swarm ID window: it
 * says the window opened, the person picks an account and a stamp, the window hands the session to the session frame
 * beside it, and it says the window closed.
 */
const BUTTON_SCRIPT = `
const LABELS = { 'sign-in': 'Sign in with Swarm ID', 'change-stamp': 'Change stamp in Swarm ID' };
const channel = new BroadcastChannel('${CHANNEL}');
const button = document.createElement('button');
let parentOrigin = null;
let action = 'sign-in';
let config = {};
const tell = (state) => parent.postMessage({ type: 'buttonWindowChanged', state }, parentOrigin);
const draw = () => {
  button.textContent = config.text ?? LABELS[action];
  if (config.ariaLabel) button.setAttribute('aria-label', config.ariaLabel);
  Object.assign(button.style, {
    width: '100%', height: '100%', border: 'none', cursor: 'pointer',
    background: config.backgroundColor ?? '#dd7200', color: config.color ?? 'white',
    borderRadius: config.borderRadius ?? '0', fontFamily: config.fontFamily ?? '',
    fontSize: config.fontSize ?? '14px', fontWeight: String(config.fontWeight ?? '600'),
  });
};
button.addEventListener('click', async () => {
  tell('open');
  await window.fakeSwarmIdConnect();
  channel.postMessage('handover');
  tell('closed');
});
addEventListener('message', async (event) => {
  const message = event.data;
  if (event.source !== parent || (message.type !== 'buttonIdentify' && message.type !== 'buttonUpdate')) {
    return;
  }
  parentOrigin = event.origin;
  action = message.action;
  config = message.config ?? {};
  await window.fakeSwarmIdButton(action, config);
  draw();
  if (message.type === 'buttonIdentify') {
    document.body.style.margin = '0';
    document.body.append(button);
    await window.fakeSwarmIdButtonMayShow();
    parent.postMessage({ type: 'buttonReady' }, event.origin);
  }
});
parent.postMessage({ type: 'buttonFrameLoaded' }, '*');
`;

/** The fake names a stamp by its label, so the stamp picked in the window has another id than the one before. */
function batchIdOf(stamp: FakeSiteStamp): string {
  return Buffer.from(stamp.label).toString('hex').padEnd(64, '0').slice(0, 64);
}

/** A single-owner chunk signed as the frame signs one: over its identifier and the address of the chunk it wraps. */
function signedAs(privateKey: string, identifierHex: string, data: number[]) {
  const key = new PrivateKey(privateKey);
  const span = Span.fromSlice(Uint8Array.from(data), 0).toBigInt();
  const wrapped = new ChunkBuilder(span);
  wrapped.writer.buffer.set(Uint8Array.from(data.slice(SPAN_BYTES)));
  const signature = key.sign(Bytes.concat(new Identifier(identifierHex).toUint8Array(), wrapped.hash().toUint8Array()));
  return { owner: key.publicKey().address().toHex(), signature: signature.toHex() };
}

/** What the viewer handed Swarm ID's button, each time it mounted or changed it. */
interface FakeButtonLook {
  action: string;
  config: Record<string, unknown>;
}

/**
 * Serves a Swarm ID site at {@link FAKE_SWARM_ID_ORIGIN}: a session frame and Swarm ID's button frame. With
 * `startsSignedIn` the session frame keeps a signed-in session for this site, as a returning viewer's would, so no
 * window opens, and without it a click on the button signs the person in. It gives the site the chat key and a binding
 * for it, names the site's stamp in every report as the library does, says how it stands from `siteStamp`, and stamps
 * every chunk it is asked to with a stamp of the right length that no Bee node would take, recording each chunk.
 * `pickStamp` is what the person does in the window the button opens, such as making `siteStamp` answer with another
 * stamp.
 */
export async function serveFakeSwarmIdSite(
  page: Page,
  siteStamp: () => FakeSiteStamp | undefined,
  pickStamp: () => void = () => {},
  startsSignedIn = true,
) {
  const stamped: Array<{ identifier: string; signer: string }> = [];
  const windows = { opened: 0 };
  const buttons: FakeButtonLook[] = [];
  const binding = signChatBinding(ACCOUNT_KEY, PREVIEW_ORIGIN, CHAT_ADDRESS, new Date());
  const account = accountOf(ACCOUNT_KEY);
  const info = {
    identity: {
      id: account.slice(2),
      name: ACCOUNT_NAME,
      address: account.slice(2),
      avatar: { source: 'generated', url: 'data:,' },
    },
    chatBinding: { message: binding.msg, signature: binding.sig },
  };
  await page.exposeFunction('fakeSwarmIdSiteStamp', () => {
    const stamp = siteStamp();
    // The library checks every field of a batch, so the ones the viewer does not read are filled in too.
    return (
      stamp && {
        batchID: batchIdOf(stamp),
        depth: 22,
        amount: '1',
        bucketDepth: 16,
        blockNumber: 1,
        immutableFlag: false,
        ...stamp,
      }
    );
  });
  await page.exposeFunction('fakeSwarmIdSiteStampId', () => {
    const stamp = siteStamp();
    return stamp ? batchIdOf(stamp) : null;
  });
  await page.exposeFunction('fakeSwarmIdConnect', () => {
    windows.opened += 1;
    pickStamp();
  });
  await page.exposeFunction('fakeSwarmIdButton', (action: string, config: Record<string, unknown>) => {
    buttons.push({ action, config });
  });
  const held = { isHolding: false, waiting: [] as Array<() => void> };
  await page.exposeFunction('fakeSwarmIdButtonMayShow', () =>
    held.isHolding ? new Promise<void>((resolve) => held.waiting.push(resolve)) : undefined,
  );
  await page.exposeFunction('fakeSwarmIdStamp', (identifier: string, data: number[], privateKey: string) => {
    stamped.push({ identifier, signer: new PrivateKey(privateKey).publicKey().address().toHex() });
    return { address: '0'.repeat(64), stamp: 'ee'.repeat(STAMP_BYTES), ...signedAs(privateKey, identifier, data) };
  });
  const proxyScript = PROXY_SCRIPT.replace('__INFO__', JSON.stringify(info))
    .replace('__CHAT_KEY__', JSON.stringify(Array.from(CHAT_KEY.toUint8Array())))
    .replace('__SIGNED_IN__', JSON.stringify(startsSignedIn));
  await page.route(`${FAKE_SWARM_ID_ORIGIN}/**`, (route) => {
    const script = new URL(route.request().url()).pathname === BUTTON_PATH ? BUTTON_SCRIPT : proxyScript;
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><script>${script}</script>`,
    });
  });
  return {
    stamped,
    windows,
    buttons,
    /** Button frames drawn from now on say they are ready only once released, as a slow one does. */
    holdButtons: () => {
      held.isHolding = true;
    },
    releaseButtons: () => {
      held.isHolding = false;
      for (const release of held.waiting.splice(0)) {
        release();
      }
    },
  };
}
