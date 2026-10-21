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

let visualViewport: EventTarget;
let scrolled: Element[];
let mounted: Mounted | null = null;

beforeEach(() => {
  pageResized.length = 0;
  scrolled = [];
  visualViewport = new EventTarget();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
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

describe('the chat field on a phone', () => {
  it('scrolls back into view when the keyboard narrows the visible area while it has focus', () => {
    const input = field();
    act(() => input.focus());
    scrolled.length = 0;

    act(() => {
      visualViewport.dispatchEvent(new Event('resize'));
    });

    expect(scrolled).toEqual([input]);
  });

  it('scrolls back into view when the page grows above it while it has focus', () => {
    const input = field();
    act(() => input.focus());
    scrolled.length = 0;

    act(() => pageResized.forEach((onResize) => onResize()));

    expect(scrolled).toEqual([input]);
  });

  it('leaves the page alone once it has lost focus', () => {
    const input = field();
    act(() => input.focus());
    act(() => input.blur());
    scrolled.length = 0;

    act(() => {
      visualViewport.dispatchEvent(new Event('resize'));
    });
    act(() => pageResized.forEach((onResize) => onResize()));

    expect(scrolled).toEqual([]);
    expect(pageResized).toEqual([]);
  });
});
