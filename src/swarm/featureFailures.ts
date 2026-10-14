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

/** A feature that has read nothing for this long is not failing, since nothing on screen waits on it any more. */
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

export class FeatureFailureLog {
  private readonly byFeature = new Map<SwarmFeature, FeatureReads>();

  /** One read of a feature, from when it started, ended in an answer from a provider. */
  note(feature: SwarmFeature, provider: string, startedAtMs: number, answer: SwarmAnswer, nowMs: number): void {
    if (answer.kind === 'aborted') {
      return;
    }
    const reads = this.byFeature.get(feature) ?? { provider, failingSinceMs: null, lastCause: null, lastReadAtMs: 0 };
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
    this.byFeature.set(feature, reads);
  }

  /** The features failing now, in the order they first read. */
  failures(nowMs: number): FeatureFailure[] {
    return [...this.byFeature].flatMap(([feature, reads]): FeatureFailure[] => {
      const { failingSinceMs, lastCause, lastReadAtMs, provider } = reads;
      if (failingSinceMs === null || lastCause === null) {
        return [];
      }
      const forMs = nowMs - failingSinceMs;
      if (forMs < FAILING_AFTER_MS || nowMs - lastReadAtMs > QUIET_AFTER_MS) {
        return [];
      }
      return [{ feature, provider, forMs, cause: lastCause }];
    });
  }
}
