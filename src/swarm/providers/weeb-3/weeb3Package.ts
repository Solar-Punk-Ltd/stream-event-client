/**
 * The part of `@lat-murmeldjur/weeb_3` this viewer uses, typed from the `weeb_3.d.ts` of its release
 * 0.0.354001. The package's own module has these shapes and more, so the one import in
 * `weeb3Module.ts` type-checks against them, and a test's fake of the package has them too.
 */

/** Where `attachStream` starts: the feed's newest entry, or the earliest it can rebuild. */
export type HlsStart = 'beginning' | 'live';

/** A node running in this tab, as `new Weeb3No103(...)` makes it. */
export interface Weeb3Node {
  /** Joins the network. Without options it dials the package's built-in mainnet bootnodes. */
  start(options?: unknown): void;
  /** How many peers the node is connected to. Rejects when its shared worker cannot be reached. */
  connectionCount(): Promise<number>;
  /** Plays a stream into a media element the page owns, with the package's own player. */
  attachStream(media: HTMLMediaElement, owner: string, topic: string, start: HlsStart): Promise<void>;
  /**
   * Pushes one chunk stamped elsewhere to the network: its bytes as Bee keeps them (a single-owner chunk's identifier,
   * signature, span and payload), whether it is a single-owner chunk, its address and the 113-byte stamp. Answers
   * "Upload result: success" once pushed. A stamp from a key that does not own the batch never answers.
   */
  postPushChunk(data: Uint8Array, soc: boolean, chunkAddress: Uint8Array, stamp: Uint8Array): Promise<string>;
  free(): void;
}

/** What `import('@lat-murmeldjur/weeb_3')` resolves to. */
export interface Weeb3Package {
  /**
   * Loads the WebAssembly module, once per page, before any node is made: from a URL, from a fetched
   * answer, or from its bytes.
   */
  default(input?: { readonly module_or_path: string | Response | BufferSource }): Promise<unknown>;
  /**
   * The scope is `/weeb-3/` unless named. `/` lets the package's service worker answer `/weeb-3/...`
   * for a page served anywhere on the site, which needs `Service-Worker-Allowed: /` on its script.
   */
  Weeb3No103: new (sharedWorkerUrl?: string | null, serviceWorkerScope?: string | null) => Weeb3Node;
}
