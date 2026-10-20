import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Topic } from '@ethersphere/bee-js';
import { ABR_BANDWIDTH_FACTOR, ABR_BANDWIDTH_UP_FACTOR } from '@/shared/abrTuning';
import Hls, { ErrorDetails, type ErrorData, ErrorTypes, Events } from 'hls.js';

import { MEDIA_TYPE_VIDEO, MediaType, Rendition } from '@/features/catalog/stream';

import { FeedStateOverlay } from './overlays/feed/FeedStateOverlay';
import { QoeOverlay } from './overlays/qoe/QoeOverlay';
import { attachQoeTracking, initialMetrics, QoeMetrics } from './overlays/qoe/useHlsQoeMetrics';
import { CustomFragmentLoader, CustomManifestLoader, manifestFetcher } from './CustomManifestLoader';
import { FEED_STATE_LIVE, FeedState } from './feedState';
import { LiveGapBudgetPerStream, skipFailedLiveSegment } from './liveSegmentGaps';
import { attachLiveSyncToSegmentLength } from './liveSyncLength';
import { ManifestStateManager } from './ManifestManagement';
import { nextMediaErrorAction, NO_MEDIA_ERRORS_YET, recoverFromMediaError } from './mediaErrorRecovery';
import { attachPlaybackStallReporter } from './playbackHealth';
import { buildPlayerConfig, HLS_TUNING } from './playerConfig';
import { followPlace, type StreamPlace } from './placeAcrossSwap';
import { buildSwarmUri } from './playlist';
import { hasPlayedPast, nextRestartResume, type RestartResume, restartResumeOf } from './restartResume';
import { attachResumeOnReturn } from './resumeOnReturn';
import { attachReturningBroadcastRejoin } from './returningBroadcast';
import { attachActiveRungFollower, attachRungFailover, attachWatchedRungReporter } from './rungHealth';
import { segmentLoadFailure } from './segmentLoads';

import './SwarmHlsPlayer.scss';

/** Pins playback to a named rung, `AUTO_LEVEL` hands the choice back to hls.js's ABR. */
const AUTO_LEVEL = 'auto';

/**
 * The settings this component lets a caller retune.
 *
 * Deliberately narrower than `Partial<HlsConfig>`: that type also advertises `xhrSetup`, `loader`,
 * `abrController` and friends, none of which survive the serialisation below, so promising them
 * would let a caller write code that compiles and silently never runs.
 */
interface HlsTuning {
  liveSyncDuration?: number;
  liveMaxLatencyDuration?: number;
  maxLiveSyncPlaybackRate?: number;
  maxBufferLength?: number;
  maxMaxBufferLength?: number;
  maxBufferSize?: number;
  maxBufferHole?: number;
  abrEwmaFastLive?: number;
  abrEwmaSlowLive?: number;
  abrEwmaDefaultEstimate?: number;
  abrBandWidthFactor?: number;
  abrBandWidthUpFactor?: number;
  maxStarvationDelay?: number;
  capLevelToPlayerSize?: boolean;
  testBandwidth?: boolean;
}

/**
 * How this player is tuned for a Swarm-backed live stream. The numbers are deliberately not hls.js's
 * own defaults.
 *
 * The one worth knowing about is `liveSyncDuration`. It is a latency *target*: hls.js parks the
 * playhead that many seconds behind the live edge (`latency-controller.ts`, `targetLatency` then
 * `liveSyncPosition = liveEdge - targetLatency`). The shipped target is three segments of the
 * playlist's segment length, never under 12 s, and moves when a playlist names a new length (see
 * `liveSyncLength.ts`). Only a caller's own override stays fixed. hls.js's own default is
 * `liveSyncDurationCount: 3`, a count multiplied by the playlist's target duration, which tracks
 * segment length but has no floor. Setting one of these forbids the other: `mergeConfig` throws on
 * a config carrying both.
 *
 * What the target also has to be checked against is the engine's **playlist window**, because
 * `liveSyncPosition` is clamped to `edge - levelDetails.totalduration`. A target as long as the
 * window parks the playhead on the oldest fragment, at the eviction boundary. The two engines
 * express that window differently, so the margin differs. SRS's `hls_window` is a fixed duration,
 * 15 s by default, 3 s clear of the 12 s floor, and from 5 s segments the three-segment target
 * reaches the window's oldest fragment. OME's window is `SegmentCount x SegmentDuration`, which at
 * its defaults is 5 x 2s = 10s, **shorter than the 12 s floor**, so an OME stage at its defaults
 * joins a viewer at the window's oldest fragment with 10 s of runway rather than 12. At longer
 * segments and OME's default count of five, the window stays two segments ahead of the
 * three-segment target.
 */
