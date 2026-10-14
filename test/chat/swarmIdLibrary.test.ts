// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLibraryClient } from '../../src/features/chat/swarmId/swarmIdLibrary';

const built = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>>, destroyed: 0 }));

/** The library's client, as far as building it and taking it down go. Nothing is framed. */
vi.mock('@solarpunkltd/swarm-id', () => ({
  SwarmIdClient: class {
    constructor(options: Record<string, unknown>) {
      built.options.push(options);
    }
    initialize = async () => {};
    connect = async () => {};
    disconnect = async () => {};
    getChatKey = async () => new Uint8Array();
    get connectionInfo() {
      return {};
    }
    destroy() {
      built.destroyed += 1;
    }
  },
}));

const FRAME_CONTAINER = '#swarm-id-frame';

afterEach(() => {
  document.body.innerHTML = '';
  built.options.length = 0;
  built.destroyed = 0;
});

describe("the library's client", () => {
  it('puts the frame in a hidden container of its own, named to the library', () => {
    createLibraryClient({ url: 'https://id.example.com', appName: 'Devcon streams', onConnectionChange: () => {} });

    const container = document.querySelector<HTMLElement>(FRAME_CONTAINER);
    expect(container?.hidden).toBe(true);
    expect(built.options[0]).toMatchObject({
      iframeOrigin: 'https://id.example.com',
      metadata: { name: 'Devcon streams' },
      containerId: container?.id,
    });
  });

  it('takes the container away with the client', () => {
    const client = createLibraryClient({
      url: 'https://id.example.com',
      appName: 'Devcon streams',
      onConnectionChange: () => {},
    });

    client.destroy();

    expect(built.destroyed).toBe(1);
    expect(document.querySelector(FRAME_CONTAINER)).toBeNull();
  });
});
