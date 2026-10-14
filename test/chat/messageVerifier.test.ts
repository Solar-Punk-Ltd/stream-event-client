import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMessageVerifier, VERIFY_BATCH_SIZE } from '../../src/features/chat/verify/messageVerifier';
import { pageScope } from '../../src/features/chat/verify/verdicts';
import {
  BOUND_SITE,
  CHAT_BINDING,
  chatKeyFor,
  forgedWithBinding,
  FORK_ACCOUNT,
  GUEST_KEY,
  inThreadPort,
  inThreadVerifier,
  OTHER_SITE,
  OTHER_SITE_BINDING,
  signedMessage,
} from '../helpers/signedChat';

let boundKey: string;
let otherSiteKey: string;

beforeAll(async () => {
  boundKey = await chatKeyFor(BOUND_SITE);
  otherSiteKey = await chatKeyFor(OTHER_SITE);
});

describe('checking a chat message off the main thread', () => {
  it('passes a guest message with no identity', async () => {
    const verdict = await inThreadVerifier().verify(signedMessage('guest'));
    expect(verdict).toEqual({ ok: true, identity: null });
  });

  it('passes a Swarm ID message with the account that signed its binding for this site', async () => {
    const verdict = await inThreadVerifier(BOUND_SITE).verify(signedMessage('bound', { key: boundKey, binding: CHAT_BINDING }));
    expect(verdict).toEqual({
      ok: true,
      identity: { account: FORK_ACCOUNT, site: BOUND_SITE, date: '2026-10-14T12:00:00.000Z' },
    });
  });

  it('refuses a message whose text was changed after it was signed', async () => {
    const tampered = { ...signedMessage('tampered'), text: 'something else' };
    expect(await inThreadVerifier().verify(tampered)).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('refuses a binding made for another site, never passing it as a guest', async () => {
    const elsewhere = signedMessage('elsewhere', { key: otherSiteKey, binding: OTHER_SITE_BINDING });
    expect(await inThreadVerifier(BOUND_SITE).verify(elsewhere)).toMatchObject({ ok: false, reason: 'binding' });
  });

  it('refuses a binding for another chat address carried by a key it does not name', async () => {
    const forged = forgedWithBinding('forged', GUEST_KEY, CHAT_BINDING);
    expect(await inThreadVerifier(BOUND_SITE).verify(forged)).toMatchObject({ ok: false, reason: 'binding' });
  });

  it('refuses a message of the version before, whatever else it says', async () => {
    const { via: _via, own: _own, ...rest } = signedMessage('old');
    const previous = { ...rest, v: 7 };
    expect(await inThreadVerifier().verify(previous)).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('refuses anything that is not a message at all', async () => {
    expect(await inThreadVerifier().verify(undefined)).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('keeps what the message says about its stamp for the badge to read', async () => {
    const own = signedMessage('own stamp', { via: MessageVia.OWN_STAMP });
    expect(await inThreadVerifier().verify(own)).toEqual({ ok: true, identity: null });
  });

  it('sends a history read in batches, answering each batch as it comes back rather than after the last', async () => {
    const port = inThreadPort();
    const verifier = createMessageVerifier(port, { origin: BOUND_SITE, allowLocalHttp: false });
    const count = VERIFY_BATCH_SIZE * 2 + 3;
    const messages = Array.from({ length: count }, (_, at) => signedMessage(`m${at}`, { ts: 1_000 + at }));

    const answered: number[] = [];
    const answer = port.onmessage;
    port.onmessage = (event) => {
      answered.push(performance.now());
      answer?.(event);
    };
    const started = performance.now();
    const verdicts = await Promise.all(messages.map((message) => verifier.verify(message)));

    expect(verdicts.every((verdict) => verdict.ok)).toBe(true);
    expect(port.posted.map((batch) => batch.messages.length)).toEqual([VERIFY_BATCH_SIZE, VERIFY_BATCH_SIZE, 3]);
    console.info(
      `verified ${count} messages, batches answered after ` +
        answered.map((at) => `${(at - started).toFixed(1)} ms`).join(', '),
    );
  });

  it('checks one message once, however many events carry it', async () => {
    const port = inThreadPort();
    const verifier = createMessageVerifier(port, { origin: BOUND_SITE, allowLocalHttp: false });
    const message = signedMessage('again');
    await verifier.verify(message);
    await verifier.verify({ ...message });
    expect(port.posted.flatMap((batch) => batch.messages)).toHaveLength(1);
  });

  it('turns away every message it was asked about once the worker fails, rather than leaving them waiting', async () => {
    const port = inThreadPort();
    port.postMessage = () => {};
    const verifier = createMessageVerifier(port, { origin: BOUND_SITE, allowLocalHttp: false });
    const waiting = verifier.verify(signedMessage('stuck'));
    await Promise.resolve();
    port.onerror?.(new Event('error') as ErrorEvent);
    expect(await waiting).toMatchObject({ ok: false, reason: 'unchecked' });
    expect(await verifier.verify(signedMessage('later'))).toMatchObject({ ok: false, reason: 'unchecked' });
  });
});

describe("the page's own scope", () => {
  it('names the page origin, and lets a local development page take a local binding', () => {
    expect(pageScope({ origin: 'https://view.example.com', protocol: 'https:', hostname: 'view.example.com' })).toEqual({
      origin: 'https://view.example.com',
      allowLocalHttp: false,
    });
    expect(pageScope({ origin: 'http://127.0.0.1:4173', protocol: 'http:', hostname: '127.0.0.1' })).toEqual({
      origin: 'http://127.0.0.1:4173',
      allowLocalHttp: true,
    });
    expect(pageScope({ origin: 'http://192.0.2.7', protocol: 'http:', hostname: '192.0.2.7' })).toEqual({
      origin: 'http://192.0.2.7',
      allowLocalHttp: false,
    });
  });
});