const DEFAULT_HLS_TUNING: Readonly<HlsTuning> = Object.freeze({
  // Spread rather than restated, so the numbers have one home.
  ...HLS_TUNING,

  // --- ABR ---
  //
  // hls.js computes throughput as `bytes / (loading.end - loading.first)`. Over a CDN that is a
  // measurement of a pipe. Over Swarm it is not: a 2s 1080p segment is a few hundred chunks fanned
  // out across neighbourhoods, and the elapsed time is dominated by retrieval latency rather than
  // by any rate. Consecutive samples therefore swing hard, and hls.js's default half-lives turn
  // that swing into level flapping, so both are lengthened well past them (3 and 9).
  abrEwmaFastLive: 9,
  abrEwmaSlowLive: 27,

  // A floor only. Once the ladder has been parsed, {@link startAtTopRung} raises the estimate to
  // whatever the top rung needs, because any fixed number here is a guess that the ABR gate then
  // treats as a hard ceiling. This value is what a session runs on for the brief window before the
  // master is read, and for a single-rendition stream, where it changes nothing.
  abrEwmaDefaultEstimate: 2_000_000,

  // hls.js's startup probe fetches the first fragment at a low level to measure throughput. That
  // measurement is retrieval latency here, so it produces a number that is not bandwidth. The
  // seeded estimate is the more honest input.
  testBandwidth: false,

  // Off, and this is load-bearing rather than a preference. `capLevelToPlayerSize` caps ABR at the
  // first rung whose width or height reaches `max(playerWidth, playerHeight) x devicePixelRatio`,
  // and it sets `autoLevelCapping`, which ABR cannot exceed for any bandwidth. In a 420px-wide
  // player at devicePixelRatio 1 that resolves to 640x360, the bottom rung, pinned there
  // permanently and regardless of how fast Swarm is answering. Sizing the ladder to the box is the
  // right production default. It is the wrong thing to leave on while measuring what the ladder can
  // reach. See the watch page, which is laid out wide for the same reason.
  capLevelToPlayerSize: false,

  // hls.js's own defaults, named in src/shared/abrTuning.ts. Sweepable from a caller.
  abrBandWidthFactor: ABR_BANDWIDTH_FACTOR,
  abrBandWidthUpFactor: ABR_BANDWIDTH_UP_FACTOR,
  maxStarvationDelay: 4,
});

/**
 * A tuning override, reduced to the values it can actually apply and the ones it can survive.
 *
 * Restricted to the keys above for a reason that is not tidiness: `mergeConfig` refuses a config
 * carrying both `liveSyncDuration` and `liveSyncDurationCount`, and these defaults always supply
 * the first, so letting the second through would throw inside the effect and take the tree down.
 *
 * Non-finite numbers are dropped rather than passed through, because `JSON` turns `NaN` and
 * `Infinity` into `null`, and a `null` here does not fall back to the default, it replaces it.
 * `maxBufferLength: null` reaches hls.js as `Math.max(null, …)`, which is zero, and a player that
 * buffers nothing stalls forever. `Number(searchParams.get('buf'))` on bad input hits exactly this.
 * Booleans have no such hazard and survive the round trip as themselves.
 *
 * Sorted, so a config assembled in a different key order is still the same config and does not
 * tear the player down and rebuild it mid-playback.
 */
