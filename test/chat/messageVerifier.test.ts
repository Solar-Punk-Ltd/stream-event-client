import { MessageVia } from '@solarpunkltd/swarm-chat-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
    const guest = signedMessage('guest');
    const verdict = await inThreadVerifier().verify(guest);
    expect(verdict).toEqual({ ok: true, identity: null, message: guest });
  });

  it('passes a Swarm ID message with the account that signed its binding for this site', async () => {
    const bound = signedMessage('bound', { key: boundKey, binding: CHAT_BINDING });
    const verdict = await inThreadVerifier(BOUND_SITE).verify(bound);
    expect(verdict).toEqual({
      ok: true,
      message: bound,
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

  it('passes a binding made on another site this chat lists as one of its own, naming that site', async () => {
    const scope = pageScope({ origin: BOUND_SITE, protocol: 'https:', hostname: 'example.com' }, [OTHER_SITE]);
    const elsewhere = signedMessage('elsewhere', { key: otherSiteKey, binding: OTHER_SITE_BINDING });
    const verdict = await createMessageVerifier(() => inThreadPort(), scope).verify(elsewhere);
    expect(verdict).toEqual({
      ok: true,
      message: elsewhere,
      identity: { account: FORK_ACCOUNT, site: OTHER_SITE, date: '2026-10-14T12:00:00.000Z' },
    });
  });

  it('still refuses a binding made on a site the chat does not list', async () => {
    const scope = pageScope({ origin: BOUND_SITE, protocol: 'https:', hostname: 'example.com' }, [
      'https://mirror.example.com',
    ]);
    const elsewhere = signedMessage('elsewhere', { key: otherSiteKey, binding: OTHER_SITE_BINDING });
    const verdict = await createMessageVerifier(() => inThreadPort(), scope).verify(elsewhere);
    expect(verdict).toMatchObject({ ok: false, reason: 'binding' });
  });

  it('refuses a binding for another chat address carried by a key it does not name', async () => {
    const forged = forgedWithBinding('forged', GUEST_KEY, CHAT_BINDING);
    expect(await inThreadVerifier(BOUND_SITE).verify(forged)).toMatchObject({ ok: false, reason: 'binding' });
  });

  it('refuses a message of the version before, whatever else it says', async () => {
    const { via: _via, ...rest } = signedMessage('old');
    const previous = { ...rest, v: 7 };
    expect(await inThreadVerifier().verify(previous)).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('refuses anything that is not a message at all', async () => {
    expect(await inThreadVerifier().verify(undefined)).toMatchObject({ ok: false, reason: 'shape' });
  });

  it('keeps what the message says about its stamp for the badge to read', async () => {
    const own = signedMessage('own stamp', { via: MessageVia.OWN_STAMP });
    expect(await inThreadVerifier().verify(own)).toEqual({ ok: true, identity: null, message: own });
  });

  it('sends a history read in batches, answering each batch as it comes back rather than after the last', async () => {
    const port = inThreadPort();
    const verifier = createMessageVerifier(() => port, { origins: [BOUND_SITE], allowLocalHttp: false });
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
    const verifier = createMessageVerifier(() => port, { origins: [BOUND_SITE], allowLocalHttp: false });
    const message = signedMessage('again');
    await verifier.verify(message);
    await verifier.verify({ ...message });
    expect(port.posted.flatMap((batch) => batch.messages)).toHaveLength(1);
  });

  it('checks again a message whose text changed under the same id and signature, and refuses it', async () => {
    const verifier = inThreadVerifier();
    const message = signedMessage('cached');
    expect(await verifier.verify(message)).toMatchObject({ ok: true });
    expect(await verifier.verify({ ...message, text: 'changed after the first check' })).toMatchObject({
      ok: false,
      reason: 'signature',
    });
  });
});

describe('a worker that fails', () => {
  const scope = { origins: [BOUND_SITE], allowLocalHttp: false };

  /** A worker that takes a batch and never answers it, until the test fails it. */
  function silentPort() {
    const port = inThreadPort();
    port.postMessage = (request) => port.posted.push(request);
    return port;
  }

  it('checks on the page what was waiting when the worker errs, and every later message too', async () => {
    const port = silentPort();
    const verifier = createMessageVerifier(() => port, scope);
    const waiting = verifier.verify(signedMessage('waiting'));
    await Promise.resolve();
    port.onerror?.(new Event('error') as ErrorEvent);

    expect(await waiting).toMatchObject({ ok: true, identity: null });
    expect(await verifier.verify(signedMessage('later'))).toMatchObject({ ok: true });
    const tampered = { ...signedMessage('tampered'), text: 'changed' };
    expect(await verifier.verify(tampered)).toMatchObject({ ok: false, reason: 'signature' });
    expect(port.posted).toHaveLength(1);
  });

  it('checks on the page when the worker cannot read a message back', async () => {
    const port = silentPort();
    const verifier = createMessageVerifier(() => port, scope);
    const waiting = verifier.verify(signedMessage('unreadable'));
    await Promise.resolve();
    port.onmessageerror?.(new MessageEvent('messageerror'));
    expect(await waiting).toMatchObject({ ok: true });
  });

  it('checks on the page when a batch cannot be posted to the worker', async () => {
    const port = inThreadPort();
    port.postMessage = () => {
      throw new Error('could not be cloned');
    };
    const verifier = createMessageVerifier(() => port, scope);
    expect(await verifier.verify(signedMessage('unposted'))).toMatchObject({ ok: true });
  });

  it('checks each batch on the page in a turn of its own, so a long history never holds the page at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const verifier = createMessageVerifier(() => {
        throw new Error('workers are blocked here');
      }, scope);
      let answered = 0;
      const count = VERIFY_BATCH_SIZE * 2 + 1;
      for (let at = 0; at < count; at++) {
        void verifier.verify(signedMessage(`turn ${at}`, { ts: 1_000 + at })).then(() => answered++);
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(answered).toBe(0);

      const afterEachTurn: number[] = [];
      for (let turn = 0; turn < 3; turn++) {
        vi.advanceTimersByTime(0);
        for (let tick = 0; tick < 5; tick++) {
          await Promise.resolve();
        }
        afterEachTurn.push(answered);
      }
      expect(afterEachTurn).toEqual([VERIFY_BATCH_SIZE, VERIFY_BATCH_SIZE * 2, count]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks on the page when the worker cannot be started at all, refusing a tampered message there too', async () => {
    const verifier = createMessageVerifier(() => {
      throw new Error('workers are blocked here');
    }, scope);
    expect(await verifier.verify(signedMessage('blocked'))).toMatchObject({ ok: true });
    const tampered = { ...signedMessage('tampered here'), text: 'changed' };
    expect(await verifier.verify(tampered)).toMatchObject({ ok: false, reason: 'signature' });
  });
});

describe("the page's own scope", () => {
  it('names the page origin, and lets a local development page take a local binding', () => {
    expect(pageScope({ origin: 'https://view.example.com', protocol: 'https:', hostname: 'view.example.com' })).toEqual(
      {
        origins: ['https://view.example.com'],
        allowLocalHttp: false,
      },
    );
    expect(pageScope({ origin: 'http://127.0.0.1:4173', protocol: 'http:', hostname: '127.0.0.1' })).toEqual({
      origins: ['http://127.0.0.1:4173'],
      allowLocalHttp: true,
    });
    expect(pageScope({ origin: 'http://192.0.2.7', protocol: 'http:', hostname: '192.0.2.7' })).toEqual({
      origins: ['http://192.0.2.7'],
      allowLocalHttp: false,
    });
  });

  it('adds the other sites that serve the chat after the page origin, each once', () => {
    const page = { origin: 'https://view.example.com', protocol: 'https:', hostname: 'view.example.com' };
    expect(pageScope(page, ['https://mirror.example.com', 'https://view.example.com'])).toEqual({
      origins: ['https://view.example.com', 'https://mirror.example.com'],
      allowLocalHttp: false,
    });
  });
});
