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

/**
 * The frame's side of the library's messages, only as far as signing in, picking a stamp and stamping go. A connect
 * while signed in plays the Swarm ID window: the person picks a stamp, and the frame reports the same session again.
 */
const PROXY_SCRIPT = `
const info = __INFO__;
const chatKey = __CHAT_KEY__;
parent.postMessage({ type: 'proxyInitialized' }, '*');
addEventListener('message', async (event) => {
  const message = event.data;
  const send = (reply) => event.source.postMessage(reply, event.origin);
  const answer = (reply) => send({ requestId: message.requestId, ...reply });
  switch (message.type) {
    case 'parentIdentify':
      send({ type: 'proxyReady', authenticated: true, parentOrigin: event.origin });
      send({ type: 'connectionInfoChanged', canUpload: true, uploadMode: 'user-stamp', ...info });
      return;
    case 'connect':
      await window.fakeSwarmIdConnect();
      answer({ type: 'connectResponse', success: true });
      send({ type: 'connectionInfoChanged', canUpload: true, uploadMode: 'user-stamp', ...info });
      return;
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

/** A single-owner chunk signed as the frame signs one: over its identifier and the address of the chunk it wraps. */
function signedAs(privateKey: string, identifierHex: string, data: number[]) {
  const key = new PrivateKey(privateKey);
  const span = Span.fromSlice(Uint8Array.from(data), 0).toBigInt();
  const wrapped = new ChunkBuilder(span);
  wrapped.writer.buffer.set(Uint8Array.from(data.slice(SPAN_BYTES)));
  const signature = key.sign(Bytes.concat(new Identifier(identifierHex).toUint8Array(), wrapped.hash().toUint8Array()));
  return { owner: key.publicKey().address().toHex(), signature: signature.toHex() };
}

/**
 * Serves a Swarm ID site at {@link FAKE_SWARM_ID_ORIGIN} whose frame keeps a signed-in session for this site, as a
 * returning viewer's would, so no window opens. It gives the site the chat key and a binding for it, says how the
 * site's stamp stands from `siteStamp`, and stamps every chunk it is asked to with a stamp of the right length that no
 * Bee node would take, recording each chunk. `pickStamp` is what the person does in the window a connect opens, such
 * as making `siteStamp` answer with another stamp.
 */
export async function serveFakeSwarmIdSite(
  page: Page,
  siteStamp: () => FakeSiteStamp | undefined,
  pickStamp: () => void = () => {},
) {
  const stamped: Array<{ identifier: string; signer: string }> = [];
  const windows = { opened: 0 };
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
        batchID: 'b'.repeat(64),
        depth: 22,
        amount: '1',
        bucketDepth: 16,
        blockNumber: 1,
        immutableFlag: false,
        ...stamp,
      }
    );
  });
  await page.exposeFunction('fakeSwarmIdConnect', () => {
    windows.opened += 1;
    pickStamp();
  });
  await page.exposeFunction('fakeSwarmIdStamp', (identifier: string, data: number[], privateKey: string) => {
    stamped.push({ identifier, signer: new PrivateKey(privateKey).publicKey().address().toHex() });
    return { address: '0'.repeat(64), stamp: 'ee'.repeat(STAMP_BYTES), ...signedAs(privateKey, identifier, data) };
  });
  const script = PROXY_SCRIPT.replace('__INFO__', JSON.stringify(info)).replace(
    '__CHAT_KEY__',
    JSON.stringify(Array.from(CHAT_KEY.toUint8Array())),
  );
  await page.route(`${FAKE_SWARM_ID_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><script>${script}</script>`,
    }),
  );
  return { stamped, windows };
}
