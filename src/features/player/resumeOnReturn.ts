import type Hls from 'hls.js';

/** What the player does when the page becomes visible again. */
export type ReturnDecision = 'leave' | 'resume-at-live' | 'jump-to-live';

/** What the rule reads off the page, the media element and hls.js at the moment the page comes back. */
export interface ReturnSnapshot {
  readonly isLive: boolean;
  readonly isPaused: boolean;
  /** When the media element last paused, on the same clock as `hiddenAtMs`, or null when it never has. */
  readonly pausedAtMs: number | null;
  /** When the page last went hidden, or null when it never has. */
  readonly hiddenAtMs: number | null;
  /** Seconds between the playhead and the estimated live edge, or null when hls.js has no playlist yet. */
  readonly behindLiveS: number | null;
  /** The latency past which hls.js itself moves a live viewer forward, `hls.maxLatency`. */
  readonly maxLatencyS: number;
}

export function decideOnReturn(_snapshot: ReturnSnapshot): ReturnDecision {
  return 'leave';
}

/** The part of hls.js a return reads and drives. */
export type LivePlayer = Pick<Hls, 'liveSyncPosition' | 'maxLatency' | 'startLoad'> & {
  readonly latestLevelDetails: { readonly live: boolean; readonly edge: number; readonly age: number } | null;
};

/** Where the page says it was hidden and shown: `visibilitychange` on the document, `pagehide` and `pageshow` on the window. */
export interface ReturnPage {
  readonly document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  readonly window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export function attachResumeOnReturn(
  _media: HTMLMediaElement,
  _page: ReturnPage,
  _player: LivePlayer,
  _reportPlayFailure: (error: unknown) => void,
  _now: () => number = () => performance.now(),
): () => void {
  return () => undefined;
}
