/**
 * What the Bee node picker does with an address before it lets a viewer switch to it.
 *
 * The picker used to save whatever was typed and close. A viewer who mistyped a port, or whose node
 * refused this site's origin, then saw a browse page with nothing on it and no way to tell which of
 * those had happened. Everything here is pure or takes an injected prober, because this package runs
 * vitest without a DOM and a rule left inside the component is a rule nothing covers.
 */
import { DEFAULT_BEE_NODE_ACCESS } from '@/swarm/beeNodeAccess';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { PROBE_TIMEOUT_MS, type ProbeResult, type ReadOptions } from '@/swarm/provider';
import { type GatewaySetting, OWN_GATEWAY_ID, type SwarmSettings } from '@/swarm/settings';

/** Both a viewer's typing and a saved address, since every caller joins with a path of its own. */
function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * What a viewer typed, as a base URL a Bee API path can be appended to, or an empty string.
 *
 * A bare `host:port` gets `http://`, because that is how an address is copied out of Swarm Desktop or
 * a terminal. A path-only value such as `/bee` is kept as it is, and {@link checkOwnNodeAddress}
 * refuses it.
 */
export function beeBaseUrlFromTypedAddress(input: string): string {
  const trimmed = withoutTrailingSlash(input.trim());
  if (!trimmed || trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

/** What the picker offers for a viewer's own node: the Bee API port on this machine, as Swarm Desktop runs it. */
export const OWN_NODE_DEFAULT_ADDRESS = 'http://localhost:1633';

/**
 * The hosts a viewer's own node may be on, exactly. The page's content security policy allows these
 * and nothing wider, and a browser lets an `https` page reach a plain `http` node only on them.
 */
const OWN_MACHINE_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const OWN_MACHINE_HOSTS_TEXT = 'localhost, 127.0.0.1 or [::1]';

type OwnNodeAddressCheck = { ok: true; url: string } | { ok: false; text: string };

/** Whether what a viewer typed names a Bee node on their own machine, and the base URL it means. */
export function checkOwnNodeAddress(input: string): OwnNodeAddressCheck {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) && !/^https?:\/\//i.test(input.trim())) {
    return { ok: false, text: 'The address has to start with http:// or https://.' };
  }

  const typed = beeBaseUrlFromTypedAddress(input);
  if (!typed) {
    return { ok: false, text: `Enter the address of your Bee node, for example ${OWN_NODE_DEFAULT_ADDRESS}.` };
  }

  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return { ok: false, text: `That is not an address. Enter one such as ${OWN_NODE_DEFAULT_ADDRESS}.` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, text: 'The address has to start with http:// or https://.' };
  }
  if (!OWN_MACHINE_HOSTS.includes(url.hostname)) {
    return {
      ok: false,
      text: `Only a Bee node on this computer can be used here, at ${OWN_MACHINE_HOSTS_TEXT}.`,
    };
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, text: `Enter only the scheme, host and port, such as ${OWN_NODE_DEFAULT_ADDRESS}.` };
  }

  return { ok: true, url: url.origin };
}

/**
 * Hosts a browser treats as trustworthy whatever the scheme, so a plain `http` node on one of them
 * is not blocked from an `https` page.
 *
 * Chrome and Firefox both exempt loopback, which is why the common case of a node on the viewer's
 * own machine works and only a node on another machine fails. Written out rather than inferred,
 * because the exemption belongs to the browser and this list is a claim about what it does.
 */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.startsWith('127.') || hostname === '[::1]'
  );
}

/**
 * Whether the browser will refuse this address before any request leaves the page.
 *
 * An `https` page may not load a plain `http` subresource, so a node typed as `192.168.1.20:1633`
 * from the deployed site is blocked as mixed content. The `fetch` rejects with the same `TypeError`
 * a closed port and a CORS refusal produce, which is why this has to be decided before the request
 * rather than read off the failure.
 *
 * Exported because it is the one failure this module can name exactly rather than guess at.
 */
export function isBlockedAsMixedContent(gatewayUrl: string, pageProtocol: string): boolean {
  if (pageProtocol !== 'https:') {
    return false;
  }
  try {
    const candidate = new URL(gatewayUrl);
    return candidate.protocol === 'http:' && !isLoopbackHost(candidate.hostname);
  } catch {
    // A path-only address such as the deployed `/bee` default, which is served by this page's own
    // origin and carries its scheme with it.
    return false;
  }
}

type GatewayProbeOutcome =
  | { kind: 'ok' }
  | { kind: 'rejected'; status: number }
  /** An `http` node named from an `https` page, which the browser refuses before anything is sent. */
  | { kind: 'mixed-content' }
  /**
   * Something answered 2xx and it was not Bee's health document. A web server with a single-page
   * fallback route answers any path with its index page and a 200, which is the case a status-only
   * check waves through.
   */
  | { kind: 'not-bee' }
  | { kind: 'timed-out' }
  /** No answer at all: connection refused, wrong port, DNS miss, or the node blocked this site. */
  | { kind: 'unreachable' };

/** What can ask an address whether a Swarm node is there: a provider's own probe. */
type Prober = (gatewayUrl: string) => { probe(options?: ReadOptions): Promise<ProbeResult> };

