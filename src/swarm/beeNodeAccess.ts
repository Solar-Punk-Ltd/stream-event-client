/**
 * How far a deployment lets a viewer reach for a Bee node of their own, `providers.beeNodes` in
 * `config.json`. The image writes the page's content security policy from its own `BEE_NODES` setting
 * with the same three values, so the picker never offers an address the page would refuse to load.
 *
 * - `off`: a node on this computer only, at localhost or 127.0.0.1, as the viewer has always allowed.
 * - `https`: also a node on any other machine at an https address.
 * - `https-and-local-http`: also a node on the local network over plain http, which only Chrome and
 *   Edge let an https page reach, and `[::1]`, which a policy can only allow by allowing every plain
 *   http address.
 */
export const BEE_NODE_ACCESS_LEVELS = ['off', 'https', 'https-and-local-http'] as const;

export type BeeNodeAccess = (typeof BEE_NODE_ACCESS_LEVELS)[number];

/** What a config that names no level means. */
export const DEFAULT_BEE_NODE_ACCESS: BeeNodeAccess = 'off';
