import { describe, expect, it } from 'vitest';

import {
  EVENT_GATEWAY_STAMPS_ITSELF,
  GATEWAY_STAMPS_ITSELF,
  ownStampRoute,
  PICK_A_SOURCE_THAT_SENDS,
} from '../../src/features/chat/stamp/ownStampRoute';
import type { Source } from '../../src/swarm/sources';

const source = (extra: Partial<Source>): Source => ({
  id: 'added-1',
  type: 'bee-node',
  name: 'My Bee node',
  url: 'http://localhost:1633',
  offered: false,
  ...extra,
});

describe('which source a message on my own stamp goes out through', () => {
  it("is the viewer's own Bee node, which stores a chunk under the stamp it carries", () => {
    expect(ownStampRoute(source({}), 'event')).toEqual({ ok: true, through: 'bee-node', url: 'http://localhost:1633' });
    expect(ownStampRoute(source({ url: 'https://bee.example.com/' }), 'event')).toEqual({
      ok: true,
      through: 'bee-node',
      url: 'https://bee.example.com',
    });
  });

  it('is never the event gateway, which stamps every chat message with its own stamp', () => {
    expect(ownStampRoute(source({ id: 'event', type: 'gateway', offered: true, url: '/bee' }), 'event')).toEqual({
      ok: false,
      reason: EVENT_GATEWAY_STAMPS_ITSELF,
      hint: PICK_A_SOURCE_THAT_SENDS,
    });
  });

  it('is never another gateway, offered or added, which may stamp with its own or take no writes', () => {
    for (const gateway of [
      source({ id: 'backup', type: 'gateway', offered: true, url: 'https://backup.example.com' }),
      source({ type: 'gateway', url: 'https://gw.example.org' }),
    ]) {
      expect(ownStampRoute(gateway, 'event')).toEqual({
        ok: false,
        reason: GATEWAY_STAMPS_ITSELF,
        hint: PICK_A_SOURCE_THAT_SENDS,
      });
    }
  });

  it('is the node in this browser, which pushes a chunk under the stamp it is handed', () => {
    expect(ownStampRoute(source({ type: 'weeb-3', url: '' }), 'event')).toEqual({ ok: true, through: 'weeb-3' });
  });

  it('names both sources that can send it when a gateway is picked', () => {
    expect(PICK_A_SOURCE_THAT_SENDS).toBe('Pick your Bee node or Weeb3 for Chat history in Use for.');
  });
});
