/**
 * Segments from the Swarm node of a browser that has one, such as Freedom, rather than from a gateway.
 *
 * Freedom serves a page it loaded from Swarm on the `bzz:` scheme and answers every `bzz://<ref>/` by
 * asking its own node for `/bzz/<ref>/`, which its node answers with the raw bytes when the reference
 * is not a manifest. That is exactly a segment. The page cannot reach that node's HTTP port, so a
 * "my own Bee node" address never works there, and this is the only way its node can serve the video.
 *
 * ⛔ Segments only. `bzz://` serves content, not feeds or single-owner chunks, so every feed read goes
 * on through the event gateway in this mode.
 */

/** The protocol of a page Freedom loaded from Swarm. */
export const BZZ_PROTOCOL = 'bzz:';

/**
 * What a playlist is serialized against in place of a gateway's `/bytes` when segments come from the
 * browser's node. A value of its own because the serialize cache is keyed on it, so switching between
 * this and a gateway re-serializes like switching between two gateways does.
 */
export const BROWSER_NODE_BYTES = 'bzz://';

/** An unencrypted reference, or an encrypted one, which is a reference and a key. */
const SWARM_REF = /^[0-9a-f]{64}(?:[0-9a-f]{64})?$/i;

/** The reference at the end of a `/bytes/<ref>` URI, absolute or rooted, as recordings made before 2026-08-13 name them. */
const BYTES_PATH_REF = /\/bytes\/([0-9a-f]{64}(?:[0-9a-f]{64})?)$/i;

/** Whether this page was loaded from Swarm by a browser with a node of its own. */
export function isServedOverBzz(pageProtocol: string): boolean {
  return pageProtocol === BZZ_PROTOCOL;
}

/**
 * A segment URI from a media playlist as the browser's node serves it, or null when it names no
 * reference to serve.
 *
 * The legacy shapes are mapped too, though they name a host. The reference is in the URI, and the
 * browser's node can fetch it as well as the publisher's gateway can.
 */
export function browserNodeSegmentUrl(uri: string): string | null {
  const ref = SWARM_REF.test(uri) ? uri : BYTES_PATH_REF.exec(uri)?.[1];
  return ref === undefined ? null : `bzz://${ref}/`;
}
