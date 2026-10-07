// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { Dialog } from '../src/shared/components/Dialog/Dialog';

// React only runs effects inside act() when told it is in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

function renderDialog(open: boolean, onClose = vi.fn(), { autoFocusFirst = false } = {}) {
  act(() => {
    root.render(
      open
        ? createElement(
            Dialog,
            { title: 'Pick one', onClose },
            createElement('input', { 'aria-label': 'first', autoFocus: autoFocusFirst }),
            createElement('button', { type: 'button' }, 'last'),
          )
        : null,
    );
  });
  return onClose;
}

function press(key: string, shiftKey = false) {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });
}

beforeEach(() => {
  opener = document.createElement('button');
  opener.textContent = 'open';
  document.body.appendChild(opener);
  opener.focus();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('a dialog', () => {
  it('is announced as a modal dialog named by its title', () => {
    renderDialog(true);
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'no element with role="dialog"');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    assert.ok(labelId);
    assert.equal(document.getElementById(labelId)?.textContent, 'Pick one');
  });

  it('moves focus inside when it opens', () => {
    renderDialog(true);
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'first');
  });

  it('keeps focus inside when Tab passes the last control, and when Shift+Tab passes the first', () => {
    renderDialog(true);
    const last = document.querySelector('[role="dialog"] button:last-of-type') as HTMLButtonElement;
    act(() => last.focus());
    press('Tab');
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'first');
    press('Tab', true);
    assert.equal(document.activeElement, last);
  });

  it('closes on Escape', () => {
    const onClose = renderDialog(true);
    press('Escape');
    assert.equal(onClose.mock.calls.length, 1);
  });

  it('closes on Escape after the focused control was disabled and focus fell back to the page', () => {
    const onClose = renderDialog(true);
    act(() => (document.activeElement as HTMLElement).blur());
    assert.equal(document.activeElement, document.body);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(onClose.mock.calls.length, 1);
  });

  it('brings Tab back inside after focus fell back to the page', () => {
    renderDialog(true);
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'first');
  });

  it('closes on a click outside it and not on a click inside it', () => {
    const onClose = renderDialog(true);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    act(() => dialog.click());
    assert.equal(onClose.mock.calls.length, 0);
    act(() => (dialog.parentElement as HTMLElement).click());
    assert.equal(onClose.mock.calls.length, 1);
  });

  it('closes from a close button named for a screen reader, when asked for one', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(Dialog, { title: 'Pick one', onClose, closeLabel: 'Close sources' }, 'body'));
    });
    const close = document.querySelector('[role="dialog"] button[aria-label="Close sources"]') as HTMLButtonElement;
    assert.ok(close, 'no close button');
    act(() => close.click());
    assert.equal(onClose.mock.calls.length, 1);
  });

  it('has no close button unless asked for one', () => {
    renderDialog(true);
    assert.equal(document.querySelectorAll('[role="dialog"] button').length, 1);
  });

  it('gives focus back to what had it before it opened', () => {
    renderDialog(true);
    renderDialog(false);
    assert.equal(document.activeElement, opener);
  });

  it('gives focus back to the opener when a control inside took focus on its own', () => {
    renderDialog(true, vi.fn(), { autoFocusFirst: true });
    assert.equal(document.activeElement?.getAttribute('aria-label'), 'first');
    renderDialog(false);
    assert.equal(document.activeElement, opener);
  });
});
