import { describe, expect, it } from 'vitest';

import { ownStampRoute } from '../../src/features/chat/stamp/ownStampRoute';
import type { Source } from '../../src/swarm/sources';

const EVENT: Source = { id: 'event', type: 'gateway', name: 'Event gateway', url: '/bee', offered: true };
const BACKUP: Source = {
  id: 'backup',
  type: 'gateway',
  name: 'Backup gateway',
  url: 'https://backup.example.com',
  offered: true,
};
const MY_GATEWAY: Source = {
  id: 'added-9',
  type: 'gateway',
  name: 'My gateway',
  url: 'https://gw.example.org',
  offered: false,
};
const NODE_A: Source = {
  id: 'added-1',
  type: 'bee-node',
  name: 'Node A',
  url: 'http://localhost:1633/',
  offered: false,
};
const NODE_B: Source = {
  id: 'added-2',
  type: 'bee-node',
  name: 'Node B',
  url: 'https://bee.example.com',
  offered: false,
};
const WEEB3: Source = { id: 'added-3', type: 'weeb-3', name: 'Weeb3', url: '', offered: false };

describe('which source a message on my own stamp goes out through', () => {
  it('is the Bee node picked for Chat history, at its address without a trailing slash', () => {
    expect(ownStampRoute([EVENT, NODE_A], NODE_A.id)).toEqual({
      ok: true,
      through: 'bee-node',
      url: 'http://localhost:1633',
    });
  });

  it('is Weeb3 when Weeb3 is picked for Chat history, even with a Bee node in the list', () => {
    expect(ownStampRoute([EVENT, NODE_A, WEEB3], WEEB3.id)).toEqual({ ok: true, through: 'weeb-3' });
  });

  it('is the Bee node picked for Chat history over an earlier Bee node in the list', () => {
    expect(ownStampRoute([EVENT, NODE_A, NODE_B], NODE_B.id)).toEqual({
      ok: true,
      through: 'bee-node',
      url: 'https://bee.example.com',
    });
  });

  it('is a Bee node from the list while a gateway reads the chat history', () => {
    expect(ownStampRoute([EVENT, BACKUP, NODE_A], EVENT.id)).toEqual({
      ok: true,
      through: 'bee-node',
      url: 'http://localhost:1633',
    });
  });

  it('is the first Bee node in the list, before Weeb3 added earlier, while a gateway reads the chat history', () => {
    expect(ownStampRoute([EVENT, WEEB3, NODE_B, NODE_A], EVENT.id)).toEqual({
      ok: true,
      through: 'bee-node',
      url: 'https://bee.example.com',
    });
  });

  it('is Weeb3 from the list while a gateway reads the chat history and there is no Bee node', () => {
    expect(ownStampRoute([EVENT, MY_GATEWAY, WEEB3], MY_GATEWAY.id)).toEqual({ ok: true, through: 'weeb-3' });
  });

  it('is taken from the list when the chat history names a source that is gone', () => {
    expect(ownStampRoute([EVENT, NODE_A], 'added-removed')).toEqual({
      ok: true,
      through: 'bee-node',
      url: 'http://localhost:1633',
    });
  });

  it('is never a gateway, offered or added, so with only gateways there is none', () => {
    for (const chatSource of [EVENT, BACKUP, MY_GATEWAY]) {
      expect(ownStampRoute([EVENT, BACKUP, MY_GATEWAY], chatSource.id)).toEqual({ ok: false });
    }
    expect(ownStampRoute([], EVENT.id)).toEqual({ ok: false });
  });
});
