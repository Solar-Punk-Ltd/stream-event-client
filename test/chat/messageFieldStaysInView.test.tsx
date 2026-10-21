// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageSender } from '../../src/features/chat/Chat/MessageSender/MessageSender';
import { mount, type Mounted } from '../helpers/dom';

// On a phone the keyboard came up over the chat field when the page grew above it after the field was
// tapped, as when the stream's title arrives late on a first open. jsdom has neither a ResizeObserver nor a visual
// viewport, so both are stood in for, and each test fires them by hand.
const pageResized: (() => void)[] = [];
class FakeResizeObserver {
  constructor(private readonly onResize: () => void) {}
  observe() {
    pageResized.push(this.onResize);
  }
  disconnect() {
    const index = pageResized.indexOf(this.onResize);
    if (index >= 0) pageResized.splice(index, 1);
  }
}

/** A visual viewport whose height and zoom a test sets. */
class FakeVisualViewport extends EventTarget {
  height = window.innerHeight;
  scale = 1;
}

const KEYBOARD_PX = 300;

let visualViewport: FakeVisualViewport;
let scrolled: Element[];
let scrollOptions: (ScrollIntoViewOptions | boolean | undefined)[];
let mounted: Mounted | null = null;

beforeEach(() => {
  pageResized.length = 0;
  scrolled = [];
  scrollOptions = [];
  visualViewport = new FakeVisualViewport();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
  Element.prototype.scrollIntoView = function (this: Element, options?: ScrollIntoViewOptions | boolean) {
    scrolled.push(this);
    scrollOptions.push(options);
  };
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete (window as { visualViewport?: unknown }).visualViewport;
});

function field(): HTMLInputElement {
  mounted = mount(createElement(MessageSender, { onSend: async () => {}, label: 'Message', placeholder: 'Say hi' }));
  return document.querySelector('input.message-sender-input') as HTMLInputElement;
}

function visibleAreaResizes(height: number, scale = 1) {
  visualViewport.height = height;
  visualViewport.scale = scale;
  act(() => {
    visualViewport.dispatchEvent(new Event('resize'));
  });
}

function pageGrows() {
  act(() => pageResized.forEach((onResize) => onResize()));
}

describe('the chat field on a phone', () => {
  it('scrolls back into view, only as far as it must, when the keyboard opens while it has focus', () => {
    const input = field();
    act(() => input.focus());

    visibleAreaResizes(window.innerHeight - KEYBOARD_PX);

    expect(scrolled).toEqual([input]);
    expect(scrollOptions).toEqual([{ block: 'nearest' }]);
  });

  it('scrolls back into view when the page grows above it while the keyboard is up', () => {
    const input = field();
    act(() => input.focus());
    visibleAreaResizes(window.innerHeight - KEYBOARD_PX);
    scrolled.length = 0;

    pageGrows();

    expect(scrolled).toEqual([input]);
  });

  it('leaves the page where the viewer scrolled it once the keyboard is closed, though the field keeps focus', () => {
    const input = field();
    act(() => input.focus());
    visibleAreaResizes(window.innerHeight - KEYBOARD_PX);
    visibleAreaResizes(window.innerHeight);
    scrolled.length = 0;

    pageGrows();
    visibleAreaResizes(window.innerHeight - 56);

    expect(scrolled).toEqual([]);
  });

  it('reads a pinch zoom as no keyboard', () => {
    const input = field();
    act(() => input.focus());

    visibleAreaResizes(window.innerHeight / 2, 2);

    expect(scrolled).toEqual([]);
  });

  it('leaves the page alone once it has lost focus', () => {
    const input = field();
    act(() => input.focus());
    act(() => input.blur());

    visibleAreaResizes(window.innerHeight - KEYBOARD_PX);
    pageGrows();

    expect(scrolled).toEqual([]);
    expect(pageResized).toEqual([]);
  });

  it('stops watching when the chat goes away while the field has focus', () => {
    const input = field();
    act(() => input.focus());
    mounted?.unmount();
    mounted = null;

    visibleAreaResizes(window.innerHeight - KEYBOARD_PX);

    expect(scrolled).toEqual([]);
    expect(pageResized).toEqual([]);
  });
});
