/**
 * What Connect does with an address a viewer types before it checks it: the base URL it means, whether this
 * site lets a viewer use it at all, and whether the browser would refuse it before asking. Pure, because a rule
 * left inside the component is a rule nothing covers.
 */
import { addressSpaceOf } from '@/swarm/addressSpace';
import type { GatewaySetting, SwarmSettings } from '@/swarm/settings';
import type { SourceType } from '@/swarm/sources';

import { ADDRESS_REFUSED } from './checkSentences';

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

/**
 * The hosts a node on this computer may be named by at every level. The page's content security policy
 * allows these and nothing wider, so another loopback name such as `127.0.0.2` would pass here and then
 * be refused by the page.
 */
const OWN_MACHINE_HOSTS = ['localhost', '127.0.0.1'];

/**
 * A policy cannot name `[::1]`: Chrome 153 rejects `http://[::1]:*` as an invalid source and blocks the
 * request, so only a policy allowing every plain http address would let it through.
 */
const IPV6_LOOPBACK = '[::1]';

export type OwnNodeAddressCheck = { ok: true; url: string } | { ok: false; text: string };

const refused = (text: string): OwnNodeAddressCheck => ({ ok: false, text });

/**
 * Whether what a viewer typed names a Bee node this site lets them use, and the base URL it means: a
 * node on this computer over http or https, or any other machine at an https address. Plain http to
 * another machine is never allowed, because a browser blocks it from an https page and the page's
 * policy allows no plain http beyond this computer.
 */
export function checkOwnNodeAddress(input: string): OwnNodeAddressCheck {
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
  const hostRefusal = refusalOfHost(url);
  if (hostRefusal !== null) {
    return refused(hostRefusal);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return refused(ADDRESS_REFUSED.notJustTheOrigin);
  }

  return { ok: true, url: url.origin };
}

/**
 * Whether what a viewer typed for a source they add is one this site lets them use. A gateway is an
 * https address, so one typed without a scheme is taken as https, and otherwise it holds to exactly the
 * rules of a Bee node, because the page's policy allows the same addresses for both.
 */
export function checkSourceAddress(type: SourceType, input: string): OwnNodeAddressCheck {
  const trimmed = input.trim();
  const typed =
    type === 'gateway' && trimmed !== '' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !trimmed.startsWith('/')
      ? `https://${trimmed}`
      : trimmed;
  return checkOwnNodeAddress(typed);
}

/** Why this site will not let a viewer use a node at this host and scheme, or null when it will. */
function refusalOfHost(url: URL): string | null {
  if (OWN_MACHINE_HOSTS.includes(url.hostname)) {
    return null;
  }
  if (url.hostname === IPV6_LOOPBACK) {
    return ADDRESS_REFUSED.ipv6Loopback;
  }
  if (addressSpaceOf(url.href) === 'loopback') {
    return ADDRESS_REFUSED.otherLoopbackHost;
  }
  return url.protocol === 'https:' ? null : ADDRESS_REFUSED.plainHttp;
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

/** The settings of one gateway alone, so a test of it is a test of it and nothing else. */
export function onlyGateway(gateway: GatewaySetting): SwarmSettings {
  return {
    gateways: [gateway],
    defaultId: gateway.id,
  };
}
