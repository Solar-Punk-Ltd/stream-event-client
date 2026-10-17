/**
 * Where each part of the kit answers, as the browser and the kit's own process reach it. Two schemes, because whether
 * the viewer and Swarm ID are two sites decides whether the browser keeps Swarm ID's frames apart from Swarm ID's own
 * storage, as it does for any two separate sites. `kit probe` measures which scheme gives that, and the chat's own
 * rules decide whether a viewer origin can carry a Swarm ID binding at all.
 */
export const Addressing = {
  /** Every part on a name of its own under `localhost`, which Chrome resolves to loopback with no hosts file. */
  NAMES: 'names',
  /** The viewer on the `127.0.0.1` literal and Swarm ID on `localhost`, the Swarm ID fork's proven cross-site pair. */
  LOOPBACK: 'loopback',
} as const;
export type Addressing = (typeof Addressing)[keyof typeof Addressing];

export interface Addresses {
  viewer: string;
  swarmId: string;
  /** A strict Swarm ID build whose allow list names the viewer but not the hostile site, for the unlisted check. */
  swarmIdStrict: string;
  /** The hostile site, on a loopback site of its own so the browser partitions its Swarm ID frames. */
  evil: string;
  gateway: string;
  signaling: string;
  chatServer: string;
  chain: string;
  /** The Ethereum chain booted from the ENS snapshot. */
  ethereum: string;
  queen: string;
  worker1: string;
  worker2: string;
  /** Every address above by its name, which the preflight checks are all local. */
  all(): Record<string, string>;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Whether `hostname` is a local development host: a loopback name or literal, or any name under `localhost`. */
export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || (host.endsWith('.localhost') && host.length > '.localhost'.length);
}

/** Schemes a browser answers from itself, which never reach a host. */
const IN_BROWSER = new Set(['data:', 'blob:', 'about:']);

/** Whether a request the browser makes stays on this machine, so the kit's browser guard lets it through. */
export function isLocalRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return IN_BROWSER.has(parsed.protocol) || isLocalDevHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Requests to hosts off this machine that the release under test is known to make, each stopped like any other but
 * recorded in the verdict instead of failing the step, with why it is made. Anything else off this machine fails.
 */
const KNOWN_OUTSIDE: ReadonlyArray<{ url: RegExp; why: string }> = [
  {
    url: /^https:\/\/rsms\.me\/inter\//,
    why: "Swarm ID's wallet picker, web3-onboard, loads the Inter font from its author's site",
  },
  {
    url: /^https:\/\/cloudflare-eth\.com\//,
    why: "Swarm ID's wallet picker reads Ethereum mainnet through viem's default public endpoint for its mainnet entry",
  },
];

/** Why the release makes a stopped request, `<method> <url>`, when it is one it is known to make, or null. */
export function knownOutsideRequest(request: string): string | null {
  const url = request.slice(request.indexOf(' ') + 1);
  return KNOWN_OUTSIDE.find((known) => known.url.test(url))?.why ?? null;
}

/** Each address of `table` that is not a URL on a local development host, as `name: address`. */
export function nonLocalAddresses(table: Record<string, string>): string[] {
  return Object.entries(table)
    .filter(([, address]) => {
      try {
        return !isLocalDevHost(new URL(address).hostname);
      } catch {
        return true;
      }
    })
    .map(([name, address]) => `${name}: ${address}`);
}

/**
 * The kit's addresses in one scheme. Bee and the chain stay on `localhost`, where the viewer's policy allows a node.
 * The viewer is on 4180 rather than 4173, where `pnpm e2e` serves its preview, so the kit and a browser suite run side
 * by side.
 */
export function addressesFor(mode: Addressing): Addresses {
  const names = mode === Addressing.NAMES;
  const parts = {
    viewer: names ? 'http://viewer.localhost:4180' : 'http://127.0.0.1:4180',
    swarmId: names ? 'http://id.localhost:5500' : 'http://localhost:5500',
    swarmIdStrict: names ? 'http://strict.localhost:5501' : 'http://localhost:5501',
    evil: names ? 'http://evil.localhost:4999' : 'http://[::1]:4999',
    gateway: names ? 'http://gateway.localhost:8080' : 'http://localhost:8080',
    signaling: 'http://localhost:5520',
    chatServer: 'http://localhost:3100',
    chain: 'http://localhost:9545',
    ethereum: 'http://localhost:8546',
    queen: 'http://localhost:1633',
    worker1: 'http://localhost:16331',
    worker2: 'http://localhost:16332',
  };
  return { ...parts, all: () => ({ ...parts }) };
}
