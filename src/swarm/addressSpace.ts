/**
 * Which network an address is on, as browsers sort them for local network access: this computer, the
 * local network, or the internet. Chrome, Edge and Firefox ask the viewer before a site reaches a more
 * private one, and Chrome lets an https page reach a plain http node only on the local network.
 *
 * Read from the address as written, never from where its name resolves, because the page cannot see
 * that. A name such as `bee.lan` that resolves to a home router's address is therefore the internet
 * here, and the picker asks for its https address or its IP address instead.
 */

/** The values of the Local Network Access draft's `IPAddressSpace`, which `fetch` takes as `targetAddressSpace`. */
export type AddressSpace = 'loopback' | 'local' | 'public';

/** `RequestInit` with the Local Network Access draft's option, which the DOM types do not carry yet. */
export type LocalNetworkRequestInit = RequestInit & { targetAddressSpace?: 'local' };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Space(hostname: string): AddressSpace | null {
  const match = IPV4.exec(hostname);
  if (!match) {
    return null;
  }
  const [first, second] = [Number(match[1]), Number(match[2])];
  if (first === 127) {
    return 'loopback';
  }
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
    return 'local';
  }
  return 'public';
}

/** An IPv6 literal as `URL` writes it, in brackets and lower case. Unique local addresses are fc00::/7. */
function ipv6Space(hostname: string): AddressSpace | null {
  if (!hostname.startsWith('[')) {
    return null;
  }
  if (hostname === '[::1]') {
    return 'loopback';
  }
  return /^\[f[cd]/.test(hostname) ? 'local' : 'public';
}

/** Where an address points, or null for a path on this site, such as `/bee`, which is this page's own origin. */
export function addressSpaceOf(url: string): AddressSpace | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'loopback';
  }
  if (hostname.endsWith('.local')) {
    return 'local';
  }
  return ipv4Space(hostname) ?? ipv6Space(hostname) ?? 'public';
}

/**
 * The option that tells Chrome a plain http request is meant for the local network, which is what lets
 * an https page make it at all. Only for such a request: the draft fails a request whose mark does not
 * match where the address really is, and a loopback or https address needs none.
 */
export function localNetworkRequestInit(url: string): LocalNetworkRequestInit {
  return url.startsWith('http://') && addressSpaceOf(url) === 'local' ? { targetAddressSpace: 'local' } : {};
}

/** The page's `Request`, or undefined where there is none. */
function pageRequest(): typeof Request | undefined {
  return typeof Request === 'undefined' ? undefined : Request;
}

/**
 * Whether this browser implements Local Network Access, which is also what lets an https page reach a
 * plain http node on the local network. The draft adds `targetAddressSpace` to `Request`, so its
 * presence answers the question without reading the browser's name.
 */
export function supportsLocalNetworkRequests(request: typeof Request | undefined = pageRequest()): boolean {
  return request !== undefined && 'targetAddressSpace' in request.prototype;
}
