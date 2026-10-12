// @vitest-environment jsdom
import { act, createElement, createRef, type RefObject, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QoeOverlay } from '../src/features/player/overlays/qoe/QoeOverlay';
import { initialMetrics } from '../src/features/player/overlays/qoe/useHlsQoeMetrics';
import { click, mount, type Mounted } from './helpers/dom';

/** The key the panel keeps its place under, written out so a renamed key is a visible change. */
const STORAGE_KEY = 'stream-event-client:qoe-panel.v1';
const BUTTON = 32;

let mounted: Mounted | null = null;
let fullscreen: Element | null = null;
const popoverCalls: string[] = [];

function setViewport(width: number, height: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
}

/** A player box on the page, as getBoundingClientRect reports it. */
function playerAt(element: HTMLElement, left: number, top: number, width: number, height: number) {
  element.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
}

function render(): { player: HTMLDivElement } {
  const player = document.createElement('div');
  player.className = 'player-under-test';
  playerAt(player, 100, 80, 640, 360);
  document.body.appendChild(player);
  const ref = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
  (ref as { current: HTMLElement | null }).current = player;
  mounted = mount(createElement(QoeOverlay, { metrics: initialMetrics(), release: 'test-build', playerRef: ref }));
  return { player };
}

function overlay(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.qoe-overlay');
  if (!found) throw new Error('no overlay');
  return found;
}

/** The panel rectangle and button as the overlay draws them, in viewport px. */
function drawn() {
  const el = overlay();
  const frame = el.querySelector<HTMLElement>('.qoe-overlay__frame');
  return {
    button: { x: parseFloat(el.style.left), y: parseFloat(el.style.top) },
    panel: frame ? { width: parseFloat(frame.style.width), height: parseFloat(frame.style.height) } : null,
  };
}

function saved(): { x: number; y: number; width: number; height: number; open: boolean } {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

function enterFullscreen(element: Element | null) {
  fullscreen = element;
  act(() => {
    document.dispatchEvent(new Event('fullscreenchange'));
  });
}

beforeEach(() => {
  localStorage.clear();
  setViewport(1024, 768);
  fullscreen = null;
  popoverCalls.length = 0;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.showPopover = function showPopover(this: HTMLElement) {
    popoverCalls.push(`show:${this.className}`);
  };
  proto.hidePopover = function hidePopover(this: HTMLElement) {
    popoverCalls.push(`hide:${this.className}`);
  };
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete proto.showPopover;
  delete proto.hidePopover;
});

describe('where the QoE panel lives', () => {
  it('is in the page, outside the player, so the player cannot clip it', () => {
    const { player } = render();

    expect(player.contains(overlay())).toBe(false);
    expect(overlay().parentElement).toBe(document.body);
    // The control: the overlay is there and placed.
    expect(drawn().panel).not.toBeNull();
  });

  it('opens at the player’s top right, in viewport px, when nothing is saved', () => {
    render();
    // 50 px in from the player's right edge at 740, 10 px below its top at 80.
    expect(drawn().button).toEqual({ x: 740 - 50, y: 90 });
  });

  it('finds the player when it is the panel’s own parent, as the watch page renders it, whose ref attaches last', () => {
    function Player() {
      const ref = useRef<HTMLDivElement>(null);
      return createElement(
        'div',
        { ref, className: 'player-under-test' },
        createElement(QoeOverlay, { metrics: initialMetrics(), release: 'test-build', playerRef: ref }),
      );
    }
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.className === 'player-under-test'
        ? ({ left: 24, top: 153, width: 976, height: 549, right: 1000, bottom: 702, x: 24, y: 153 } as DOMRect)
        : original.call(this);
    };
    try {
      mounted = mount(createElement(Player));
      expect(drawn().button).toEqual({ x: 1000 - 50, y: 163 });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it('is shown in the top layer, so it stays above a player in full screen', () => {
    render();
    expect(overlay().getAttribute('popover')).toBe('manual');
    expect(popoverCalls).toContain('show:qoe-overlay');
  });
});

describe('a saved place', () => {
  it('that is now off screen is pulled back in, header and toggle inside the window', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 5000, y: 5000, width: 300, height: 400, open: true }));
    render();

    const { button, panel } = drawn();
    expect(panel).toEqual({ width: 300, height: 400 });
    expect(button.x).toBe(1024 - BUTTON);
    expect(button.y + 36 + 400).toBe(768);
  });

  it('that is above and left of the window comes back to its corner', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: -900, y: -900, width: 300, height: 400, open: true }));
    render();

    const { button } = drawn();
    expect(button).toEqual({ x: 300 - BUTTON, y: 0 });
  });

  it('remembers the panel collapsed, and the toggle stays inside the window', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 5000, y: -5000, width: 300, height: 400, open: false }));
    render();

    expect(drawn().panel).toBeNull();
    expect(overlay().querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    expect(drawn().button).toEqual({ x: 1024 - BUTTON, y: 0 });
  });

  it('records the panel opened and closed with the toggle', () => {
    render();
    const toggle = overlay().querySelector('button')!;

    click(toggle);
    expect(saved().open).toBe(false);
    click(toggle);
    expect(saved().open).toBe(true);
  });

  it('records the size a resize grip leaves behind', () => {
    render();
    const before = drawn().panel!;
    const grip = overlay().querySelector<HTMLElement>('.qoe-overlay__handle--se')!;

    act(() => {
      grip.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 }),
      );
    });
    act(() => {
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: -60, clientY: -40 }));
    });
    act(() => {
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: -60, clientY: -40 }));
    });

    expect(drawn().panel).toEqual({ width: before.width - 60, height: before.height - 40 });
    expect(saved()).toMatchObject({ width: before.width - 60, height: before.height - 40, open: true });
  });
});

