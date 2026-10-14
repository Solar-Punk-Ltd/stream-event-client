import { ErrorDetails } from 'hls.js';

import type { UrlLoadOutcome } from '@/swarm/client';

/** The part of hls.js's error data that says what failed and what the source answered. */
interface LoadErrorData {
  readonly details: string;
  readonly response?: { readonly code?: number };
}

const SEGMENT_LOAD_ERRORS: ReadonlySet<string> = new Set([
  ErrorDetails.FRAG_LOAD_ERROR,
  ErrorDetails.FRAG_LOAD_TIMEOUT,
]);

/**
 * A segment hls.js could not load, as the outcome the Swarm client counts toward the video failing, or null for an
 * error that is not about loading a segment. hls.js reports code 0 for a request that got no answer at all.
 */
export function segmentLoadFailure(data: LoadErrorData): UrlLoadOutcome | null {
  if (!SEGMENT_LOAD_ERRORS.has(data.details)) {
    return null;
  }
  const status = data.response?.code ?? 0;
  return { loaded: false, status: status > 0 ? status : null };
}
