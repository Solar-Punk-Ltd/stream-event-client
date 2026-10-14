/**
 * The part of the Swarm ID library's client this viewer uses, in the library's own shapes. Nothing else in the viewer
 * imports the library, so how it is installed stays one line, and a test stands in for it with these shapes.
 */

/** The account a session belongs to. `address` is the account key's address, 40 hex digits with no 0x. */
export interface SwarmIdIdentity {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

/** The account's signed statement that this site's chat address is its own, spelled as the library spells it. */
export interface SwarmIdChatBinding {
  readonly message: string;
  readonly signature: string;
}

/** What the library reports about the session. Both are absent while nobody is signed in. */
export interface SwarmIdConnectionInfo {
  readonly identity?: SwarmIdIdentity;
  readonly chatBinding?: SwarmIdChatBinding;
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

export interface SwarmIdClient {
  /** Embeds the Swarm ID site's hidden frame and restores the session it keeps for this site, if any. */
  initialize(): Promise<void>;
  /** Opens the Swarm ID window. Called from a click, or the browser blocks the window. */
  connect(): Promise<void>;
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

/** The library's error code for a window the browser refused to open. */
const POPUP_BLOCKED = 'popup-blocked';

export function isWindowBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === POPUP_BLOCKED;
}

/** The library is a file of the bundle of its own, fetched only by a deployment that offers Swarm ID. */
export const loadSwarmIdLibrary: LoadSwarmIdClient = async (options) =>
  (await import('./swarmIdLibrary')).createLibraryClient(options);
