/**
 * Stopping weeb-3's own player, which weeb-3 0.0.354001 names no way to do. Its player is a subclass of whatever its
 * `import("hls.js")` answers, and the build answers that with `weeb3Hls.ts`, the class `stoppableHls` makes, so every
 * player weeb-3 builds is recorded here by the video it plays into. This module imports no hls.js of its own, so the
 * provider can use it without the first page load carrying the player.
 */

/** The part of hls.js weeb-3 calls that loads, or that stopping a player uses. */
interface StoppableHls {
  attachMedia(media: unknown): void;
  detachMedia(): void;
  loadSource(url: string): void;
  startLoad(startPosition?: number, skipSeekToStartPosition?: boolean): void;
  stopLoad(): void;
  recoverMediaError(): void;
  resumeBuffering(): void;
  transferMedia(): unknown;
  destroy(): void;
}

// A mixin's base must be constructible with any arguments, which TypeScript only accepts written as any[].
type HlsClass = new (...args: any[]) => StoppableHls;

interface Stoppable {
  stop(): void;
}

const playersByMedia = new WeakMap<object, Set<Stoppable>>();
const stoppedMedia = new WeakSet<object>();

/** The video an `attachMedia` argument names: the element itself, or hls.js's `{ media }` attaching data. */
function mediaOf(data: unknown): object | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  if ('media' in data) {
    const { media } = data as { media: unknown };
    return typeof media === 'object' && media !== null ? media : null;
  }
  return data;
}

/**
 * hls.js as weeb-3 builds its player on, with every player recorded by the video it attaches to. Once stopped, a
 * player is destroyed, and everything weeb-3's recovery could call to load again does nothing, as does attaching any
 * player to a stopped video until the page attaches a stream to it again. weeb-3 holds on to the player and calls it
 * later, so a stopped one answers rather than throwing on its destroyed state.
 */
export function stoppableHls<T extends HlsClass>(Hls: T): T {
  return class extends Hls implements Stoppable {
    private ownPlaybackStopped = false;
    private ownPlaybackDestroyed = false;

    attachMedia(data: unknown): void {
      const media = mediaOf(data);
      if (media !== null && stoppedMedia.has(media)) {
        this.ownPlaybackStopped = true;
      }
      if (this.ownPlaybackStopped) {
        return;
      }
      if (media !== null) {
        const players = playersByMedia.get(media) ?? new Set<Stoppable>();
        players.add(this);
        playersByMedia.set(media, players);
      }
      super.attachMedia(data);
    }

    loadSource(url: string): void {
      if (!this.ownPlaybackStopped) {
        super.loadSource(url);
      }
    }

    startLoad(startPosition?: number, skipSeekToStartPosition?: boolean): void {
      if (!this.ownPlaybackStopped) {
        super.startLoad(startPosition, skipSeekToStartPosition);
      }
    }

    recoverMediaError(): void {
      if (!this.ownPlaybackStopped) {
        super.recoverMediaError();
      }
    }

    resumeBuffering(): void {
      if (!this.ownPlaybackStopped) {
        super.resumeBuffering();
      }
    }

    transferMedia(): unknown {
      return this.ownPlaybackStopped ? null : super.transferMedia();
    }

    destroy(): void {
      if (!this.ownPlaybackDestroyed) {
        this.ownPlaybackDestroyed = true;
        super.destroy();
      }
    }

    stop(): void {
      if (this.ownPlaybackStopped) {
        return;
      }
      this.ownPlaybackStopped = true;
      super.stopLoad();
      this.destroy();
    }
  };
}

/**
 * Stops every weeb-3 player playing into this video, and any weeb-3 makes for it later, so it loads no more segments
 * once the viewer has left it. The video is emptied as well, because a browser that plays HLS itself, as Safari does
 * without Media Source Extensions, gets no hls.js player from weeb-3 and keeps downloading the source it was given.
 */
export function stopOwnPlayback(media: HTMLMediaElement): void {
  stoppedMedia.add(media);
  const players = playersByMedia.get(media);
  playersByMedia.delete(media);
  for (const player of players ?? []) {
    player.stop();
  }
  media.pause();
  media.removeAttribute('src');
  media.load();
}

/** Lets weeb-3 play into a video it was stopped on, when the page attaches a stream to it again. */
export function allowOwnPlayback(media: HTMLMediaElement): void {
  stoppedMedia.delete(media);
}
