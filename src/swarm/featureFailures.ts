/**
 * Which features keep failing on the source they read from, so the page can say so and let the viewer pick
 * another. Nothing here moves a read anywhere: it only remembers what each feature's reads answered.
 */
import type { SwarmAnswer } from './answers';
import type { SwarmFeature } from './client';

/**
 * How long a feature's reads must have gone without an answer it can use before it counts as failing, so one
 * slow read or a moment of trouble shows no bar.
 */
export const FAILING_AFTER_MS = 10_000;

/** A feature that has read nothing for this long is not failing, since nothing on screen waits on it. */
export const QUIET_AFTER_MS = 30_000;

/** What the last failing read of a feature ended in. */
export type FailureCause =
  /** Nothing came back: the read ran out of time or never reached the source. */
  | { readonly kind: 'no-answer' }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unsupported' };

export interface FeatureFailure {
  readonly feature: SwarmFeature;
  /** The id of the source the feature reads from. */
  readonly provider: string;
  /** How long the feature has gone without an answer it can use. */
  readonly forMs: number;
  readonly cause: FailureCause;
}

interface FeatureReads {
  provider: string;
  /** When the first read of the current run of failures started, or null while the feature is answered. */
  failingSinceMs: number | null;
  lastCause: FailureCause | null;
  lastReadAtMs: number;
}

/** A failing answer's cause, or null for an answer the feature can use or one its own caller stopped. */
function causeOf(answer: SwarmAnswer): FailureCause | null {
  switch (answer.kind) {
    case 'content':
    case 'not-found':
    case 'aborted':
      return null;
    case 'rate-limited':
      return { kind: 'rate-limited' };
    case 'unsupported':
      return { kind: 'unsupported' };
    case 'unavailable':
      return answer.cause.kind === 'status' ? { kind: 'status', status: answer.cause.status } : { kind: 'no-answer' };
  }
}

/**
 * What a feature fetched: its reads through the client, or the URLs the browser and hls.js load for it, such as
 * segments and pictures. Each is judged on its own, so a source that serves feeds and fails every segment still fails.
 */
type FetchChannel = 'reads' | 'urls';

/** How a URL the browser or hls.js loaded for a feature ended: loaded, or failed with the status it answered, if any. */
export type UrlLoadOutcome = { readonly loaded: true } | { readonly loaded: false; readonly status: number | null };

/** A URL load's outcome as the answer a read would have ended in. */
export function answerOfUrlLoad(outcome: UrlLoadOutcome): SwarmAnswer {
  if (outcome.loaded) {
    return { kind: 'content', bytes: new Uint8Array(), feedIndex: null, serverTimeMs: null };
  }
  return outcome.status === null
    ? { kind: 'unavailable', cause: { kind: 'network', error: null } }
    : { kind: 'unavailable', cause: { kind: 'status', status: outcome.status } };
}

export class FeatureFailureLog {
  private readonly byChannel = new Map<string, FeatureReads & { feature: SwarmFeature }>();

  /** One fetch of a feature, from when it started, ended in an answer from a provider. */
  note(
    feature: SwarmFeature,
    provider: string,
    startedAtMs: number,
    answer: SwarmAnswer,
    nowMs: number,
    channel: FetchChannel = 'reads',
  ): void {
    if (answer.kind === 'aborted') {
      return;
    }
    const key = `${feature}|${channel}`;
    const reads = this.byChannel.get(key) ?? {
      feature,
      provider,
      failingSinceMs: null,
      lastCause: null,
      lastReadAtMs: 0,
    };
    reads.provider = provider;
    reads.lastReadAtMs = nowMs;
    const cause = causeOf(answer);
    if (cause === null) {
      reads.failingSinceMs = null;
      reads.lastCause = null;
    } else {
      reads.failingSinceMs ??= startedAtMs;
      reads.lastCause = cause;
    }
    this.byChannel.set(key, reads);
  }

  /** The features failing now, in the order they first fetched, each once, by the fetch that has failed longest. */
  failures(nowMs: number): FeatureFailure[] {
    const byFeature = new Map<SwarmFeature, FeatureFailure>();
    for (const { feature, failingSinceMs, lastCause, lastReadAtMs, provider } of this.byChannel.values()) {
      if (failingSinceMs === null || lastCause === null) {
        continue;
      }
      const forMs = nowMs - failingSinceMs;
      if (forMs < FAILING_AFTER_MS || nowMs - lastReadAtMs > QUIET_AFTER_MS) {
        continue;
      }
      const known = byFeature.get(feature);
      if (!known || known.forMs < forMs) {
        byFeature.set(feature, { feature, provider, forMs, cause: lastCause });
      }
    }
    return [...byFeature.values()];
  }
}