describe('when the window changes', () => {
  it('pulls the panel back in after the window shrinks', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 600, y: 300, width: 300, height: 400, open: true }));
    render();

    setViewport(640, 480);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const { button, panel } = drawn();
    expect(button.x + BUTTON).toBeLessThanOrEqual(640);
    expect(button.y + 36 + panel!.height).toBeLessThanOrEqual(480);
    expect(button.y).toBeGreaterThanOrEqual(0);
  });
});

describe('in full screen', () => {
  it('moves into the element in full screen, and back to the page when full screen ends', () => {
    const { player } = render();

    enterFullscreen(player);
    expect(overlay().parentElement).toBe(player);

    enterFullscreen(null);
    expect(overlay().parentElement).toBe(document.body);
  });

  it('stays in the page above a video in full screen, raised to the top of the top layer again', () => {
    const { player } = render();
    const video = document.createElement('video');
    player.appendChild(video);
    popoverCalls.length = 0;

    enterFullscreen(video);

    expect(overlay().parentElement).toBe(document.body);
    expect(popoverCalls).toEqual(['hide:qoe-overlay', 'show:qoe-overlay']);
  });

  /**
   * A browser's own video controls put the `<video>` alone in full screen, and Chrome then makes
   * everything outside it inert, a panel in the top layer included: drawn, but deaf to the mouse. So the
   * full screen is handed to the player around the video, which the panel can live inside.
   */
  it('hands a video’s full screen to the player around it, so the panel inside stays usable', () => {
    const { player } = render();
    const video = document.createElement('video');
    player.appendChild(video);
    const requested: Element[] = [];
    player.requestFullscreen = async function (this: Element) {
      requested.push(this);
    };

    enterFullscreen(video);

    expect(requested).toEqual([player]);
  });

  it('leaves full screen when the video’s own control is used again while the player is in full screen', () => {
    const { player } = render();
    const video = document.createElement('video');
    player.appendChild(video);
    player.requestFullscreen = async () => {};
    let exits = 0;
    document.exitFullscreen = async () => {
      exits += 1;
    };

    enterFullscreen(player);
    enterFullscreen(video);

    expect(exits).toBe(1);
  });

  it('leaves a video of another player on the page alone', () => {
    const { player } = render();
    const other = document.createElement('video');
    document.body.appendChild(other);
    const requested: Element[] = [];
    player.requestFullscreen = async function (this: Element) {
      requested.push(this);
    };

    enterFullscreen(other);

    expect(requested).toEqual([]);
  });

  it('clamps to the full-screen window, and again to the page when full screen ends', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 600, y: 300, width: 300, height: 400, open: true }));
    const { player } = render();

    setViewport(1920, 1080);
    enterFullscreen(player);
    setViewport(500, 400);
    enterFullscreen(null);

    const { button, panel } = drawn();
    expect(button.x + BUTTON).toBeLessThanOrEqual(500);
    expect(button.y + 36 + panel!.height).toBeLessThanOrEqual(400);
  });
});
