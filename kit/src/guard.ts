import { isLocalDevHost, isLocalRequest } from './addresses.ts';

/**
 * What the browser guard lets through: which requests an actor's routing passes, and which outside hosts the browser
 * may resolve at all. Every other name resolves to nothing, so a request that gets past the routing, from a service
 * worker or a part Playwright does not route, still reaches no host the run did not name.
 */
export interface Guard {
  allows(url: string): boolean;
  /** Hosts off this machine the browser may resolve, beyond the local names it always may. */
  hosts: string[];
}

/** The local stack's guard: everything on this machine, and no outside name. */
export const LOCAL_GUARD: Guard = { allows: isLocalRequest, hosts: [] };

/** Schemes a browser answers from itself, which never reach a host. */
const IN_BROWSER = new Set(['data:', 'blob:', 'about:']);

/**
 * Live mode's guard: exactly the origins `named` holds, which are the target's, the config's and the hostile site's,
 * and what the browser answers itself. Anything else, a local address included, is stopped.
 */
export function liveGuard(named: readonly string[]): Guard {
  const origins = new Set(named.map((address) => new URL(address).origin));
  const hosts = [...new Set([...origins].map((origin) => new URL(origin).hostname))].filter(
    (host) => !isLocalDevHost(host),
  );
  return {
    allows(url) {
      try {
        const parsed = new URL(url);
        return IN_BROWSER.has(parsed.protocol) || origins.has(parsed.origin);
      } catch {
        return false;
      }
    },
    hosts,
  };
}

/**
 * Chromium's resolver rule under which every name but the local ones and `hosts` resolves to nothing. The IPv6
 * loopback literal goes through these rules too and is excluded only by its bare spelling, `::1`: written `[::1]` it
 * resolves to nothing.
 */
export function resolverRules(hosts: readonly string[]): string {
  const kept = ['localhost', '*.localhost', '127.0.0.1', '::1', ...hosts];
  return `--host-resolver-rules=MAP * ~NOTFOUND, ${kept.map((host) => `EXCLUDE ${host}`).join(', ')}`;
}
