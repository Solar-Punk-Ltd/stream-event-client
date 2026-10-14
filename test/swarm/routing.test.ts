import { describe, expect, it } from 'vitest';

import {
  chooseSource,
  defaultRouting,
  parseRouting,
  resolveRouting,
  type Routing,
  serializeRouting,
  setMode,
  setPart,
  withoutSource,
} from '../../src/swarm/routing';

const KNOWN = ['event', 'backup', 'added-1'];
const DEFAULT = defaultRouting('event');

describe('the default routing', () => {
  it('reads every part from the default gateway, the chat history included', () => {
    expect(DEFAULT).toEqual({
      mode: 'one',
      source: 'event',
      parts: { player: 'event', 'stream-list': 'event', previews: 'event', chat: 'event' },
    });
    expect(resolveRouting(DEFAULT, KNOWN, 'event')).toEqual(DEFAULT.parts);
  });
});

describe('all features', () => {
  it('read every part from the source in use, the chat history included', () => {
    expect(resolveRouting(chooseSource(DEFAULT, 'added-1'), KNOWN, 'event')).toEqual({
      player: 'added-1',
      'stream-list': 'added-1',
      previews: 'added-1',
      chat: 'added-1',
    });
  });

  it('read from the default gateway for a source that is gone', () => {
    expect(resolveRouting(chooseSource(DEFAULT, 'added-7'), KNOWN, 'event').player).toBe('event');
  });
});

describe('per feature', () => {
  const perPart = setMode(chooseSource(DEFAULT, 'backup'), 'per-part');

  it('starts from the one source in use, so switching the mode changes nothing yet', () => {
    expect(resolveRouting(perPart, KNOWN, 'event')).toEqual(
      resolveRouting(chooseSource(DEFAULT, 'backup'), KNOWN, 'event'),
    );
  });

  it('reads each part from the source it picks, each on its own', () => {
    const routing = setPart(
      setPart(setPart(perPart, 'previews', 'added-1'), 'chat', 'event'),
      'stream-list',
      'added-1',
    );

    expect(resolveRouting(routing, KNOWN, 'event')).toEqual({
      player: 'backup',
      'stream-list': 'added-1',
      previews: 'added-1',
      chat: 'event',
    });
  });

  it('reads a part whose source is gone from the default gateway', () => {
    const routing = setPart(setPart(perPart, 'previews', 'added-7'), 'chat', 'added-7');

    expect(resolveRouting(routing, KNOWN, 'event')).toMatchObject({ previews: 'event', chat: 'event' });
  });

  it('goes back to all features without forgetting which source that was', () => {
    expect(setMode(setPart(perPart, 'previews', 'added-1'), 'one').source).toBe('backup');
  });
});

describe('removing a source', () => {
  it('moves every part that read from it to the default gateway, the chat history included', () => {
    const routing = setPart(
      setPart(setMode(chooseSource(DEFAULT, 'added-1'), 'per-part'), 'chat', 'added-1'),
      'previews',
      'backup',
    );

    expect(withoutSource(routing, 'added-1', 'event')).toEqual({
      mode: 'per-part',
      source: 'event',
      parts: { player: 'event', 'stream-list': 'event', previews: 'backup', chat: 'event' },
    });
  });
});

describe('the routing as the browser keeps it', () => {
  it('survives a round trip', () => {
    const routing: Routing = setPart(setMode(DEFAULT, 'per-part'), 'stream-list', 'backup');

    expect(parseRouting(serializeRouting(routing), DEFAULT)).toEqual(routing);
  });

  it('is the default for nothing saved, for text that is not JSON, or for the wrong shape', () => {
    expect(parseRouting(null, DEFAULT)).toEqual(DEFAULT);
    expect(parseRouting('{oops', DEFAULT)).toEqual(DEFAULT);
    expect(parseRouting('{"mode":"several","source":"event"}', DEFAULT)).toEqual(DEFAULT);
    expect(parseRouting('{"mode":"one","source":7}', DEFAULT)).toEqual(DEFAULT);
  });

  it('takes the parts it can read and the default for the rest', () => {
    expect(parseRouting('{"mode":"per-part","source":"backup","parts":{"previews":"added-1"}}', DEFAULT)).toEqual({
      mode: 'per-part',
      source: 'backup',
      parts: { ...DEFAULT.parts, previews: 'added-1' },
    });
  });

  it("reads an older visit's chat service, which is gone, as the default gateway", () => {
    const saved = parseRouting(
      '{"mode":"per-part","source":"event","parts":{"player":"backup","chat":"chat-read"},"linked":true}',
      DEFAULT,
    );

    expect(resolveRouting(saved, KNOWN, 'event')).toMatchObject({ player: 'backup', chat: 'event' });
    expect(saved).not.toHaveProperty('linked');
  });
});

describe('the node in this browser', () => {
  const WITH_NODE = [...KNOWN, 'added-2'];

  it('can be the one source for everything, as any other source', () => {
    expect(resolveRouting(chooseSource(DEFAULT, 'added-2'), WITH_NODE, 'event')).toEqual({
      player: 'added-2',
      'stream-list': 'added-2',
      previews: 'added-2',
      chat: 'added-2',
    });
  });

  it('reads every part a saved routing put on it', () => {
    const saved: Routing = {
      mode: 'per-part',
      source: 'event',
      parts: { player: 'backup', 'stream-list': 'added-2', previews: 'added-2', chat: 'added-2' },
    };

    expect(resolveRouting(saved, WITH_NODE, 'event')).toEqual({
      player: 'backup',
      'stream-list': 'added-2',
      previews: 'added-2',
      chat: 'added-2',
    });
  });
});
