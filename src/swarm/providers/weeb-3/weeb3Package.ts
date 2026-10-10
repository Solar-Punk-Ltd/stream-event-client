/**
 * The part of `@lat-murmeldjur/weeb_3` this viewer uses, typed from the `weeb_3.d.ts` of its release
 * 0.0.354001. The package's own module has these shapes and more, so the one import in
 * `weeb3Module.ts` type-checks against them whether it names the stand-in or the package.
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
