import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import type { ResolveEnsName } from '../swarmId/swarmIdClient';

import { createEnsNames, type EnsNames } from './ensLookup';

const EnsNamesContext = createContext<EnsNames | null>(null);

interface EnsNamesProviderProps {
  /** The Ethereum JSON-RPC endpoint names are read through. Null, and no name is ever looked up. */
  readonly rpcUrl: string | null;
  /** How a name is read, the Swarm ID library's lookup unless a test stands in for it. */
  readonly resolve?: ResolveEnsName;
  readonly children: ReactNode;
}

export function EnsNamesProvider({ rpcUrl, resolve, children }: EnsNamesProviderProps) {
  const names = useMemo(() => (rpcUrl === null ? null : createEnsNames(rpcUrl, resolve)), [rpcUrl, resolve]);
  return <EnsNamesContext.Provider value={names}>{children}</EnsNamesContext.Provider>;
}

interface FoundName {
  readonly wallet: string;
  readonly name: string | undefined;
}

/**
 * The verified ENS name of `wallet`, the wallet a message's checked wallet link names, looked up after the message is
 * drawn. Undefined until the lookup answers, and for no wallet, no endpoint, no name and a lookup that failed.
 */
export function useEnsName(wallet: string | undefined): string | undefined {
  const names = useContext(EnsNamesContext);
  const [found, setFound] = useState<FoundName | null>(null);

  useEffect(() => {
    if (!names || !wallet) {
      return;
    }
    let isCurrent = true;
    void names.lookUp(wallet).then((name) => {
      if (isCurrent) {
        setFound({ wallet, name });
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [names, wallet]);

  if (!names || !wallet) {
    return undefined;
  }
  return found?.wallet === wallet ? found.name : names.known(wallet);
}
