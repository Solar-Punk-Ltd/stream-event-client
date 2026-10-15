// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLibraryClient } from '../../src/features/chat/swarmId/swarmIdLibrary';

const built = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  destroyed: 0,
  beeApiUrls: [] as string[],
  stamped: [] as unknown[],
  buttons: [] as Array<{ container: HTMLElement; options: unknown }>,
}));

/** The library's client, as far as building it and taking it down go. Nothing is framed. */
vi.mock('@solarpunkltd/swarm-id', () => ({
  SwarmIdClient: class {
    constructor(options: Record<string, unknown>) {
      built.options.push(options);
    }
    initialize = async () => {};
    mountButton = (container: HTMLElement, options: unknown) => {
      built.buttons.push({ container, options });
      return { ready: Promise.resolve(), update: () => {}, unmount: () => {} };
    };
    disconnect = async () => {};
    getChatKey = async () => new Uint8Array();
    setBeeApiUrl = async (url: string) => {
      built.beeApiUrls.push(url);
    };
    stampChunk = async (chunk: unknown) => {
      built.stamped.push(chunk);
      return { address: 'a'.repeat(64), stamp: 'b'.repeat(226), owner: 'c'.repeat(40), signature: 'd'.repeat(130) };
    };
    getPostageBatch = async () => ({ label: '', utilization: 0.5, usable: true, exists: true, batchTTL: 86_400 });
    get connectionInfo() {
      return {};
    }
    destroy() {
      built.destroyed += 1;
    }
  },
}));

afterEach(() => {
  document.body.innerHTML = '';
  built.options.length = 0;
  built.destroyed = 0;
  built.beeApiUrls.length = 0;
  built.stamped.length = 0;
  built.buttons.length = 0;
});

describe("the library's client", () => {
  it('names the site to the library and hands it nothing to draw, since its session frame shows nothing', () => {
    createLibraryClient({ url: 'https://id.example.com', appName: 'Devcon streams', onConnectionChange: () => {} });

    expect(built.options[0]).toMatchObject({
      iframeOrigin: 'https://id.example.com',
      metadata: { name: 'Devcon streams' },
    });
    expect(built.options[0]).not.toHaveProperty('containerId');
    expect(built.options[0]).not.toHaveProperty('buttonConfig');
    expect(document.body.children).toHaveLength(0);
  });

  it("mounts Swarm ID's button in the container it is given, with the action, the look and the window listener", () => {
    const client = createLibraryClient({
      url: 'https://id.example.com',
      appName: 'Devcon streams',
      onConnectionChange: () => {},
    });
    const container = document.createElement('div');
    const onWindowChange = () => {};

    const mounted = client.mountButton(container, {
      action: 'change-stamp',
      config: { text: 'Change stamp in Swarm ID', backgroundColor: 'orange' },
      onWindowChange,
    });

    expect(built.buttons).toEqual([
      {
        container,
        options: {
          action: 'change-stamp',
          config: { text: 'Change stamp in Swarm ID', backgroundColor: 'orange' },
          onWindowChange,
        },
      },
    ]);
    expect(typeof mounted.unmount).toBe('function');
  });

  it("hands the library the chat history's Bee address at construction and on every change, and none it was not given", async () => {
    const client = createLibraryClient({
      url: 'https://id.example.com',
      appName: 'Devcon streams',
      onConnectionChange: () => {},
      beeApiUrl: 'https://event.example.com/chat',
    });
    await client.setBeeApiUrl('http://localhost:1633');
    createLibraryClient({ url: 'https://id.example.com', appName: 'Devcon streams', onConnectionChange: () => {} });

    expect(built.options[0]).toMatchObject({ beeApiUrl: 'https://event.example.com/chat' });
    expect(built.beeApiUrls).toEqual(['http://localhost:1633']);
    expect(built.options[1]).not.toHaveProperty('beeApiUrl');
  });

  it('takes the client down', () => {
    const client = createLibraryClient({
      url: 'https://id.example.com',
      appName: 'Devcon streams',
      onConnectionChange: () => {},
    });

    client.destroy();

    expect(built.destroyed).toBe(1);
  });

  it("hands a chunk to the frame to stamp, and reads the site's stamp, through the library unchanged", async () => {
    const client = createLibraryClient({
      url: 'https://id.example.com',
      appName: 'Devcon streams',
      onConnectionChange: () => {},
    });
    const chunk = {
      kind: 'soc' as const,
      identifier: 'e'.repeat(64),
      data: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 7]),
      signer: { privateKey: 'f'.repeat(64) },
    };

    expect(await client.stampChunk(chunk)).toMatchObject({ stamp: 'b'.repeat(226), signature: 'd'.repeat(130) });
    expect(built.stamped).toEqual([chunk]);
    expect(await client.getPostageBatch()).toMatchObject({ utilization: 0.5, batchTTL: 86_400 });
  });
});
