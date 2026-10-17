// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { OwnPlayer } from '../../src/swarm/provider';
import type { Weeb3Node } from '../../src/swarm/providers/weeb-3/weeb3Package';
import { stoppableHls } from '../../src/swarm/providers/weeb-3/weeb3Playback';
import { Weeb3Provider, type Weeb3RuntimeView } from '../../src/swarm/providers/weeb-3/weeb3Provider';

const OWNER = 'a'.repeat(40);

/** hls.js as far as loading goes: it loads segments while it has a source, a video and a started load. */
class FakeHls {
  media: unknown = null;
  source: string | null = null;
  started = false;
  destroyed = 0;

  get loading(): boolean {
    return this.media !== null && this.source !== null && this.started;
  }

  attachMedia(media: unknown): void {
    this.media = media;
  }

  detachMedia(): void {
    this.media = null;
  }

  loadSource(url: string): void {
    this.source = url;
  }

  startLoad(): void {
    this.started = true;
  }

  stopLoad(): void {
    this.started = false;
  }

  recoverMediaError(): void {
    this.started = true;
  }

  resumeBuffering(): void {
    this.started = true;
  }

  transferMedia(): unknown {
    const { media } = this;
    this.media = null;
    return media;
  }

  destroy(): void {
    this.destroyed += 1;
    this.detachMedia();
  }
}

/** The player class weeb-3 builds, a subclass of what its `import("hls.js")` answers, as its `hls_loader.js` does. */
const Weeb3Hls = class extends stoppableHls(FakeHls) {};

/**
 * A node whose `attachStream` plays with a new player each time, as weeb-3's does, and keeps every one it made. A slow
 * one makes its player only after the stream's first playlist has been read.
 */
function nodeMaking(players: FakeHls[], slow: boolean): Weeb3Node {
  return {
    start: () => undefined,
    connectionCount: async () => 5,
    attachStream: async (media, _owner, topic) => {
      if (slow) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const hls = new Weeb3Hls();
      players.push(hls);
      hls.attachMedia(media);
      hls.loadSource(`/weeb-3/hls/${topic}`);
      hls.startLoad();
    },
    setStreamQuality: () => undefined,
    postPushChunk: async () => 'Upload result: success',
    free: () => undefined,
  };
}

function ownPlayerOn(players: FakeHls[], slow = false): () => Promise<OwnPlayer> {
  return ownPlayerWith(nodeMaking(players, slow));
}

function ownPlayerWith(node: Weeb3Node): () => Promise<OwnPlayer> {
  const runtime: Weeb3RuntimeView = {
    status: () => ({ state: 'ready', peers: 5 }),
    acquire: async () => node,
    release: () => undefined,
    whenReady: async () => node,
    restart: () => undefined,
  };
  return new Weeb3Provider({ runtime, fetcher: fetch, pageOrigin: 'http://127.0.0.1:4173' }).ownPlayer;
}

describe("weeb-3's own player, once let go", () => {
  it('stops loading for the video it played into', async () => {
    const players: FakeHls[] = [];
    const video = document.createElement('video');
    const player = await ownPlayerOn(players)();
    await player.attach(video, OWNER, 'one', 'beginning');
    expect(players[0].loading).toBe(true);

    player.detach();

    expect(players[0].loading).toBe(false);
    expect(players[0].media).toBeNull();
  });

  it("loads nothing when weeb-3's recovery starts it again or makes a new player for that video", async () => {
    const players: FakeHls[] = [];
    const video = document.createElement('video');
    const player = await ownPlayerOn(players)();
    await player.attach(video, OWNER, 'one', 'beginning');
    player.detach();

    const [stopped] = players;
    stopped.attachMedia(video);
    stopped.loadSource('/weeb-3/hls/again');
    stopped.startLoad();
    stopped.recoverMediaError();
    stopped.resumeBuffering();
    const fresh = new Weeb3Hls();
    fresh.attachMedia(video);
    fresh.loadSource('/weeb-3/hls/again');
    fresh.startLoad();

    expect(stopped).toMatchObject({ media: null, source: '/weeb-3/hls/one', started: false });
    expect(stopped.transferMedia()).toBeNull();
    expect(fresh).toMatchObject({ media: null, source: null, started: false });
  });

  it('is torn down once, however often weeb-3 destroys it after', async () => {
    const players: FakeHls[] = [];
    const video = document.createElement('video');
    const player = await ownPlayerOn(players)();
    await player.attach(video, OWNER, 'one', 'beginning');
    player.detach();

    players[0].destroy();
    player.detach();

    expect(players[0].destroyed).toBe(1);
  });

  it('plays again when the same video is attached to another stream', async () => {
    const players: FakeHls[] = [];
    const video = document.createElement('video');
    const load = ownPlayerOn(players);
    const first = await load();
    await first.attach(video, OWNER, 'one', 'beginning');
    first.detach();

    const second = await load();
    await second.attach(video, OWNER, 'two', 'live');

    expect(players[1].loading).toBe(true);
    expect(players[1].source).toBe('/weeb-3/hls/two');
  });

  it("leaves weeb-3's player for another video playing", async () => {
    const players: FakeHls[] = [];
    const load = ownPlayerOn(players);
    const left = await load();
    const kept = await load();
    await left.attach(document.createElement('video'), OWNER, 'one', 'beginning');
    await kept.attach(document.createElement('video'), OWNER, 'two', 'beginning');

    left.detach();

    expect(players[0].loading).toBe(false);
    expect(players[1].loading).toBe(true);
  });

  it('empties the video, which stops a stream the browser plays natively without hls.js', async () => {
    const video = document.createElement('video');
    const calls: string[] = [];
    video.pause = () => void calls.push('pause');
    video.load = () => void calls.push('load');
    const node = nodeMaking([], false);
    node.attachStream = async (media) => {
      media.src = '/weeb-3/feeds/an-owner/a-topic';
    };
    const player = await ownPlayerWith(node)();
    await player.attach(video, OWNER, 'one', 'beginning');

    player.detach();

    expect(video.hasAttribute('src')).toBe(false);
    expect(calls).toEqual(['pause', 'load']);
  });

  it('stops a player weeb-3 makes after the viewer has already left', async () => {
    const players: FakeHls[] = [];
    const video = document.createElement('video');
    const player = await ownPlayerOn(players, true)();
    const attaching = player.attach(video, OWNER, 'one', 'beginning');
    player.detach();
    await attaching;

    expect(players[0].loading).toBe(false);
  });
});
