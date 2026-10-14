import type Hls from 'hls.js';

/**
 * The player's side of a page that comes back after it was hidden: whether to resume a live stream.
 *
 * An iPhone pauses the video when the phone locks and Safari does not resume it on unlock, so a live
 * viewer came back to a stopped player and had to start it by hand (SPDV-1655). The iOS Simulator
 * resumed by itself after 30 s and 2 min locks, so a return that finds playback running near live
 * does nothing, and this only acts where the system left it stopped or far behind.
 */

/**
 * How long before the page went hidden a pause still counts as the system's.
 *
 * Safari can report the pause a moment before the page reports itself hidden. A viewer who pauses by
 * hand and then locks the phone takes longer than this, so their pause is kept.
 */
const SYSTEM_PAUSE_LEAD_MS = 1000;

/** What the player does when the page becomes visible again. */
type ReturnDecision = 'leave' | 'resume-at-live' | 'jump-to-live';

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

function wasPausedBySystem(snapshot: ReturnSnapshot): boolean {
  return (
    snapshot.pausedAtMs !== null &&
    snapshot.hiddenAtMs !== null &&
    snapshot.pausedAtMs >= snapshot.hiddenAtMs - SYSTEM_PAUSE_LEAD_MS
  );
}

/**
 * Whether a returning live player is resumed, moved to live, or left as it is.
 *
 * ⛔ A pause the viewer made while the page was visible is never resumed, and a recording is never
 * touched: both are where the viewer chose to be.
 */
export function decideOnReturn(snapshot: ReturnSnapshot): ReturnDecision {
  if (!snapshot.isLive) {
    return 'leave';
  }
  if (snapshot.isPaused) {
    return wasPausedBySystem(snapshot) ? 'resume-at-live' : 'leave';
  }
  if (snapshot.behindLiveS !== null && snapshot.behindLiveS > snapshot.maxLatencyS) {
    return 'jump-to-live';
  }
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

/**
 * The live edge is estimated as hls.js's own latency does, the playlist's edge plus the seconds since
 * it was loaded, because a player stopped by a lock has not reloaded its playlist since.
 */
function snapshotOf(
  media: HTMLMediaElement,
  player: LivePlayer,
  pausedAtMs: number | null,
  hiddenAtMs: number | null,
): ReturnSnapshot {
  const details = player.latestLevelDetails;
  return {
    isLive: details?.live ?? false,
    isPaused: media.paused,
    pausedAtMs,
    hiddenAtMs,
    behindLiveS: details ? details.edge + details.age - media.currentTime : null,
    maxLatencyS: player.maxLatency,
  };
}

/**
 * Resume or move to live a stream the system left stopped or far behind while the page was hidden.
 *
 * @param reportPlayFailure Hears a refused `play()`, which a page without a user gesture can get.
 * @returns A detach that removes every listener this added.
 */
export function attachResumeOnReturn(
  media: HTMLMediaElement,
  page: ReturnPage,
  player: LivePlayer,
  reportPlayFailure: (error: unknown) => void,
  now: () => number = () => performance.now(),
): () => void {
  let pausedAtMs: number | null = null;
  let hiddenAtMs: number | null = null;

  const onPause = (): void => {
    pausedAtMs = now();
  };
  const onHidden = (): void => {
    hiddenAtMs = now();
  };

  const onReturn = (): void => {
    const decision = decideOnReturn(snapshotOf(media, player, pausedAtMs, hiddenAtMs));
    if (decision === 'leave') {
      return;
    }
    const livePosition = player.liveSyncPosition;
    if (livePosition !== null) {
      media.currentTime = livePosition;
      player.startLoad(livePosition);
    }
    media.play().catch(reportPlayFailure);
  };

  const onVisibilityChange = (): void => {
    if (page.document.visibilityState === 'hidden') {
      onHidden();
    } else {
      onReturn();
    }
  };
  const onPageShow = (event: Event): void => {
    if ((event as PageTransitionEvent).persisted) {
      onReturn();
    }
  };

  media.addEventListener('pause', onPause);
  page.document.addEventListener('visibilitychange', onVisibilityChange);
  page.window.addEventListener('pagehide', onHidden);
  page.window.addEventListener('pageshow', onPageShow);

  return () => {
    media.removeEventListener('pause', onPause);
    page.document.removeEventListener('visibilitychange', onVisibilityChange);
    page.window.removeEventListener('pagehide', onHidden);
    page.window.removeEventListener('pageshow', onPageShow);
  };
}
