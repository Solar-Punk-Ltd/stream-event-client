/**
 * What the Bee node picker does with an address before it lets a viewer switch to it.
 *
 * The picker used to save whatever was typed and close. A viewer who mistyped a port, or whose node
 * refused this site's origin, then saw a browse page with nothing on it and no way to tell which of
 * those had happened. Everything here is pure or takes an injected prober, because this package runs
 * vitest without a DOM and a rule left inside the component is a rule nothing covers.
 */
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { type NotReadyReason, PROBE_TIMEOUT_MS, type ProbeResult, type ReadOptions } from '@/swarm/provider';
import { addressSpaceOf, supportsLocalNetworkRequests } from '@/swarm/addressSpace';
import { type BeeNodeAccess, DEFAULT_BEE_NODE_ACCESS } from '@/swarm/beeNodeAccess';
import { type GatewaySetting, OWN_GATEWAY_ID, type SwarmSettings } from '@/swarm/settings';

import {
  ADDRESS_REFUSED,
  type Help,
  LOCAL_HTTP_UNSUPPORTED,
  MIXED_CONTENT,
  notReadySentence,
  unreachableHelp,
  unreachableSentence,
} from './checkSentences';
import {
  awaitsLocalNetworkAnswer,
  type ReachabilityOptions,
  unreachableCause,
  type UnreachableCause,
} from './reachability';

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
 * The hosts a node on this computer may be named by at every level. The page's content security policy
 * allows these and nothing wider, so another loopback name such as `127.0.0.2` would pass here and then
 * be refused by the page.
 */
const OWN_MACHINE_HOSTS = ['localhost', '127.0.0.1'];

/**
 * A policy cannot name `[::1]`: Chrome 153 rejects `http://[::1]:*` as an invalid source and blocks the
 * request, so only a policy allowing every plain http address lets it through, which is what the local
 * http level writes.
 */
const IPV6_LOOPBACK = '[::1]';

type OwnNodeAddressCheck = { ok: true; url: string } | { ok: false; text: string };

const refused = (text: string): OwnNodeAddressCheck => ({ ok: false, text });

/**
 * Whether what a viewer typed names a Bee node this site lets them use, and the base URL it means.
 *
 * A node on this computer is always allowed, over http or https. Beyond it, `access` decides: an https
 * address on any host from `https` up, and a plain http address on the local network only at
 * `https-and-local-http`. Plain http to the internet is never allowed, because a browser blocks it
 * from an https page.
 */
export function checkOwnNodeAddress(input: string, access: BeeNodeAccess = 'off'): OwnNodeAddressCheck {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) && !/^https?:\/\//i.test(input.trim())) {
    return refused(ADDRESS_REFUSED.notHttp);
  }

  const typed = beeBaseUrlFromTypedAddress(input);
  if (!typed) {
    return refused(ADDRESS_REFUSED.empty);
  }

  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return refused(ADDRESS_REFUSED.notAnAddress);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return refused(ADDRESS_REFUSED.notHttp);
  }
  const hostRefusal = refusalOfHost(url, access);
  if (hostRefusal !== null) {
    return refused(hostRefusal);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return refused(ADDRESS_REFUSED.notJustTheOrigin);
  }

  return { ok: true, url: url.origin };
}

