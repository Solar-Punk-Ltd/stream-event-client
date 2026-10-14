import type {
  LoadSwarmIdClient,
  SwarmIdClient,
  SwarmIdClientOptions,
  SwarmIdConnectionInfo,
} from '../../src/features/chat/swarmId/swarmIdClient';

import { BOUND_SITE, CHAT_BINDING, chatKeyFor, FORK_ACCOUNT, OTHER_SITE, OTHER_SITE_BINDING } from './signedChat';

function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

/** The fork's test account as the Swarm ID library reports it: a bare hex address and the account's own name. */
export const FORK_IDENTITY = { id: FORK_ACCOUNT.slice(2), name: 'Ida', address: FORK_ACCOUNT.slice(2) };

/** The fork's binding for {@link BOUND_SITE}, spelled the way the Swarm ID library hands it over. */
export const FORK_BINDING = { message: CHAT_BINDING.msg, signature: CHAT_BINDING.sig };

export const FORK_OTHER_SITE_BINDING = { message: OTHER_SITE_BINDING.msg, signature: OTHER_SITE_BINDING.sig };

/** The session the Swarm ID window hands this site, in the library's shapes. */
export const SIGNED_IN: SwarmIdConnectionInfo = { identity: FORK_IDENTITY, chatBinding: FORK_BINDING };

const BLOCKED_ERROR = Object.assign(new Error('Failed to open authentication popup'), { code: 'popup-blocked' });

/**
 * Stands in for the Swarm ID library's client. Nothing is framed and no window opens: a test says what the browser did
 * with the window, and plays the window's handover with {@link FakeSwarmIdClient.handOver}.
 */
class FakeSwarmIdClient implements SwarmIdClient {
  info: SwarmIdConnectionInfo;
  connectCalls = 0;
  disconnectCalls = 0;
  destroyed = false;
  /** What the browser does with the next window: open it, or block it. */
  nextWindow: 'opens' | 'blocked' = 'opens';
  initializeFails = false;
  /** A frame that never answers, so the viewer stays starting. */
  initializeHangs = false;
  /** The chat key the frame gives, per site, as the fork derives it. */
  chatKey: Uint8Array = new Uint8Array();
  /** Every Bee address the viewer moved this site's content to after the client was built, in order. */
  readonly beeApiUrls: string[] = [];

  constructor(
    readonly options: SwarmIdClientOptions,
    kept: SwarmIdConnectionInfo,
  ) {
    this.info = kept;
  }

  async initialize(): Promise<void> {
    if (this.initializeHangs) {
      return new Promise(() => {});
    }
    if (this.initializeFails) {
      throw Object.assign(new Error('This site is not on the allow list'), { code: 'init-failed' });
    }
    this.options.onConnectionChange(this.info);
  }

  connect(): Promise<void> {
    this.connectCalls += 1;
    return this.nextWindow === 'blocked' ? Promise.reject(BLOCKED_ERROR) : Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.handOver({});
  }

  async getChatKey(): Promise<Uint8Array> {
    if (!this.info.identity) {
      throw Object.assign(new Error('Not authenticated'), { code: 'not-authenticated' });
    }
    return this.chatKey;
  }

  async setBeeApiUrl(url: string): Promise<void> {
    this.beeApiUrls.push(url);
  }

  get connectionInfo(): SwarmIdConnectionInfo {
    return this.info;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** What the Swarm ID window does when the person picks an account, and what a sign-out reports. */
  handOver(info: SwarmIdConnectionInfo): void {
    this.info = info;
    this.options.onConnectionChange(info);
  }
}

export interface FakeSwarmId {
  load: LoadSwarmIdClient;
  /** The client the viewer built, once it has. */
  client: () => FakeSwarmIdClient;
}

/** A loader for the viewer, with the session the frame keeps for this site, none by default. */
export async function fakeSwarmId(
  kept: SwarmIdConnectionInfo = {},
  setUp: (client: FakeSwarmIdClient) => void = () => {},
): Promise<FakeSwarmId> {
  const chatKey = bytesOf(await chatKeyFor(BOUND_SITE));
  let built: FakeSwarmIdClient | null = null;
  return {
    load: async (options) => {
      built = new FakeSwarmIdClient(options, kept);
      built.chatKey = chatKey;
      setUp(built);
      return built;
    },
    client: () => {
      if (!built) {
        throw new Error('the viewer has not built a Swarm ID client');
      }
      return built;
    },
  };
}

/** The chat key the fork gives {@link OTHER_SITE}, for a frame that answers with another site's key. */
export async function otherSiteChatKey(): Promise<Uint8Array> {
  return bytesOf(await chatKeyFor(OTHER_SITE));
}
