import { PrivateKey } from '@ethersphere/bee-js';

import type {
  LoadSwarmIdClient,
  SwarmIdButtonAction,
  SwarmIdButtonConfig,
  SwarmIdButtonOptions,
  SwarmIdChunkToStamp,
  SwarmIdClient,
  SwarmIdClientOptions,
  SwarmIdConnectionInfo,
  SwarmIdMountedButton,
  SwarmIdPostageBatch,
  SwarmIdStampedChunk,
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

/** The fake names a stamp by its label, so two stamps with different labels have different ids. */
function postageBatchIdOf(batch: SwarmIdPostageBatch): string {
  const hex = Array.from(new TextEncoder().encode(batch.label), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.padEnd(64, '0').slice(0, 64);
}

/** The library's own labels, which a button shows when the site names none. */
const LIBRARY_LABELS: Record<SwarmIdButtonAction, string> = {
  'sign-in': 'Sign in with Swarm ID',
  'change-stamp': 'Change stamp in Swarm ID',
};

/**
 * A button the viewer mounted, as the library's frame would draw it: a real button in the container, whose click is
 * the click inside Swarm ID's frame, so the window it opens is Swarm ID's own.
 */
class FakeSwarmIdButton implements SwarmIdMountedButton {
  readonly element = document.createElement('button');
  readonly ready: Promise<void>;
  private rejectReady: (error: unknown) => void = () => {};
  private isSettled = false;
  /** Every look and action the viewer handed over after mounting it, in order. */
  readonly updates: Array<{ action?: SwarmIdButtonAction; config?: SwarmIdButtonConfig }> = [];
  action: SwarmIdButtonAction;
  config: SwarmIdButtonConfig | undefined;
  unmounted = false;

  constructor(
    readonly container: HTMLElement,
    readonly options: SwarmIdButtonOptions,
    private readonly client: FakeSwarmIdClient,
    ready: Promise<void>,
  ) {
    // Unmounted before it showed, the library's button rejects with invalid-state, which a hanging frame lets a test see.
    this.ready = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      ready.then(resolve, reject);
    });
    this.ready.then(
      () => (this.isSettled = true),
      () => (this.isSettled = true),
    );
    this.action = options.action;
    this.config = options.config;
    this.element.type = 'button';
    this.element.dataset.fakeSwarmIdButton = '';
    this.element.addEventListener('click', () => this.client.clickButton(this));
    this.draw();
    container.appendChild(this.element);
  }

  update(next: { action?: SwarmIdButtonAction; config?: SwarmIdButtonConfig }): void {
    this.updates.push(next);
    this.action = next.action ?? this.action;
    this.config = next.config ?? this.config;
    this.draw();
  }

  unmount(): void {
    this.unmounted = true;
    this.element.remove();
    if (!this.isSettled) {
      this.rejectReady(Object.assign(new Error('Swarm ID button unmounted'), { code: 'invalid-state' }));
    }
  }

  private draw(): void {
    this.element.textContent = this.config?.text ?? LIBRARY_LABELS[this.action];
    this.element.disabled = Boolean(this.config?.disabled);
    if (this.config?.ariaLabel) {
      this.element.setAttribute('aria-label', this.config.ariaLabel);
    } else {
      this.element.removeAttribute('aria-label');
    }
  }
}

/**
 * Stands in for the Swarm ID library's client. Nothing is framed and no window opens: a button the viewer mounts is a
 * real button standing in for Swarm ID's frame, a test says what the browser did with the window its click opens, and
 * plays the window's handover with {@link FakeSwarmIdClient.handOver}.
 */
