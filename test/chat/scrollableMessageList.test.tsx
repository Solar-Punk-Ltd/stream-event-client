// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrollableMessageList } from '../../src/features/chat/Chat/ScrollableMessageList/ScrollableMessageList';
import type { VisibleMessage } from '../../src/features/chat/useSwarmChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom lays nothing out, so every message is given this height and the list this window. */
const MESSAGE_PX = 100;
const WINDOW_PX = 300;
const ME = '0x' + 'a'.repeat(40);
const OTHER = '0x' + 'b'.repeat(40);

let host: HTMLDivElement;
let root: Root;

function message(id: number, address: string): VisibleMessage {
  return { id: `m${id}`, address, message: `text ${id}`, timestamp: id } as unknown as VisibleMessage;
}

function render(items: VisibleMessage[]) {
  act(() => {
    root.render(
      createElement(ScrollableMessageList, {
        items,
        label: 'Messages',
        isOwn: (item: VisibleMessage) => item.address === ME,
        renderItem: (item: VisibleMessage) => createElement('li', { key: item.id }, item.id),
      }),
    );
  });
}

function list(): HTMLOListElement {
  const element = host.querySelector('ol');
  if (!element) throw new Error('no list');
  return element;
}

function scrollTo(top: number) {
  act(() => {
    list().scrollTop = top;
    list().dispatchEvent(new Event('scroll'));
  });
}

function atBottom(): boolean {
  return list().scrollTop + WINDOW_PX >= list().scrollHeight;
}

const history = Array.from({ length: 10 }, (_, i) => message(i + 1, OTHER));

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Object.defineProperty(HTMLOListElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLOListElement) {
      return this.children.length * MESSAGE_PX;
    },
  });
  Object.defineProperty(HTMLOListElement.prototype, 'clientHeight', { configurable: true, get: () => WINDOW_PX });
  const tops = new WeakMap<HTMLOListElement, number>();
  Object.defineProperty(HTMLOListElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLOListElement) {
      return tops.get(this) ?? 0;
    },
    // A browser stops a list at its last screenful, which jsdom does not.
    set(this: HTMLOListElement, top: number) {
      tops.set(this, Math.max(0, Math.min(top, this.scrollHeight - WINDOW_PX)));
    },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the chat list follows the newest messages', () => {
  it('opens at the newest message', () => {
    render(history);

    expect(atBottom()).toBe(true);
  });

  it('keeps following a viewer at the bottom when a message taller than the slack arrives', () => {
    render(history);

    render([...history, message(11, OTHER)]);

    expect(atBottom()).toBe(true);
  });

  it('leaves a viewer who scrolled up to read where they are when someone else writes', () => {
    render(history);
    scrollTo(200);

    render([...history, message(11, OTHER)]);

    expect(list().scrollTop).toBe(200);
  });

  it('brings a viewer who scrolled up down to the message they just sent', () => {
    render(history);
    scrollTo(200);

    render([...history, message(11, ME)]);

    expect(atBottom()).toBe(true);
  });

  it('leaves the place alone when older messages, the viewer own among them, are loaded above', () => {
    render(history);
    scrollTo(200);

    render([message(-1, ME), message(0, OTHER), ...history]);

    expect(list().scrollTop).toBe(200);
  });
});