/** The settings of one gateway alone, with no fallback, so a test of it is a test of it and nothing else. */
export function onlyGateway(gateway: GatewaySetting): SwarmSettings {
  return {
    gateways: [gateway],
    defaultId: gateway.id,
    fallbackId: null,
    kinds: [gateway.kind],
    beeNodes: DEFAULT_BEE_NODE_ACCESS,
  };
}

/** A Bee node over HTTP at the address, which is the kind of node the picker offers to use. */
const beeHttpProber: Prober = (gatewayUrl) =>
  createSwarmClient(onlyGateway({ id: OWN_GATEWAY_ID, kind: 'bee-http', url: gatewayUrl }));

interface GatewayProbeOptions {
  /** Injected only by tests. Production asks the Bee HTTP provider the picker would switch to. */
  prober?: Prober;
  /**
   * The scheme this page is served over. Injected only by tests, and read lazily in production
   * because this package runs vitest with no DOM, where touching `window` at module load is a
   * `ReferenceError`.
   */
  pageProtocol?: string;
}

/** Empty off a browser, where nothing is being loaded into a page and nothing can be blocked. */
function currentPageProtocol(): string {
  return typeof window === 'undefined' ? '' : window.location.protocol;
}

/**
 * Ask an address whether a Bee node is behind it, through the `probe()` of the provider that would
 * read from it. Never throws: every failure is an outcome.
 *
 * The window covers headers and body together. A node that accepts the connection and answers
 * nothing is therefore a `timed-out` rather than a picker held open, and it reaches a viewer as its
 * own message: that node exists and is slow, which is a different next step from one that cannot be
 * reached at all.
 */
export async function probeGateway(
  gatewayUrl: string,
  { prober = beeHttpProber, pageProtocol = currentPageProtocol() }: GatewayProbeOptions = {},
): Promise<GatewayProbeOutcome> {
  // Asked before the fetch, because this is the one failure that is knowable without one and the
  // only one whose cause survives: once the browser has refused it, what reaches this code is
  // indistinguishable from a closed port.
  if (isBlockedAsMixedContent(gatewayUrl, pageProtocol)) {
    return { kind: 'mixed-content' };
  }

  // A browser reports a CORS refusal, a closed port and a DNS miss identically, as a rejected fetch
  // with no status, so the probe finds every one of them unreachable.
  const found = await prober(gatewayUrl).probe({ timeoutMs: PROBE_TIMEOUT_MS });
  switch (found.kind) {
    case 'ok':
      return { kind: 'ok' };
    case 'not-swarm':
      return { kind: 'not-bee' };
    case 'rejected':
      return { kind: 'rejected', status: found.status };
    case 'timed-out':
    case 'unreachable':
      return { kind: found.kind };
  }
}

/** Both answers a wrong port produces need the same next step, so the sentence is written once. */
const CHECK_THE_PORT = 'Check the port: the Bee API is usually 1633.';

/** Success is not described. The picker closes on it, so a sentence for it is one no viewer reads. */
type GatewayProbeFailure = Exclude<GatewayProbeOutcome, { kind: 'ok' }>;

/**
 * What the picker tells a viewer about each way this can fail, kept beside the rule so a new failure
 * cannot ship without its copy. The declared return type is what enforces that: a switch that misses
 * a case returns undefined on it and stops compiling. Written for someone who runs a node and does
 * not read network logs.
 */
export function describeProbeFailure(failure: GatewayProbeFailure): string {
  switch (failure.kind) {
    case 'rejected':
      return `Something answered at this address with an error (HTTP ${failure.status}). ${CHECK_THE_PORT}`;
    case 'not-bee':
      return `Something answered at this address, but it is not a Bee node. ${CHECK_THE_PORT}`;
    case 'mixed-content':
      return 'This site is served over https, and a browser refuses to load anything over plain http from it, so the request never leaves this page. Give the node an https address, or open this site over http.';
    case 'timed-out':
      return 'The node accepted the connection and then stopped answering. Check that it has finished starting up, then try again.';
    case 'unreachable':
      return 'Could not reach a Bee node at this address. Check that the node is running, and that it allows this site: set cors-allowed-origins to "*" in its config and restart it.';
  }
}

/**
 * Whether a viewer is already on the event gateway, which is what decides whether a way back to it
 * is worth offering.
 *
 * Compared without trailing slashes, because a saved address has been through `setGatewayUrl`, which
 * strips them, while the config's value may carry one. A strict comparison would offer a viewer a
 * way back to where they already are.
 */
export function isDefaultGateway(gatewayUrl: string, defaultGatewayUrl: string): boolean {
  return withoutTrailingSlash(gatewayUrl) === withoutTrailingSlash(defaultGatewayUrl);
}

/**
 * What the header shows beside the picker, so a viewer can see whose node is serving them without
 * opening anything. The event gateway is named rather than shown, because its address is `/bee` or
 * a setting the viewer has never seen. Their own node shows as its host, which is what they typed and
 * will recognise.
 */
export function gatewayLabel(gatewayUrl: string, defaultGatewayUrl: string): string {
  if (isDefaultGateway(gatewayUrl, defaultGatewayUrl)) {
    return 'Event gateway';
  }
  try {
    return new URL(gatewayUrl).host;
  } catch {
    return gatewayUrl;
  }
}
