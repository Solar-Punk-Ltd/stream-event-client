/** A pause the media element reported, on the same clock as the page's hidden time. */
interface PauseRecord {
  readonly atMs: number;
  readonly whilePageVisible: boolean;
}

/** What the rule reads off the page and the media element at the moment the page comes back. */
export interface ReturnSnapshot {
  readonly isLive: boolean;
  readonly isPaused: boolean;
  /** The last pause the element reported, or null when it reported none. */
  readonly lastPause: PauseRecord | null;
  /** When the page last went hidden, or null when it never has. */
  readonly hiddenAtMs: number | null;
}

export function isViewerPause(_pause: PauseRecord, _hiddenAtMs: number | null): boolean {
  return true;
}

export function decideOnReturn(_snapshot: ReturnSnapshot): 'play' | 'leave' {
  return 'leave';
}

/** Where the page says it was hidden and shown: `visibilitychange` on the document, `pagehide` and `pageshow` on the window. */
export interface ReturnPage {
  readonly document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  readonly window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export function attachResumeOnReturn(
  _media: HTMLMediaElement,
  _page: ReturnPage,
  _isLive: () => boolean,
  _reportPlayFailure: (error: unknown) => void,
  _now: () => number = () => performance.now(),
): () => void {
  return () => undefined;
}