export class FakeSwarmIdClient implements SwarmIdClient {
  info: SwarmIdConnectionInfo;
  /** Times the page called `connect()` itself, which the library refuses where storage is partitioned. */
  connectCalls = 0;
  disconnectCalls = 0;
  destroyed = false;
  /** What the browser does with the next window a button's click opens: open it, or block it. */
  nextWindow: 'opens' | 'blocked' = 'opens';
  /** How many Swarm ID windows a button's click opened. */
  windowsOpened = 0;
  /** Every button the viewer mounted, in order, unmounted ones too. */
  readonly buttons: FakeSwarmIdButton[] = [];
  /** A button frame Swarm ID refuses, as for a site not on its allow list. */
  buttonFails = false;
  /** A button frame that never answers. */
  buttonHangs = false;
  isInitialized = false;
  initializeFails = false;
  /** A frame that never answers, so the viewer stays starting. */
  initializeHangs = false;
  /** The chat key the frame gives, per site, as the fork derives it. */
  chatKey: Uint8Array = new Uint8Array();
  /** Every Bee address the viewer moved this site's content to after the client was built, in order. */
  readonly beeApiUrls: string[] = [];
  /** Refuses the next Bee address it is handed, as the frame does before it is ready, though it records the ask. */
  refusesNextBeeApiUrl = false;
  /** The stamp Swarm ID gives this site, none by default. */
  postageBatch: SwarmIdPostageBatch | undefined = undefined;
  /** Every chunk the viewer asked the frame to stamp, in order. */
  readonly stamped: SwarmIdChunkToStamp[] = [];
  /** What the frame refuses the next stamp with, as the library rejects. */
  stampRefusal: unknown = null;
  /** How many times the viewer read the stamp's figures. */
  postageBatchReads = 0;
  /** A frame that never answers a read of the stamp's figures. */
  postageBatchHangs = false;
  /** A frame that refuses the next read of the stamp's figures. */
  postageBatchFailsOnce = false;

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
    this.isInitialized = true;
    this.options.onConnectionChange(this.connectionInfo);
  }

  /**
   * The library's `connect()` for a site on another site than Swarm ID, where the browser partitions the frame's
   * storage: it opens nothing. The viewer's client has no such call, so this only counts a page that reached it anyway.
   */
  connect(): Promise<void> {
    this.connectCalls += 1;
    return Promise.reject(
      Object.assign(new Error('Sign in through the button from client.mountButton().'), { code: 'button-required' }),
    );
  }

  mountButton(container: HTMLElement, options: SwarmIdButtonOptions): SwarmIdMountedButton {
    if (!this.isInitialized) {
      throw Object.assign(new Error('SwarmIdClient not initialized'), { code: 'invalid-state' });
    }
    const ready = this.buttonHangs
      ? new Promise<void>(() => {})
      : this.buttonFails
        ? Promise.reject(Object.assign(new Error('This site is not on the allow list'), { code: 'init-failed' }))
        : Promise.resolve();
    const button = new FakeSwarmIdButton(container, options, this, ready);
    this.buttons.push(button);
    return button;
  }

  /** The click inside Swarm ID's frame, which opens its window or is blocked by the browser. */
  clickButton(button: FakeSwarmIdButton): void {
    if (this.nextWindow === 'blocked') {
      button.options.onWindowChange?.('blocked');
      return;
    }
    this.windowsOpened += 1;
    button.options.onWindowChange?.('open');
  }

  /** The person closes the Swarm ID window a button opened. */
  closeWindow(button: FakeSwarmIdButton = this.shownButton()): void {
    button.options.onWindowChange?.('closed');
  }

  /** The one button the viewer shows now. */
  shownButton(): FakeSwarmIdButton {
    const shown = this.buttons.filter(({ unmounted }) => !unmounted);
    if (shown.length !== 1) {
      throw new Error(`the viewer shows ${shown.length} Swarm ID buttons`);
    }
    return shown[0];
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
    if (this.refusesNextBeeApiUrl) {
      this.refusesNextBeeApiUrl = false;
      throw new Error('Swarm ID is not ready');
    }
  }

  async stampChunk(chunk: SwarmIdChunkToStamp): Promise<SwarmIdStampedChunk> {
    this.stamped.push(chunk);
    if (this.stampRefusal) {
      throw this.stampRefusal;
    }
    return {
      address: 'f'.repeat(64),
      stamp: 'e'.repeat(226),
      owner: new PrivateKey(chunk.signer.privateKey).publicKey().address().toHex(),
      signature: 'ab'.repeat(65),
    };
  }

  async getPostageBatch(): Promise<SwarmIdPostageBatch | undefined> {
    this.postageBatchReads += 1;
    if (this.postageBatchHangs) {
      return new Promise(() => {});
    }
    if (this.postageBatchFailsOnce) {
      this.postageBatchFailsOnce = false;
      throw new Error('Swarm ID did not answer');
    }
    if (!this.info.identity) {
      throw Object.assign(new Error('Not authenticated'), { code: 'not-authenticated' });
    }
    return this.postageBatch;
  }

  /** The session as the library reports it, with the id of the stamp this site uses while one is signed in. */
  get connectionInfo(): SwarmIdConnectionInfo {
    return this.info.identity && this.postageBatch
      ? { ...this.info, postageBatchId: postageBatchIdOf(this.postageBatch) }
      : this.info;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** What the Swarm ID window does when the person picks an account, and what a sign-out reports. */
  handOver(info: SwarmIdConnectionInfo): void {
    this.info = info;
    this.options.onConnectionChange(this.connectionInfo);
  }

  /**
   * What the Swarm ID window does when the person, already signed in, picks another stamp for this site: the frame
   * takes it at once and reports the same session again with the new stamp's id.
   */
  pickStamp(batch: SwarmIdPostageBatch | undefined): void {
    this.postageBatch = batch;
    this.handOver(this.info);
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
