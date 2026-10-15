import { type ResolveEnsName, resolveEnsNameWithLibrary } from '../swarmId/swarmIdClient';

/** The ENS names of the wallets a page's senders linked, looked up through one endpoint. */
export interface EnsNames {
  /** The name already found for `wallet`, so a message drawn again shows it at once. */
  known(wallet: string): string | undefined;
  /** The wallet's verified name, or undefined for none and for a lookup that failed. Never rejects. */
  lookUp(wallet: string): Promise<string | undefined>;
}

/**
 * How long a found name is shown before it is looked up again, the Swarm ID library's own `ENS_NAME_CACHE_MS`. Named
 * here rather than imported, since the library loads only once a name is first looked up.
 */
export const ENS_NAME_KEPT_MS = 10 * 60_000;

/** The most names looked up at once, so a chat of many linked wallets does not flood the endpoint. */
export const ENS_LOOKUPS_AT_ONCE = 4;

interface FoundName {
  readonly name: string;
  readonly at: number;
}

/**
 * Names found are kept for {@link ENS_NAME_KEPT_MS}, so a name moved to another wallet shows within that, and lookups
 * of one wallet that arrive together share one. At most {@link ENS_LOOKUPS_AT_ONCE} lookups run at once, the rest
 * waiting their turn. A wallet with no name is not kept here, because the library keeps that answer itself, a
 * definite one for minutes and a failure for seconds, so a later look gets a name that has since appeared or an
 * endpoint that has come back.
 */
export function createEnsNames(
  rpcUrl: string,
  resolve: ResolveEnsName = resolveEnsNameWithLibrary,
  now: () => number = Date.now,
): EnsNames {
  const found = new Map<string, FoundName>();
  const pending = new Map<string, Promise<string | undefined>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  const freshName = (key: string) => {
    const kept = found.get(key);
    if (kept && now() - kept.at > ENS_NAME_KEPT_MS) {
      found.delete(key);
      return undefined;
    }
    return kept?.name;
  };

  async function inTurn(key: string): Promise<string | undefined> {
    if (running < ENS_LOOKUPS_AT_ONCE) {
      running += 1;
    } else {
      // The lookup that ends hands its place straight to this one, so no newcomer takes it in between.
      await new Promise<void>((resume) => waiting.push(resume));
    }
    try {
      return await resolve(key, rpcUrl);
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        running -= 1;
      }
    }
  }

  return {
    known: (wallet) => freshName(wallet.toLowerCase()),
    lookUp(wallet) {
      const key = wallet.toLowerCase();
      const name = freshName(key);
      if (name !== undefined) {
        return Promise.resolve(name);
      }
      const asked = pending.get(key);
      if (asked) {
        return asked;
      }
      const lookup = inTurn(key)
        .catch(() => undefined)
        .then((answer) => {
          pending.delete(key);
          if (answer !== undefined) {
            found.set(key, { name: answer, at: now() });
          }
          return answer;
        });
      pending.set(key, lookup);
      return lookup;
    },
  };
}

const NON_ASCII = /[^\x00-\x7f]/;

/** Whether `name` has a character outside ASCII, which can look like a different name's letter on screen. */
export function hasNonAsciiCharacters(name: string): boolean {
  return NON_ASCII.test(name);
}
