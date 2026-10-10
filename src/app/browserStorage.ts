/**
 * This browser's localStorage, read and written so that a refusal never breaks the page. A browser can
 * refuse the page its storage, in a private window or with site data blocked, and then a choice holds
 * for the visit and is not remembered.
 */

/** What of the browser's storage this needs, so a test can hand it one in memory. */
export type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStorage(): BrowserStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStored(storage: BrowserStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(storage: BrowserStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // The choice holds for this visit and is not remembered.
  }
}

export function removeStored(storage: BrowserStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Left in place, and read again on the next visit.
  }
}
