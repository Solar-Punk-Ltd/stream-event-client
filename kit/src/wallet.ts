import type { BrowserContext, Page } from '@playwright/test';
import { type Hex, isHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** The names the injected wallet reaches the kit's process by. */
const ADDRESS_BINDING = '__flowKitWalletAddress';
const SIGN_BINDING = '__flowKitWalletSign';

/** An actor's test wallet: a key made for the run, or one the ENS snapshot gave a name. Held in memory only. */
export interface TestWallet {
  key: Hex;
  address: Hex;
}

export function testWallet(key: Hex): TestWallet {
  return { key, address: privateKeyToAccount(key).address };
}

/**
 * What `personal_sign` signs: a message given as hex is its bytes, anything else its UTF-8 text, as MetaMask reads
 * the same parameter.
 */
export function personalMessage(message: string): string | { raw: Hex } {
  return isHex(message) ? { raw: message } : message;
}

/**
 * Lets Swarm ID's top-level pages in the context reach the actor's test wallet, and returns the script that puts an
 * EIP-1193 wallet in such a page, as a browser extension would. It is named MetaMask so Swarm ID's wallet picker offers
 * it and trusts it to sign the same bytes every time. It signs in the kit's process with the actor's test wallet, which
 * the page never sees, and sends every other call to `rpc`. `wallet` is read at each call, so an actor whose account is
 * made later still gets the same provider.
 */
export async function exposeWallet(
  context: BrowserContext,
  swarmIdOrigin: string,
  rpc: string,
  wallet: () => TestWallet | null,
): Promise<string> {
  const fromSwarmId = (page: Page | undefined) => {
    try {
      return page !== undefined && new URL(page.url()).origin === swarmIdOrigin;
    } catch {
      return false;
    }
  };
  await context.exposeBinding(ADDRESS_BINDING, ({ page }) => {
    const current = wallet();
    if (!current || !fromSwarmId(page)) throw new Error('no wallet for this page');
    return current.address;
  });
  await context.exposeBinding(SIGN_BINDING, async ({ page }, message: string) => {
    const current = wallet();
    if (!current || !fromSwarmId(page)) throw new Error('no wallet for this page');
    return privateKeyToAccount(current.key).signMessage({ message: personalMessage(message) });
  });
  const settings: ProviderSettings = {
    origin: swarmIdOrigin,
    rpcUrl: rpc,
    addressBinding: ADDRESS_BINDING,
    signBinding: SIGN_BINDING,
  };
  return `(${installProvider.toString()})(${JSON.stringify(settings)});`;
}

interface ProviderSettings {
  origin: string;
  rpcUrl: string;
  addressBinding: string;
  signBinding: string;
}

/** The provider itself, run in the page, so it is plain browser code with its settings passed in. */
function installProvider({ origin, rpcUrl, addressBinding, signBinding }: ProviderSettings): void {
  if (location.origin !== origin || window.top !== window || 'ethereum' in window) return;
  const call = (name: string, ...args: unknown[]) =>
    (window as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...args);
  const refused = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });
  const accounts = async () => {
    try {
      return [await call(addressBinding)];
    } catch {
      throw refused();
    }
  };
  let id = 0;
  const provider = {
    isMetaMask: true,
    async request({ method, params = [] }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return accounts();
        case 'eth_chainId':
          return '0x1';
        case 'net_version':
          return '1';
        case 'wallet_getPermissions':
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
          return null;
        case 'personal_sign':
          return call(signBinding, params[0]);
        default: {
          const answer = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          });
          const body = (await answer.json()) as { result?: unknown; error?: { message: string } };
          if (body.error) throw new Error(body.error.message);
          return body.result;
        }
      }
    },
    on: () => provider,
    removeListener: () => provider,
  };
  Object.defineProperty(window, 'ethereum', { value: provider, writable: true, configurable: true });
}

/**
 * Picks the injected wallet in Swarm ID's wallet picker, when the picker shows. It shows on the first connect of a page
 * and not again while that page stays connected, so its absence is not a failure.
 */
export async function pickInjectedWallet(page: Page): Promise<void> {
  const choice = page.locator('onboard-v2').getByRole('button', { name: /MetaMask/ });
  const shown = await choice
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await choice.click();
}
