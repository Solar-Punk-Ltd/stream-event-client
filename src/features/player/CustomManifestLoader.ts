import type {
  FragmentLoaderContext,
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  PlaylistLoaderContext,
} from 'hls.js';
import Hls, { FetchLoader } from 'hls.js';

import { RequestJitter, StaggeredTask } from '@/shared/requestJitter';

import { BROWSER_NODE_BYTES, isServedOverBzz } from './browserNode';
import { ManifestFetcher } from './ManifestManagement';

export const manifestFetcher = new ManifestFetcher();

/**
 * The stagger every fragment request goes through, shared by every player on the page.
 *
 * A module singleton beside {@link manifestFetcher} and for the same reason: hls.js constructs
 * loaders itself, passing only its own config, so there is no constructor to inject through. Tests
 * reach it by spying on the instance.
 */
export const requestJitter = new RequestJitter();

const PlaylistLoader = Hls.DefaultConfig.loader as unknown as {
  new (config: HlsConfig): Loader<PlaylistLoaderContext>;
};

export class CustomManifestLoader extends PlaylistLoader {
  load(context: PlaylistLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<PlaylistLoaderContext>) {
    if (!['manifest', 'level'].includes(context.type)) {
      super.load(context, config, callbacks);
      return;
    }

    // `manifest` is the top-level request, the one whose answer decides whether this stream is a
    // ladder at all, so it goes through the path that reads the source feed and looks. `level` is
    // one rung, which is a feed like any other.
    const manifest =
      context.type === 'manifest' ? manifestFetcher.fetchSource(context.url) : manifestFetcher.fetch(context.url);

    manifest
      .then((data) => {
        callbacks.onSuccess({ url: context.url, data, code: 200 }, this.stats, context, null);
      })
      .catch((error) => {
        callbacks.onError?.({ code: 0, text: error.message }, context, null, this.stats);
      });
  }
}

type FragmentTransport = new (config: HlsConfig) => Loader<FragmentLoaderContext>;

/**
 * The hls.js loader that moves a fragment's bytes for a page served this way.
 *
 * hls.js's default is its XHR loader, and Freedom registers `bzz:` with `supportFetchAPI` and promises
 * nothing for XHR on a custom scheme, so a page it serves takes the fetch loader. Picked by the page rather than by the viewer's choice of node,
 * because fetch reaches a gateway as well, and a class hls.js constructs cannot be swapped later.
 */
export function fragmentTransport(pageProtocol: string): FragmentTransport {
  return (isServedOverBzz(pageProtocol) ? FetchLoader : Hls.DefaultConfig.loader) as unknown as FragmentTransport;
}

const FragmentLoader = fragmentTransport(typeof window === 'undefined' ? '' : window.location.protocol);

export class CustomFragmentLoader extends FragmentLoader {
  /**
   * The stagger waiting to hand this fragment to the transport, if one is.
   *
   * ⛔ Held so {@link abort} and {@link destroy} can cancel it. hls.js abandons in-flight fragments
   * routinely, on a level switch, a seek and every teardown, and a stagger that fired anyway would
   * start a transfer for a fragment nobody is waiting for any more, against the loader hls.js has
   * already finished with. That is a request the gateway pays for and nothing consumes.
   */
  private pendingStagger: StaggeredTask | null = null;

  load(context: FragmentLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
    const url = context.url;

    // Every playlist this client hands hls.js names its segments absolutely, so anything else here is
    // a bug upstream rather than a URL to repair, and it is not repairable anyway. A preview playlist
    // is a blob, and hls.js resolving `/bytes/<ref>` against `blob:http://viewer/<uuid>` returns
    // `blob:http:/bytes/<ref>`: the origin and the blob id are gone, so there is no gateway left to
    // resolve against. Rebuilding the path against the page's own origin would ask a host that never
    // had the segment. A `bzz://` URL is absolute too, and names the browser's own node.
    //
    // Not optional-chained, unlike the manifest loader above. hls.js declares `onError` required, and
    // this is the one path that returns without reaching the transport: chaining it would turn a
    // missing callback into a fragment that never succeeds and never fails.
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith(BROWSER_NODE_BYTES)) {
      callbacks.onError(
        { code: 0, text: `fragment url is not absolute, so it names no gateway: ${url}` },
        context,
        null,
        this.stats,
      );
      return;
    }

    // Held back by a bounded random delay, because at the live edge every viewer of one broadcast is
    // chasing the same newest segment and asks for it as soon as their playlist reload lands. The
    // gateway is limited by how many ask in the same instant rather than by how many ask at all, so
    // this is the request most worth taking off the shared tick. A zero bound calls the transport
    // synchronously.
    this.pendingStagger = requestJitter.stagger(() => {
      this.pendingStagger = null;
      this.fetchSegmentBytes(context, config, callbacks);
    });
  }

  /**
   * The one place segment bytes are fetched, today from the gateway or the browser's own node through
   * hls.js's own loader. Another source of segment bytes, such as a Swarm node in the tab, plugs in here.
   */
  private fetchSegmentBytes(
    context: FragmentLoaderContext,
    config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>,
  ): void {
    super.load(context, config, {
      ...callbacks,
      // A segment that arrived is proof the gateway is answering, and the manifest side is the only
      // half that ever holds off on the belief that it is not. Its backoff doubles from the failure
      // that set it, so an outage of twenty seconds went unnoticed for thirty: the gateway was back
      // for ten of them and the one thing still talking to it was this. Reported here because the
      // player fetches segments anyway on hls.js's own retry cadence, so the signal is free. A segment
      // from the browser's own node says nothing about the gateway the feeds are read from.
      onSuccess: (response, stats, ctx, networkDetails) => {
        if (!context.url.startsWith(BROWSER_NODE_BYTES)) {
          manifestFetcher.feedHealth.recordGatewayReachable();
        }
        callbacks.onSuccess(response, stats, ctx, networkDetails);
      },
    });
  }

  abort(): void {
    this.cancelStagger();
    super.abort();
  }

  destroy(): void {
    this.cancelStagger();
    super.destroy();
  }

  private cancelStagger(): void {
    this.pendingStagger?.cancel();
    this.pendingStagger = null;
  }
}