function tuningKey(tuning: HlsTuning): string {
  const tunable = new Set(Object.keys(DEFAULT_HLS_TUNING));
  const usable = Object.entries(tuning)
    .filter((entry): entry is [string, number | boolean] => {
      const [key, value] = entry;
      return tunable.has(key) && (typeof value === 'boolean' || Number.isFinite(value));
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(usable));
}

/**
 * Identity of a ladder, by the only parts of it the player has to be rebuilt for.
 *
 * Deliberately excludes bandwidth. The uploader keeps correcting each rung's measured bandwidth,
 * and rebuilding the player every time it did would restart playback every half minute. A session
 * therefore runs on the bandwidths that had landed by the time hls.js read the master, which for
 * a live stream is once, at the start, and later corrections benefit later sessions.
 */
function ladderKey(renditions: Rendition[] | undefined): string {
  if (!renditions || renditions.length === 0) {
    return '';
  }

  return renditions.map((r) => `${r.name}:${r.topic}`).join('|');
}

/** The rung to aim at: tallest, and among equals the one carrying the most bits. */
function topLevelIndex(levels: readonly { height: number; maxBitrate: number }[]): number {
  return levels.reduce((best, level, index) => {
    const incumbent = levels[best];
    const taller = level.height > incumbent.height;
    const fatter = level.height === incumbent.height && level.maxBitrate > incumbent.maxBitrate;
    return taller || fatter ? index : best;
  }, 0);
}

/**
 * Starts the session on the top rung and lets measurement bring it down, rather than starting at
 * the bottom and waiting for measurement to let it up.
 *
 * The second is what hls.js does by default and it cannot work over Swarm. `findBestLevel` will
 * only move up to a rung when `abrBandWidthUpFactor x bandwidthEstimate >= BANDWIDTH`, and
 * `bandwidthEstimate` moves only on fragments actually fetched: with `testBandwidth` off there is
 * no probe, and a probe would measure retrieval latency rather than a rate anyway. So a viewer
 * fetching 700 kbps segments measures roughly 700 kbps, concludes 700 kbps is all it can afford,
 * and never tries the rung that would have told it otherwise. The floor is self-fulfilling.
 *
 * Seeding the estimate at exactly what the top rung needs under the up-switch factor inverts that:
 * the whole ladder is affordable from cold, and the first real fragments then move the estimate.
 * If Swarm keeps up it stays high. If it does not, the EWMA falls and, faster, the starvation
 * path in `findBestLevel` drops the level as the buffer drains. Falling back on evidence, rather
 * than never climbing for want of it.
 *
 * The cost is an honest one: the first fragment is a top-rung fragment, so a viewer on a slow
 * gateway pays a slower startup before the first down-switch. That is the trade this branch is
 * making, and it is what `abrEwmaFastLive` governs the speed of.
 */
function startAtTopRung(hls: Hls): void {
  const levels = hls.levels;
  if (levels.length < 2) {
    return;
  }

  // Clamped because this is a divisor and the factor is caller-tunable for exactly this kind of
  // sweep. A zero would seed an infinite estimate, which hls.js then multiplies by the same zero
  // and compares as NaN: no rung is ever selectable and playback simply never starts.
  const upFactor = Math.min(Math.max(hls.config.abrBandWidthUpFactor, 0.1), 1);
  const top = topLevelIndex(levels);
  const affordable = levels[top].maxBitrate / upFactor;

  // Never downward: a caller that deliberately seeded higher keeps its number.
  hls.bandwidthEstimate = Math.max(hls.config.abrEwmaDefaultEstimate, Math.round(affordable));

  // `startLevel` picks the first fragment only, and leaves ABR enabled, unlike `currentLevel`,
  // which would pin the session to this rung for good.
  hls.startLevel = top;
}

/**
 * Pins hls.js to one rung. Called only when a rung was asked for. Otherwise ABR chooses.
 *
 * Matched by feed URI where the catalog supplied one, because a rung's topic is the one attribute
 * of a level that came from this ladder and cannot collide with another rung's. Falling back to the
 * height in the rung's name covers the session driven purely by a published master, which knows
 * every level's resolution but has no rendition names to match against.
 *
 * Assigning `currentLevel` is also what turns ABR off: a `startLevel` alone only picks where it
 * begins, and it would switch away on the first throughput sample.
 */
function applyLevel(hls: Hls, owner: string, renditions: Rendition[], level: string): void {
  const target = renditions.find((r) => r.name === level);

  const index = target
    ? hls.levels.findIndex((candidate) => candidate.uri === buildSwarmUri(owner, target.topic))
    : levelIndexByName(hls, level);

  if (index < 0) {
    console.warn(`Rendition "${level}" is not among the parsed levels, leaving selection on auto`);
    return;
  }

  hls.currentLevel = index;
}

/** `720p` -> the parsed level 720 rows tall, so a rung can be pinned without a catalog entry. */
function levelIndexByName(hls: Hls, level: string): number {
  const height = Number.parseInt(level, 10);
  if (!Number.isFinite(height)) {
    return -1;
  }

  return hls.levels.findIndex((candidate) => candidate.height === height);
}

// TODO Consider switching to React.MediaHTMLAttributes<HTMLMediaElement> to support <audio> as well
interface HlsPlayerProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  owner: string;
  topicString: string;
  mediaType: MediaType;
  enableQoeOverlay?: boolean;
  /**
   * The stream's ABR ladder. Absent or empty, the player reads `topicString` as a single media
   * playlist on its own.
   */
  renditions?: Rendition[];
  /**
   * Rung to pin playback to, by name. Omitted, or {@link AUTO_LEVEL}, leaves the choice to ABR,
   * which is the default. Pinning is for isolating one rung, comparing it against the others, or
   * telling a bad rung apart from a bad switch. Ignored without a ladder.
   */
  level?: string;
  /**
   * Overrides merged over {@link DEFAULT_HLS_TUNING}.
   *
   * Compared by value rather than by reference, so passing an object literal is safe: it does not
   * hand the effect a new identity on every render and tear the player down mid-playback. A change
   * in the values themselves does rebuild the player, which loses playback position.
   */
  hlsConfig?: HlsTuning;
  /**
   * Called when a ladder marker names a rung that `renditions` lacks, which means the entry was read
   * before every quality had reported to the admin, or before any had. The page reads the stream list's
   * next slot once: an entry naming more rungs rebuilds the player. At most once per marker period, for
   * a bounded time after each build.
   */
  onLadderShort?: () => void;
  /**
   * Where the viewer was in a recording when another player played it, which this player starts at once, and records
   * as it is taken down. Absent for a live stream.
   */
  place?: StreamPlace;
}