/** Why this site will not let a viewer use a node at this host and scheme, or null when it will. */
function refusalOfHost(url: URL, access: BeeNodeAccess): string | null {
  if (OWN_MACHINE_HOSTS.includes(url.hostname)) {
    return null;
  }
  if (url.hostname === IPV6_LOOPBACK) {
    return access === 'https-and-local-http' ? null : ADDRESS_REFUSED.ipv6Loopback;
  }
  const space = addressSpaceOf(url.href);
  if (access === 'off') {
    return ADDRESS_REFUSED.thisComputerOnly;
  }
  if (space === 'loopback') {
    return ADDRESS_REFUSED.otherLoopbackHost;
  }
  if (url.protocol === 'https:') {
    return null;
  }
  if (space === 'local') {
    return access === 'https-and-local-http' ? null : ADDRESS_REFUSED.localHttpNotAllowed;
  }
  return ADDRESS_REFUSED.plainHttpInternet;
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
 * An `https` page may not load a plain `http` subresource, so a node typed as `192.0.2.10:1633` from
 * the deployed site is blocked as mixed content. The `fetch` rejects with the same `TypeError` a closed
 * port and a CORS refusal produce, which is why this has to be decided before the request rather than
 * read off the failure. A browser with Local Network Access, Chrome and Edge today, lets such a page
 * reach a plain http node on the local network. Whether this one does is asked of the browser
 * beforehand, with {@link supportsLocalNetworkRequests}, because the answer comes back asynchronously.
 *
 * Exported because it is the one failure this module can name exactly rather than guess at.
 */
export function isBlockedAsMixedContent(
  gatewayUrl: string,
  pageProtocol: string,
  localNetworkRequests: boolean,
): boolean {
  if (pageProtocol !== 'https:') {
    return false;
  }
  try {
    const candidate = new URL(gatewayUrl);
    if (candidate.protocol !== 'http:' || isLoopbackHost(candidate.hostname)) {
      return false;
    }
    return !(localNetworkRequests && addressSpaceOf(gatewayUrl) === 'local');
  } catch {
    // A path-only address such as the deployed `/bee` default, which is served by this page's own
    // origin and carries its scheme with it.
    return false;
  }
}

/** Whether a blocked address is on the local network, which a browser other than this one could reach. */
export function isLocalHttp(gatewayUrl: string): boolean {
  return gatewayUrl.startsWith('http://') && addressSpaceOf(gatewayUrl) === 'local';
}

type GatewayProbeOutcome =
  | { kind: 'ok' }
  | { kind: 'rejected'; status: number }
  /** An `http` node named from an `https` page, which the browser refuses before anything is sent. */
  | { kind: 'mixed-content' }
  /** The same on the local network, in a browser without Local Network Access, which Chrome and Edge have. */
  | { kind: 'local-http-unsupported' }
  /**
   * Something answered 2xx and it was not Bee's health document. A web server with a single-page
   * fallback route answers any path with its index page and a 200, which is the case a status-only
   * check waves through.
   */
  | { kind: 'not-bee' }
  /**
   * Nothing came back in the window. `awaitingLocalNetwork` is whether the browser has yet to ask the
   * viewer about reaching the node, which holds the request just as a quiet node does.
   */
  | { kind: 'timed-out'; awaitingLocalNetwork: boolean }
  /** A Bee node answered its health and cannot serve this viewer yet. */
  | { kind: 'not-ready'; reason: NotReadyReason }
  /** No readable answer, and what a second look at the address found: nothing, CORS, or the browser. */
  | { kind: 'unreachable'; cause: UnreachableCause };

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
  /** Whether this browser can mark a request as meant for the local network. Read from the page when absent. */
  localNetworkRequests?: boolean;
  /** Injected only by tests. Production reads the page and asks the browser's Permissions API. */
  reachability?: ReachabilityOptions;
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
  {
    prober = beeHttpProber,
    pageProtocol = currentPageProtocol(),
    localNetworkRequests: injectedLocalNetworkRequests,
    reachability = {},
  }: GatewayProbeOptions = {},
): Promise<GatewayProbeOutcome> {
  const localNetworkRequests = injectedLocalNetworkRequests ?? (await supportsLocalNetworkRequests());
  // Asked before the fetch, because this is the one failure that is knowable without one and the
  // only one whose cause survives: once the browser has refused it, what reaches this code is
  // indistinguishable from a closed port.
  if (isBlockedAsMixedContent(gatewayUrl, pageProtocol, localNetworkRequests)) {
    return isLocalHttp(gatewayUrl) ? { kind: 'local-http-unsupported' } : { kind: 'mixed-content' };
  }

  // A browser reports a CORS refusal, a closed port and a DNS miss identically, as a rejected fetch
  // with no status, so the probe finds every one of them unreachable and the diagnosis tells them apart.
  const found = await prober(gatewayUrl).probe({ timeoutMs: PROBE_TIMEOUT_MS });
  switch (found.kind) {
    case 'ok':
      return { kind: 'ok' };
    case 'not-ready':
      return { kind: 'not-ready', reason: found.reason };
    case 'not-swarm':
      return { kind: 'not-bee' };
    case 'rejected':
      return { kind: 'rejected', status: found.status };
    case 'timed-out':
      return {
        kind: 'timed-out',
        awaitingLocalNetwork: await awaitsLocalNetworkAnswer(gatewayUrl, { localNetworkRequests, ...reachability }),
      };
    case 'unreachable':
    case 'refuses-this-site':
      return {
        kind: 'unreachable',
        cause: await unreachableCause(gatewayUrl, found, { localNetworkRequests, ...reachability }),
      };
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
    case 'local-http-unsupported':
      return LOCAL_HTTP_UNSUPPORTED;
    case 'not-ready':
      return notReadySentence(failure.reason);
    case 'mixed-content':
      return MIXED_CONTENT;
    case 'timed-out':
      if (failure.awaitingLocalNetwork) {
        return unreachableSentence({ kind: 'unreachable-local' });
      }
      return 'The node accepted the connection and then stopped answering. Check that it has finished starting up, then try again.';
    case 'unreachable':
      return unreachableSentence(failure.cause);
  }
}

/** The help a failure needs beyond its sentence, for this page's origin, or null when the sentence is enough. */
export function probeFailureHelp(failure: GatewayProbeFailure, origin: string): Help | null {
  switch (failure.kind) {
    case 'unreachable':
      return unreachableHelp(failure.cause, origin);
    case 'timed-out':
      return failure.awaitingLocalNetwork ? unreachableHelp({ kind: 'unreachable-local' }, origin) : null;
    default:
      return null;
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
