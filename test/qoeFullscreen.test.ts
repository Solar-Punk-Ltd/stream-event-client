// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  exitFullscreenOf,
  fullscreenHandOver,
  panelHost,
  requestFullscreenOn,
} from '../src/features/player/overlays/qoe/qoeFullscreen';

/** A player box with a video in it, and a second video elsewhere on the page. */
function page() {
  const body = document.createElement('body');
  const player = document.createElement('div');
  const video = document.createElement('video');
  const audio = document.createElement('audio');
  player.append(video, audio);
  const elsewhere = document.createElement('video');
  const panel = document.createElement('section');
  body.append(player, elsewhere, panel);
  return { body, player, video, audio, elsewhere, panel };
}

describe('panelHost', () => {
  const { body, player, video, audio, panel } = page();
  const img = document.createElement('img');
  const iframe = document.createElement('iframe');
  const canvas = document.createElement('canvas');

  const cases: Array<[string, Element | null, Element]> = [
    ['nothing in full screen', null, body],
    ['the player', player, player],
    ['another container', panel, panel],
    ['a video', video, body],
    ['an audio element', audio, body],
    ['an image', img, body],
    ['a frame', iframe, body],
    ['a canvas', canvas, body],
  ];
  for (const [name, fullscreen, expected] of cases) {
    it(`renders the panel in ${expected === body ? 'the page' : 'the element'} with ${name} in full screen`, () => {
      expect(panelHost(fullscreen, body)).toBe(expected);
    });
  }
});

describe('fullscreenHandOver', () => {
  const { player, video, audio, elsewhere, panel } = page();

  const cases: Array<[string, Element | null, Element | null, Element | null | undefined, string]> = [
    ['nothing in full screen', null, null, player, 'none'],
    ['no player known', video, null, undefined, 'none'],
    ['the player itself', player, null, player, 'none'],
    ['a container, not a video', panel, null, player, 'none'],
    ['a video of another player', elsewhere, null, player, 'none'],
    ['this player’s video, from the page', video, null, player, 'to-player'],
    ['this player’s video, from another element in full screen', video, panel, player, 'to-player'],
    ['this player’s audio element', audio, null, player, 'to-player'],
    ['this player’s video, pressed from inside the player in full screen', video, player, player, 'exit'],
  ];
  for (const [name, fullscreen, previous, ownPlayer, expected] of cases) {
    it(`asks for ${expected} with ${name}`, () => {
      expect(fullscreenHandOver(fullscreen, previous, ownPlayer)).toBe(expected);
    });
  }
});

describe('requestFullscreenOn', () => {
  it('uses the standard call, and says it was granted', async () => {
    const calls: string[] = [];
    const element = { requestFullscreen: async () => void calls.push('standard') } as unknown as Element;
    expect(await requestFullscreenOn(element)).toBe(true);
    expect(calls).toEqual(['standard']);
  });

  it('falls back to Safari’s older call where the standard one is missing', async () => {
    const calls: string[] = [];
    const element = { webkitRequestFullscreen: () => void calls.push('webkit') } as unknown as Element;
    expect(await requestFullscreenOn(element)).toBe(true);
    expect(calls).toEqual(['webkit']);
  });

  it('says refused when the browser rejects the request or offers no way to make it', async () => {
    const rejecting = {
      requestFullscreen: async () => {
        throw new TypeError('Permissions check failed');
      },
    } as unknown as Element;
    const throwing = {
      webkitRequestFullscreen: () => {
        throw new Error('not allowed');
      },
    } as unknown as Element;
    expect(await requestFullscreenOn(rejecting)).toBe(false);
    expect(await requestFullscreenOn(throwing)).toBe(false);
    expect(await requestFullscreenOn({} as Element)).toBe(false);
  });
});

describe('exitFullscreenOf', () => {
  it('uses the standard call, then Safari’s older one, and says refused when neither works', async () => {
    const calls: string[] = [];
    expect(
      await exitFullscreenOf({ exitFullscreen: async () => void calls.push('standard') } as unknown as Document),
    ).toBe(true);
    expect(
      await exitFullscreenOf({ webkitExitFullscreen: () => void calls.push('webkit') } as unknown as Document),
    ).toBe(true);
    expect(calls).toEqual(['standard', 'webkit']);
    expect(await exitFullscreenOf({} as Document)).toBe(false);
  });
});
