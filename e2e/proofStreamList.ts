import { Topic } from '@ethersphere/bee-js';

import { nextFeedRequest } from '../src/shared/feedFollow';

/** The stream list the proof answers, since a deployment's list is a placeholder. */
export const PROOF_CATALOG = { owner: `0x${'1'.repeat(40)}`, topic: 'weeb3-proof-stream-list' };

/** The title of the proof's one stream, which the watch page shows once the list has reached it. */
export const PROOF_STREAM_TITLE = 'weeb-3 proof stream';

/**
 * What the proof's config adds for a comma list of peers for the node to dial first, read from the environment since a
 * repository names no real peer. No list leaves the node on its package's own.
 */
export function proofBootnodes(listed: string | undefined): { readonly weeb3?: { readonly bootnodes: string[] } } {
  return listed ? { weeb3: { bootnodes: listed.split(',') } } : {};
}

/** Where the app reads the list's head, taken from the app so the two cannot differ. */
const LIST_HEAD_PATH = nextFeedRequest(PROOF_CATALOG.owner, Topic.fromString(PROOF_CATALOG.topic), null).path;

const feedIndexHeader = (index: number) => index.toString(16).padStart(16, '0');

/** What the gateway answers to one request under `gatewayPath`. */
interface ProofGatewayAnswer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** The stream list as one entry for the stream, at index 0, and nothing else at the gateway. */
export function proofGatewayAnswer(
  gatewayPath: string,
  pathname: string,
  stream: { readonly owner: string; readonly topic: string },
): ProofGatewayAnswer {
  if (pathname === `${gatewayPath}/${LIST_HEAD_PATH}`) {
    const entry = { ...stream, title: PROOF_STREAM_TITLE, timestamp: 0, mediatype: 'video', state: 'vod' };
    return {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'swarm-feed-index': feedIndexHeader(0),
        'swarm-feed-index-next': feedIndexHeader(1),
      },
      body: JSON.stringify([entry]),
    };
  }
  return { status: 404, headers: {}, body: '' };
}
