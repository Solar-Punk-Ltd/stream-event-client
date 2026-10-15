/**
 * The part of the Swarm ID library's client this viewer uses, in the library's own shapes. Nothing else in the viewer
 * imports the library, so how it is installed stays one line, and a test stands in for it with these shapes.
 */

/**
 * The account's statement, signed by its wallet and countersigned by its own key, that the two belong to the same
 * person, which lets a reader show the wallet's ENS name. Shared only while the person has "Show my ENS name on sites"
 * on in Swarm ID.
 */
export interface SwarmIdWalletLink {
  readonly message: string;
  readonly walletSignature: string;
  readonly accountSignature: string;
}

/** The account a session belongs to. `address` is the account key's address, 40 hex digits with no 0x. */
export interface SwarmIdIdentity {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly walletLink?: SwarmIdWalletLink;
}

/** The account's signed statement that this site's chat address is its own, spelled as the library spells it. */
export interface SwarmIdChatBinding {
  readonly message: string;
  readonly signature: string;
}

/** What the library reports about the session. The identity and the binding are absent while nobody is signed in. */
export interface SwarmIdConnectionInfo {
  readonly identity?: SwarmIdIdentity;
  readonly chatBinding?: SwarmIdChatBinding;
  /** The id of the stamp this site uses, absent while Swarm ID gives it none. */
  readonly postageBatchId?: string;
}

/**
 * The stamp Swarm ID gives this site, as far as the viewer reads it. `utilization` is the share of it used, 0 to 1, and
 * `batchTTL` its time left in seconds, absent when Swarm ID could not tell.
 */
export interface SwarmIdPostageBatch {
  readonly label: string;
  readonly utilization: number;
  readonly usable: boolean;
  readonly exists: boolean;
  readonly batchTTL?: number;
}

/**
 * A single-owner chunk for the frame to sign and stamp: the identifier as 64 hex digits, the span and payload as one,
 * and the key it is signed with, 64 hex digits.
 */
export interface SwarmIdChunkToStamp {
  readonly kind: 'soc';
  readonly identifier: string;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly signer: { readonly privateKey: string };
}

/** What the frame hands back: the chunk's address, the stamp as Bee's `swarm-postage-stamp` header takes it, and the signature. */
export interface SwarmIdStampedChunk {
  readonly address: string;
  readonly stamp: string;
  readonly owner?: string;
  readonly signature?: string;
}

/** What a click on Swarm ID's button does: sign in, or, for a viewer signed in, pick the stamp this site uses. */
export type SwarmIdButtonAction = 'sign-in' | 'change-stamp';

/**
 * A font file Swarm ID's frame loads for the button's label, fetched from Swarm ID's origin, so it is served with an
 * `Access-Control-Allow-Origin` naming that origin. `url` is https, or plain http on this machine.
 */
export interface SwarmIdButtonFontFace {
  readonly family: string;
  readonly url: string;
  readonly weight?: string | number;
  readonly style?: 'normal' | 'italic' | 'oblique';
}

/**
 * How Swarm ID's button looks and reads. It is painted in Swarm ID's own frame, where this page's stylesheet cannot
 * reach, so the look is handed over as values. Colours, sizes and the radius are CSS values, and the
 * typeface is a CSS font-family whose files the frame loads from `fontFaces`.
 */
export interface SwarmIdButtonConfig {
  readonly text?: string;
  readonly busyText?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly backgroundColor?: string;
  readonly color?: string;
  readonly borderRadius?: string;
  readonly fontFamily?: string;
  readonly fontSize?: string;
  readonly fontWeight?: string | number;
  /** At most 8. */
  readonly fontFaces?: readonly SwarmIdButtonFontFace[];
}

/** Where the window a click on Swarm ID's button opened is. `blocked`: the browser refused to open it. */
export type SwarmIdWindowState = 'open' | 'closed' | 'blocked';

export interface SwarmIdButtonOptions {
  readonly action: SwarmIdButtonAction;
  readonly config?: SwarmIdButtonConfig;
  readonly onWindowChange?: (state: SwarmIdWindowState) => void;
}

/** A Swarm ID button shown in a container of this page. Taking it away leaves the session as it is. */
export interface SwarmIdMountedButton {
  /** Resolves once the button shows, and rejects when Swarm ID refuses its frame or it does not answer in time. */
  readonly ready: Promise<void>;
  update(next: { action?: SwarmIdButtonAction; config?: SwarmIdButtonConfig }): void;
  unmount(): void;
}

export interface SwarmIdClient {
  /** Embeds the Swarm ID site's hidden frame and restores the session it keeps for this site, if any. */
  initialize(): Promise<void>;
  /**
   * Shows Swarm ID's button, a small frame of the Swarm ID site that fills the container. The click on it opens the
   * Swarm ID window, which is the only way a site on another site than Swarm ID can sign in, since the browser keeps
   * Swarm ID's frames apart from its storage there. Throws before {@link initialize} has resolved.
   */
  mountButton(container: HTMLElement, options: SwarmIdButtonOptions): SwarmIdMountedButton;
  /** Ends the session for this site, so a reload does not restore it. */
  disconnect(): Promise<void>;
  /** This site's chat key, which the frame gives only to a signed-in session. */
  getChatKey(): Promise<Uint8Array>;
  readonly connectionInfo: SwarmIdConnectionInfo;
  /**
   * Moves the Bee node this site's content is read and written through, which the viewer's chat history source is.
   * Refused before {@link initialize} has resolved.
   */
  setBeeApiUrl(url: string): Promise<void>;
  /**
   * Has the frame sign a chunk and stamp it with the stamp Swarm ID gives this site, and hands the stamp back. The
   * frame refuses with a `code`, and a `reason` for `upload-unavailable`, such as `no-stamp` or `stamp-expired`.
   */
  stampChunk(chunk: SwarmIdChunkToStamp): Promise<SwarmIdStampedChunk>;
  /** The stamp Swarm ID gives this site, or undefined when it gives none. */
  getPostageBatch(): Promise<SwarmIdPostageBatch | undefined>;
  destroy(): void;
}

export interface SwarmIdClientOptions {
  /** The Swarm ID site's origin. */
  url: string;
  /** What the Swarm ID window calls this site. */
  appName: string;
  onConnectionChange: (info: SwarmIdConnectionInfo) => void;
  /** The Bee node this site's content goes through at first, a Bee API base URL. Swarm ID's own default when absent. */
  beeApiUrl?: string;
}

export type LoadSwarmIdClient = (options: SwarmIdClientOptions) => Promise<SwarmIdClient>;

/** The library is a file of the bundle of its own, fetched only by a deployment that offers Swarm ID. */
export const loadSwarmIdLibrary: LoadSwarmIdClient = async (options) =>
  (await import('./swarmIdLibrary')).createLibraryClient(options);
