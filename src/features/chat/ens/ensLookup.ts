import { type ResolveEnsName, resolveEnsNameWithLibrary } from '../swarmId/swarmIdClient';

/** The ENS names of the wallets a page's senders linked, looked up through one endpoint. */
export interface EnsNames {
  /** The name already found for `wallet`, so a message drawn again shows it at once. */
  known(wallet: string): string | undefined;
  /** The wallet's verified name, or undefined for none and for a lookup that failed. Never rejects. */
  lookUp(wallet: string): Promise<string | undefined>;
}

/**
 * Names found are kept for the page's life, and lookups of one wallet that arrive together share one. A wallet with no
 * name is not kept here, because the library keeps that answer itself, a definite one for minutes and a failure for
 * seconds, so a later look gets a name that has since appeared or an endpoint that has come back.
 */
export function createEnsNames(rpcUrl: string, resolve: ResolveEnsName = resolveEnsNameWithLibrary): EnsNames {
  const found = new Map<string, string>();
  const pending = new Map<string, Promise<string | undefined>>();
  return {
    known: (wallet) => found.get(wallet.toLowerCase()),
    lookUp(wallet) {
      const key = wallet.toLowerCase();
      const name = found.get(key);
      if (name !== undefined) {
        return Promise.resolve(name);
      }
      const asked = pending.get(key);
      if (asked) {
        return asked;
      }
      const lookup = resolve(key, rpcUrl)
        .catch(() => undefined)
        .then((answer) => {
          pending.delete(key);
          if (answer !== undefined) {
            found.set(key, answer);
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
