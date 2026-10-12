// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { QoeOverlay } from '../src/features/player/overlays/qoe/QoeOverlay';
import { initialMetrics } from '../src/features/player/overlays/qoe/useHlsQoeMetrics';
import { mount, type Mounted } from './helpers/dom';

const STORAGE_KEY = 'stream-event-client:qoe-panel.v1';

let mounted: Mounted | null = null;

function render() {
  mounted = mount(createElement(QoeOverlay, { metrics: initialMetrics(), release: 'test-build' }));
}

function isOpen(): boolean {
  return document.querySelector('.qoe-overlay__frame') !== null;
}

function savedOpen(): boolean | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { open: boolean }).open : undefined;
}

function pressQ(target: EventTarget, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, ...init }));
  });
}

/** A field of the given kind in the page, as the chat's message field is. */
function field(tag: 'input' | 'textarea' | 'select'): HTMLElement {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1024 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 768 });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('the Q shortcut', () => {
  it('toggles the panel from the page, and remembers whether it is open', () => {
    render();
    expect(isOpen()).toBe(true);

    pressQ(document.body);
    expect(isOpen()).toBe(false);
    expect(savedOpen()).toBe(false);

    pressQ(document.body, { key: 'Q' });
    expect(isOpen()).toBe(true);
    expect(savedOpen()).toBe(true);
  });

  for (const tag of ['input', 'textarea', 'select'] as const) {
    it(`is the text's while typing in a ${tag}`, () => {
      render();
      pressQ(field(tag));
      expect(isOpen()).toBe(true);
    });
  }

  it('is the text’s while typing in an editable element', () => {
    render();
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { configurable: true, value: true });
    document.body.appendChild(editable);

    pressQ(editable);
    expect(isOpen()).toBe(true);
  });

  for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    it(`leaves a ${modifier.replace('Key', '')} chord to the browser`, () => {
      render();
      pressQ(document.body, { [modifier]: true });
      expect(isOpen()).toBe(true);
    });
  }

  it('toggles once for a held key, not once per repeat', () => {
    render();
    pressQ(document.body);
    pressQ(document.body, { repeat: true });
    expect(isOpen()).toBe(false);
  });

  it('is the text’s while an input method is composing a character', () => {
    render();
    pressQ(document.body, { isComposing: true });
    expect(isOpen()).toBe(true);
  });
});
