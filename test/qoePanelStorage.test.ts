import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  loadPanelState,
  parseSavedPanel,
  QOE_PANEL_STORAGE_KEY,
  savePanelState,
} from '../src/features/player/overlays/qoe/qoePanelStorage';

const GOOD = { x: 10, y: 50, width: 200, height: 150, open: true };

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('parseSavedPanel', () => {
  it('is null for nothing saved', () => {
    assert.equal(parseSavedPanel(null), null);
    assert.equal(parseSavedPanel(''), null);
  });

  it('is null for a value that is not JSON or not an object', () => {
    for (const raw of ['{', 'not json', 'null', '42', '"text"', '[1,2,3,4]']) {
      assert.equal(parseSavedPanel(raw), null, raw);
    }
  });

  it('is null when a field of the rectangle is missing, not a number or not finite', () => {
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      const missing: Record<string, unknown> = { ...GOOD };
      delete missing[field];
      assert.equal(parseSavedPanel(JSON.stringify(missing)), null, `${field} missing`);
      assert.equal(parseSavedPanel(JSON.stringify({ ...GOOD, [field]: '10' })), null, `${field} a string`);
      assert.equal(parseSavedPanel(JSON.stringify({ ...GOOD, [field]: Infinity })), null, `${field} infinite`);
    }
  });

  it('is null for a size that is not positive', () => {
    assert.equal(parseSavedPanel(JSON.stringify({ ...GOOD, width: 0 })), null);
    assert.equal(parseSavedPanel(JSON.stringify({ ...GOOD, height: -5 })), null);
  });

  it('reads a good value, keeping only its five fields', () => {
    assert.deepEqual(parseSavedPanel(JSON.stringify({ ...GOOD, extra: true })), GOOD);
    assert.deepEqual(parseSavedPanel(JSON.stringify({ ...GOOD, open: false })), { ...GOOD, open: false });
  });

  it('reads the panel as open when the saved value says nothing true or false about it', () => {
    const { open: _open, ...rect } = GOOD;
    assert.equal(parseSavedPanel(JSON.stringify(rect))?.open, true);
    assert.equal(parseSavedPanel(JSON.stringify({ ...rect, open: 'no' }))?.open, true);
  });
});

describe('loadPanelState and savePanelState', () => {
  it('uses one versioned key of this viewer', () => {
    assert.equal(QOE_PANEL_STORAGE_KEY, 'stream-event-client:qoe-panel.v1');
  });

  it('round-trips the rectangle and whether the panel is open under that key', () => {
    const storage = memoryStorage();
    savePanelState(storage, { x: 1, y: 2, width: 300, height: 400, open: false });
    assert.deepEqual(JSON.parse(storage.items.get(QOE_PANEL_STORAGE_KEY)!), {
      x: 1,
      y: 2,
      width: 300,
      height: 400,
      open: false,
    });
    assert.deepEqual(loadPanelState(storage), { x: 1, y: 2, width: 300, height: 400, open: false });
  });

  it('reads nothing, and throws nothing, from storage that throws or is absent', () => {
    assert.equal(loadPanelState(throwing), null);
    assert.equal(loadPanelState(null), null);
    assert.doesNotThrow(() => savePanelState(throwing, GOOD));
    assert.doesNotThrow(() => savePanelState(null, GOOD));
  });

  it('reads nothing from a bad saved value', () => {
    const storage = memoryStorage();
    storage.items.set(QOE_PANEL_STORAGE_KEY, '{"x":1');
    assert.equal(loadPanelState(storage), null);
  });
});
