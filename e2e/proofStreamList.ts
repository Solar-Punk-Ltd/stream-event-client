import { Topic } from '@ethersphere/bee-js';

/** The stream list the proof answers, since a deployment's list is a placeholder. */
export const PROOF_CATALOG = { owner: `0x${'1'.repeat(40)}`, topic: 'weeb3-proof-stream-list' };

/** The title of the proof's one stream, which the watch page shows once the list has reached it. */
export const PROOF_STREAM_TITLE = 'weeb-3 proof stream';

const CATALOG_TOPIC_HEX = Topic.fromString(PROOF_CATALOG.topic).toString();

const feedIndexHeader = (index: number) => index.toString(16).padStart(16, '0');

/** What the gateway answers to one request under `gatewayPath`. */
export interface ProofGatewayAnswer {
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
  if (pathname === `${gatewayPath}/feeds/${PROOF_CATALOG.owner.slice(2)}/${CATALOG_TOPIC_HEX}`) {
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
