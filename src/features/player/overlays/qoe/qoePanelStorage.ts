import { type BrowserStorage, readStored, writeStored } from '@/app/browserStorage';

import type { Rect } from './qoeGeometry';

/** Where the panel was left: its rectangle in viewport px, and whether it was open or collapsed to its toggle. */
interface QoePanelState extends Rect {
  open: boolean;
}

/** One key, versioned, so a later change of shape starts from the defaults instead of misreading. */
export const QOE_PANEL_STORAGE_KEY = 'stream-event-client:qoe-panel.v1';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * A saved panel, or null for anything that is not one: absent, not JSON, or a field of the rectangle
 * missing or not finite. A saved value whose open is neither true nor false reads as open, matching a
 * panel with nothing saved, which starts open.
 */
export function parseSavedPanel(raw: string | null): QoePanelState | null {
  if (!raw) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { x, y, width, height, open } = value as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height, open: open !== false };
}

/** The saved panel, as saved: the caller clamps it to the window. Null when storage refuses or holds nothing usable. */
export function loadPanelState(storage: BrowserStorage | null): QoePanelState | null {
  return parseSavedPanel(readStored(storage, QOE_PANEL_STORAGE_KEY));
}

/** Saves where the panel was left, and gives up silently where storage is blocked or full. */
export function savePanelState(storage: BrowserStorage | null, state: QoePanelState): void {
  const { x, y, width, height, open } = state;
  writeStored(storage, QOE_PANEL_STORAGE_KEY, JSON.stringify({ x, y, width, height, open }));
}