/** The key both the manifest state and the feed state are held under. Null if the name is unusable. */
function toHexTopic(topicString: string): string | null {
  try {
    return Topic.fromString(topicString).toString();
  } catch (error) {
    console.warn('Not a usable topic name:', topicString, error);
    return null;
  }
}

export const SwarmHlsPlayer: React.FC<HlsPlayerProps> = ({
  owner,
  topicString,
  mediaType,
  autoPlay = true,
  controls = true,
  enableQoeOverlay = false,
  renditions,
  level,
  hlsConfig,
  onLadderShort,
  place,
  ...videoProps
}) => {
  const [restartTrigger, setRestartTrigger] = useState(0);
  const [metrics, setMetrics] = useState<QoeMetrics>(initialMetrics);
  const [feedState, setFeedState] = useState<FeedState>(FEED_STATE_LIVE);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsConfigKey = tuningKey(hlsConfig ?? {});
  const renditionKey = ladderKey(renditions);

  // Read through a ref, not a dependency. The list arrives as a fresh array on each catalog read,
  // and for a recording on every render, so depending on it directly would tear the player down and
  // rebuild it each time. `renditionKey` is what the effect actually reacts to.
  const renditionsRef = useRef(renditions);
  renditionsRef.current = renditions;
  const onLadderShortRef = useRef(onLadderShort);
  onLadderShortRef.current = onLadderShort;
  // Held by the component rather than the effect below, so a restart finds the budget its stream spent.
  const [liveGapBudgets] = useState(() => new LiveGapBudgetPerStream());
  // Held by the component for the same reason: the player a restart builds reads where the old one was.
  const resumeAfterRestartRef = useRef<RestartResume | null>(null);
  const placeRef = useRef(place);
  placeRef.current = place;
  // The stream place this player last started from. Each stream's place is where this player starts it, once, so a
  // restart that keeps no place of its own, as a broadcast that came back does, is not sent back to it.
  const startedFromPlaceRef = useRef<StreamPlace | null>(null);

  // Deliberately not part of the effect below, which reruns on every restart. A fatal network error
  // is what causes a restart, so a subscription torn down and rebuilt with the player would be
  // dropped at exactly the moment it has something to say. The tracker replays on subscribe, so a
  // mount that lands in the middle of an outage still hears about it.
  useEffect(() => {
    const hexTopic = toHexTopic(topicString);
    if (!hexTopic) {
      return;
    }
    return manifestFetcher.feedHealth.subscribe(hexTopic, setFeedState);
  }, [topicString]);

  const sourceStartsSlowly = useSyncExternalStore(manifestFetcher.subscribeStartsSlowly, manifestFetcher.startsSlowly);
  const [showsPicture, setShowsPicture] = useState(false);
  // Outside the player's effect for the same reason as the subscription above: a restart before the
  // first picture is still the same wait, and one after it is the feed overlay's to explain.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    setShowsPicture(false);
    const onPicture = () => setShowsPicture(true);
    video.addEventListener('loadeddata', onPicture);
    return () => video.removeEventListener('loadeddata', onPicture);
  }, [owner, topicString, mediaType]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const sourceUrl = buildSwarmUri(owner, topicString);
    const liveGapBudget = liveGapBudgets.forStream(sourceUrl);
    const ladder = renditionsRef.current;

    // A ladder the stream list names. Its master is built from the list and the master feed is never
    // read. A stream the list names no renditions for is recognised by the loader from its feed.
    const isLadder = renditionKey.length > 0 && !!ladder;

    if (isLadder) {
      manifestFetcher.registerLadder(sourceUrl, () => ({
        owner,
        renditions: renditionsRef.current ?? ladder,
      }));
    }
    // The list is not polled once the player is mounted, so a viewer who joined while only some
    // qualities had reported, or none, would keep that ladder for the whole talk.
    const stopLadderWatch = manifestFetcher.watchLadderCompletion(
      sourceUrl,
      owner,
      () => (renditionsRef.current ?? []).map((rendition) => Topic.fromString(rendition.topic).toString()),
      () => onLadderShortRef.current?.(),
    );

    let hls: Hls | null = null;
    // A caller that sets its own live target keeps it, whatever its value. Only the shipped one
    // follows the segment length.
    const callerTuning = JSON.parse(hlsConfigKey) as HlsTuning;

    const onHlsPause = () => {
      hls?.stopLoad();
    };
    // Where this player was asked to start, until its first segment is in. hls.js forgets a start position when
    // `startLoad` is called again before then, and autoplay's play event calls it at once, which sent a viewer whose
    // place was kept back to the start (measured 2026-10-18).
    let pendingStartS: number | undefined;
    const onHlsPlay = () => {
      hls?.startLoad(pendingStartS);
    };
    let detachResumeOnReturn: (() => void) | null = null;
    let detachStartedAt: (() => void) | null = null;
    // Whether the first playlist this player read was finished. One joined live counts its time from where it joined,
    // which no other player's timeline shares, even once the broadcast ends.
    let isRecordingTimeline: boolean | null = null;
    const followed = followPlace(video);
    // Read once for the stream this run plays, because the page renders the next stream's place before this run's
    // cleanup records where the viewer was in this one.
    const streamPlace = placeRef.current ?? null;

    if (Hls.isSupported()) {
      const tuning: HlsTuning = { ...DEFAULT_HLS_TUNING, ...callerTuning };
      hls = new Hls(buildPlayerConfig({ pLoader: CustomManifestLoader, fLoader: CustomFragmentLoader }, tuning));

      // Where this player was asked to start, held until playback plays past it. A player that fails
      // before then holds no level, or a playhead that says nothing, so this is still the viewer's place.
      let startedAt: RestartResume | null = null;
      const onHlsTimeUpdate = () => {
        if (startedAt && hasPlayedPast(startedAt, video.currentTime)) {
          startedAt = null;
        }
      };
      video.addEventListener('timeupdate', onHlsTimeUpdate);
      detachStartedAt = () => video.removeEventListener('timeupdate', onHlsTimeUpdate);

      const restartStream = (cause: ErrorData) => {
        console.warn(`Restarting stream after a fatal ${cause.type} (${cause.details}).`);
        const playlist = hls?.levels[hls.currentLevel]?.details;
        const observed = restartResumeOf(playlist, video.currentTime, sourceUrl);
        resumeAfterRestartRef.current = nextRestartResume(
          observed,
          startedAt,
          resumeAfterRestartRef.current,
          playlist,
          cause,
        );
        detachResumeOnReturn?.();
        hls?.destroy();
        setRestartTrigger((prev) => prev + 1);
      };

      // Held across errors rather than inside the handler, because the escalation is about how many
      // failures arrived in a row and a per-event value cannot remember that.
      let mediaErrors = NO_MEDIA_ERRORS_YET;

      video.addEventListener('pause', onHlsPause);
      video.addEventListener('play', onHlsPlay);
      // An iPhone pauses the video when the phone locks and does not resume it on unlock.
      const returningHls = hls;
      detachResumeOnReturn = attachResumeOnReturn(
        video,
        { document, window },
        () => returningHls.latestLevelDetails?.live ?? false,
        (err) => {
          console.warn('[SwarmHls] resuming the live stream after the page came back failed:', err);
        },
      );

      hls.on(Events.FRAG_LOADED, () => manifestFetcher.reportSegmentLoad({ loaded: true }));
      hls.on(Events.FRAG_BUFFERED, () => {
        pendingStartS = undefined;
      });
      hls.on(Events.LEVEL_LOADED, (_event, data) => {
        isRecordingTimeline ??= !data.details.live;
      });
      hls.on(Events.ERROR, (_event, data) => {
        const segmentFailure = segmentLoadFailure(data);
        if (segmentFailure) {
          manifestFetcher.reportSegmentLoad(segmentFailure);
        }
        if (
          hls &&
          skipFailedLiveSegment(
            hls,
            data,
            (levelUri, fragmentUrl) => manifestFetcher.markLiveSegmentGap(levelUri, fragmentUrl),
            liveGapBudget,
            performance.now(),
            video.currentTime,
          )
        ) {
          return;
        }

        if (data.fatal) {
          console.error('HLS.js fatal error:', data.type, data.details);
        } else {
          console.warn('HLS.js non-fatal error:', data.details, data.error?.message ?? '');
          return;
        }

        if (data.details === ErrorDetails.LEVEL_PARSING_ERROR) {
          console.error('Media sequence mismatch detected, reloading stream.');
          restartStream(data);
          return;
        }

        switch (data.type) {
          case ErrorTypes.NETWORK_ERROR:
            console.warn('Fatal network error');
            restartStream(data);
            break;
          case ErrorTypes.MEDIA_ERROR: {
            // Recovery re-appends the media that just failed, so calling it on every fatal media
            // error with no window and no ending is an unbounded loop that refetches fragments each
            // turn. A broadcast whose opening media a decoder will not accept would leave a viewer
            // on a black player pulling media for as long as the tab stayed open.
            const decision = nextMediaErrorAction(mediaErrors, performance.now());
            mediaErrors = decision.state;
            console.warn(`Fatal media error, ${decision.action}`);
            if (decision.action === 'restart') {
              restartStream(data);
              break;
            }
            // Playhead read before recovery detaches the media. recoverFromMediaError starts loading
            // by hand when it is zero, which covers an error before loading ever started.
            if (hls) {
              recoverFromMediaError(hls, video.currentTime, decision.action === 'swap-codec-and-recover');
            }
            break;
          }
          default:
            console.error('Unrecoverable fatal error. Destroying and restarting.');
            restartStream(data);
            break;
        }
      });

      hls.attachMedia(video);
      hls.loadSource(sourceUrl);

      hls.on(Events.MANIFEST_PARSED, () => {
        // The ladder is whatever hls.js parsed, not whatever the catalog said: a published master
        // is the authority on which rungs exist, and a deep link may have had no catalog at all.
        const pinned = !!level && level !== AUTO_LEVEL;
        if (pinned) {
          applyLevel(hls!, owner, renditionsRef.current ?? ladder ?? [], level!);
        } else {
          startAtTopRung(hls!);
        }

        const resume = resumeAfterRestartRef.current;
        resumeAfterRestartRef.current = null;
        startedAt = resume?.sourceUrl === sourceUrl ? resume : null;
        const swapPlace = streamPlace === startedFromPlaceRef.current ? null : (streamPlace?.recorded() ?? null);
        startedFromPlaceRef.current = streamPlace;
        if (swapPlace?.paused) {
          video.autoplay = false;
        }
        pendingStartS = startedAt?.positionS ?? swapPlace?.positionS;
        hls!.startLoad(pendingStartS);

        if (autoPlay && !swapPlace?.paused) {
          video.play().catch((err) => {
            console.warn('Auto-play failed:', err);
          });
        }
      });
    } else {
      console.error('HLS is not supported in this browser.');
    }

    const detachQoe = enableQoeOverlay ? attachQoeTracking(video, hls, setMetrics) : null;
    const detachLiveSync = hls ? attachLiveSyncToSegmentLength(hls, callerTuning) : null;

    // Both halves of what a ladder viewer needs when one rung stops being produced, and neither
    // works alone: the failover moves the picture, the reporter is what lets the overlay say so
    // during the seconds before it does. A single-rendition stream gets neither, because there is
    // no second rung to move to and nothing for a group's health to be folded from.
    //
    // Read this before switching it off. Earlier versions of the rule judged a rung by comparing
    // it with its siblings, and three of them dropped healthy rungs during the settle, before any
    // fault. The poller now judges the playing rung by its own progress and confirms with one sibling's
    // (`LadderFeedPoller`), so a rung is only ever dropped on evidence that a sibling is moving.
    //
    // The reporter stays on either way: a viewer on a dead rung is told the feed has stalled rather
    // than being shown `live`.
    const RUNG_FAILOVER_ENABLED = true;
    const ladderTopic = isLadder ? toHexTopic(topicString) : null;
    const detachRungFailover =
      hls && RUNG_FAILOVER_ENABLED ? attachRungFailover(hls, manifestFetcher.feedHealth) : null;
    const detachWatchedRung =
      hls && ladderTopic ? attachWatchedRungReporter(hls, ladderTopic, manifestFetcher.feedHealth) : null;

    // The poller follows only the rung hls.js plays, so it is told when that changes, and reads the
    // playhead at a switch so a viewer behind the live edge keeps their place. Both for any ladder,
    // including one the catalog never named, which only the published master revealed.
    const detachRungFollower = hls
      ? attachActiveRungFollower(hls, (rung, loading) => manifestFetcher.followOnlyRung(rung, loading))
      : null;
    const playingHls = hls;
    const detachPlayhead = playingHls
      ? manifestFetcher.attachPlayhead(sourceUrl, () => playingHls.playingDate?.getTime() ?? null)
      : null;

    // Attached with the player rather than with the subscription above, because it is the player
    // that stalls: a restart builds a fresh media pipeline and the stalls of the one before it are
    // not the new one's. The burst they feed lives in the tracker, which does outlive the restart.
    const stallTopic = toHexTopic(topicString);
    const detachStallReporter = stallTopic
      ? attachPlaybackStallReporter(video, () => manifestFetcher.feedHealth.recordPlaybackStall(stallTopic))
      : null;

    // A broadcast that ended can come back. A declared stream's broadcaster who stops and returns
    // continues the same feeds at the next index, and both followers keep a slow watch on the slot
    // after a finished playlist to find that out. This is the half that acts on it: once the return is
    // announced and this viewer has reached the end of what they were playing, the player restarts,
    // and the restart bootstraps at the live edge like any other mount. Measured live 2026-09-24: a
    // viewer who had watched the end was still on it fifteen minutes after the broadcaster returned,
    // and only a reload found the broadcast live. `returningBroadcast.ts` says why it waits for the end.
    const returnTopic = toHexTopic(topicString);
    const detachReturnRejoin =
      hls && returnTopic
        ? attachReturningBroadcastRejoin(video, manifestFetcher.feedHealth, returnTopic, () => {
            console.info('[SwarmHls] the broadcast has come back and this viewer reached the end, rejoining it live');
            setRestartTrigger((prev) => prev + 1);
          })
        : null;

    return () => {
      followed.detach();
      if (isRecordingTimeline) {
        streamPlace?.record(followed.place());
      }
      stopLadderWatch();
      video.removeEventListener('pause', onHlsPause);
      video.removeEventListener('play', onHlsPlay);
      detachResumeOnReturn?.();
      detachStartedAt?.();
      detachQoe?.();
      detachLiveSync?.();
      detachStallReporter?.();
      detachReturnRejoin?.();
      detachRungFailover?.();
      detachWatchedRung?.();
      detachRungFollower?.();
      detachPlayhead?.();

      // Stops every rung this source registered and discards its accumulated playlist, including rungs discovered
      // from a published master that this component never saw.
      manifestFetcher.unregisterLadder(sourceUrl);

      if (hls) {
        // The source feed, on top of the rungs `unregisterLadder` has already stopped. For a
        // single-rendition stream it is the media playlist and holds the only state there is. For a
        // ladder it is the master, and clearing it is a no-op. Leaving either behind would have the
        // next session resume someone else's playlist.
        //
        // The destroy runs whatever the clear does. Losing it leaks the loaders and the media
        // attachment of every player the page has ever mounted, and a cleanup that throws takes the
        // rest of React's cleanup with it, so this is not a guarantee to drop for tidiness.
        try {
          const hexTopic = toHexTopic(topicString);
          if (hexTopic) {
            ManifestStateManager.getInstance().clear(hexTopic);
          }
        } finally {
          hls.destroy();
          hls = null;
        }
      }
    };
    // `mediaType` is here although nothing above reads it, and it is not removable. It decides
    // whether the element below is a `video` or an `audio`, so React swaps the element when it
    // changes and `videoRef.current` becomes a different node. Without it this effect does not
    // re-run, and hls.js stays attached to the element React has already removed: a dead player with
    // no error. Reached by editing /watch/video/... to /watch/audio/... with the same owner and
    // topic, which is the only navigation that changes the media type and nothing else.
  }, [autoPlay, restartTrigger, enableQoeOverlay, owner, topicString, mediaType, hlsConfigKey, renditionKey, level]);

  const videoEl =
    mediaType === MEDIA_TYPE_VIDEO ? (
      <video ref={videoRef} controls={controls} autoPlay={autoPlay} muted playsInline {...videoProps} />
    ) : (
      <audio
        className="swarm-hls-player-audio"
        ref={videoRef as React.RefObject<HTMLAudioElement>}
        controls={controls}
        autoPlay={autoPlay}
      />
    );

  return (
    <div ref={wrapperRef} className="swarm-hls-player-wrapper">
      {videoEl}
      <FeedStateOverlay state={feedState} waitingOnSlowSource={sourceStartsSlowly && !showsPicture} />
      {enableQoeOverlay && <QoeOverlay metrics={metrics} topic={topicString} playerRef={wrapperRef} />}
    </div>
  );
};
