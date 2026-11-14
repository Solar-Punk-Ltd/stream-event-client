import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  HLS_ENDLIST,
  HLS_M3U,
  HLS_MEDIA_SEQUENCE_ZERO,
  HLS_PLAYLIST_TYPE_VOD,
  HLS_TARGET_DURATION,
  HLS_VERSION,
} from '@/shared/hlsTags';
import Hls, { Events } from 'hls.js';
import Pqueue from 'p-queue';

import { fetchPreviewManifest, rungSlotsKey } from '@/features/catalog/StreamPreview/previewManifest';
import { pictureFailed, pictureSourceOf, previewMode } from '@/features/catalog/StreamPreview/previewMode';
import { PREVIEW_PLAYLIST_URL, previewPlaylistLoader } from '@/features/catalog/StreamPreview/previewPlaylistLoader';
import { previewSourceFrom } from '@/features/catalog/StreamPreview/previewSource';
import { CustomFragmentLoader } from '@/features/player/CustomManifestLoader';
import { segmentLoadFailure } from '@/features/player/segmentLoads';
import { useAppContext } from '@/app/AppProvider';
import {
  MediaType,
  Rendition,
  STREAM_STATUS_LIVE,
  STREAM_STATUS_SCHEDULED,
  StreamState,
} from '@/features/catalog/stream';
import { formatDuration } from '@/features/catalog/format';
import { previewSegmentUrl } from '@/features/catalog/thumbnailManifest';
import { mapUri, withMapUri } from '@/shared/manifest';
import { watchPath } from '@/features/catalog/watchPath';
import { PlayIcon } from '@/shared/components/Icons/PlayIcon';
import { useNodeState } from '@/shared/nodeInTabStatus';
import { Spinner } from '@/shared/components/Spinner/Spinner';

import { PreviewPlaceholder } from './PreviewPlaceholder';

import './StreamPreview.scss';

const thumbnailQueue = new Pqueue({ concurrency: 1 });

/**
 * `fill` takes the width of a card or featured block, which carries the title and its own link beside
 * the picture. `compact` is msrs-client's fixed 210 by 180 thumbnail with the title under it, as search
 * results show it.
 */
export type ThumbnailVariant = 'fill' | 'compact';

interface StreamPreviewProps {
  variant: ThumbnailVariant;
  owner: string;
  topic: string;
  state?: StreamState;
  duration?: string | number;
  mediatype: MediaType;
  title: string;
  /** The SOC index of this stream's final manifest, published by the uploader on a finished stream. */
  index?: number;
  /** A ladder's rungs, which on a finished entry name the slot each recorded rung's final playlist is at. */
  renditions?: Rendition[];
  /** A Swarm reference to a still image the publisher uploaded. Absent or '' when there is none. */
  thumbnail?: string;
}

/** The preview plays one segment, so the target duration only has to be at least that long. */
const PREVIEW_TARGET_DURATION_SECONDS = 10;

export const StreamPreview = ({
  variant,
  owner,
  topic,
  state,
  duration,
  mediatype,
  title,
  index,
  renditions,
  thumbnail,
}: StreamPreviewProps) => {
  const { swarm } = useAppContext();
  const previews = swarm.reader('previews');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataAvailable, setIsDataAvailable] = useState(false);
  // Read again while the card shows, because a node in this tab gives the picture its URL only once it
  // is ready, and nothing else renders the card again when it becomes so.
  const previewsState = useNodeState(useCallback(() => swarm.statusOf('previews').state, [swarm]));
  const pictureUrl = thumbnail ? previews.urlFor(thumbnail, 'thumbnail') : null;
  /**
   * The picture's URL the browser could not load, which demotes this card out of `image` mode.
   * Held in state rather than handled in the `onError` branch directly, so the decision stays in
   * `previewMode`. A scheduled card must not fall back to a probe, and that rule lives in one place
   * with a test rather than in two handlers.
   *
   * The URL and not a boolean, because a card outlives the picture it was given and the source it
   * was read from. `StreamList` keys a card by topic, and a topic outlives every broadcast published
   * under it, so a publisher replacing a broken thumbnail re-renders this same mounted component with
   * a new `thumbnail` prop, and a viewer switching Previews to another source re-renders it with a new
   * URL. A boolean latched on the first failure never cleared, and the card went on probing, or, for a
   * scheduled stream, went on showing the placeholder for ever, since a scheduled card is never probed.
   */
  const [failedPictureUrl, setFailedPictureUrl] = useState<string | null>(null);
  const imageFailed = pictureFailed(failedPictureUrl, pictureUrl);

  const mode = previewMode({
    thumbnail,
    state,
    imageFailed,
    picture: pictureSourceOf(pictureUrl, previewsState),
  });
  const isScheduled = state === STREAM_STATUS_SCHEDULED;
  const isLive = state === STREAM_STATUS_LIVE;
  const fillsCard = variant === 'fill';

  // Read through a ref, not a dependency: the catalog poll hands back a fresh array every time, and
  // `slotsKey` is what the effect reacts to. The player keys its ladder the same way.
  const renditionsRef = useRef(renditions);
  renditionsRef.current = renditions;
  const slotsKey = rungSlotsKey({ state, renditions });

  useEffect(() => {
    // The card already knows what it is showing, so nothing is fetched and no queue slot is taken.
    // This is the whole saving for a scheduled stream: its manifest feed does not exist, and ten
    // announced broadcasts would mean ten serial misses before a live card could get its frame.
    if (mode !== 'probe') {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    const abort = new AbortController();
    let hls: Hls | null = null;

    // The task catches its own failure and clears the spinner, so nothing waits on the queue.
    void thumbnailQueue.add(async () => {
      if (abort.signal.aborted) {
        return;
      }

      try {
        const { res, segments } = await fetchPreviewManifest(
          previews,
          { owner, topic, index, state, renditions: renditionsRef.current },
          abort.signal,
        );

        // Kept apart from the check below, because only one of
        // the two is a reason to leave the spinner up. An aborted card is being unmounted and nobody is
        // looking at it. A card with nothing to show is on screen and has to say so.
        if (abort.signal.aborted) {
          return;
        }

        const source = previewSourceFrom(res, segments);
        if (source.kind === 'unavailable') {
          console.warn(`Thumbnail unavailable for ${topic}: ${source.reason}`);
          setIsLoading(false);
          return;
        }

        const seg = source.firstSegment;
        const segUrl = previewSegmentUrl(seg.uri, (reference) => previews.urlFor(reference, 'preview-segment'));
        if (segUrl === null) {
          console.warn(`Thumbnail unavailable for ${topic}: no provider gives a URL for its segment`);
          setIsLoading(false);
          return;
        }

        // An fMP4 segment decodes only after its initialization section, so its map comes along,
        // resolved through the same source as the segment.
        let mapLine: string | null = null;
        if (seg.map !== undefined) {
          const reference = mapUri(seg.map);
          const mapUrl =
            reference === null ? null : previewSegmentUrl(reference, (ref) => previews.urlFor(ref, 'preview-segment'));
          if (mapUrl === null) {
            console.warn(`Thumbnail unavailable for ${topic}: no provider gives a URL for its initialization section`);
            setIsLoading(false);
            return;
          }
          mapLine = withMapUri(seg.map, mapUrl);
        }

        // Spelled from the shared constants rather than by hand, so a tag rename cannot leave the
        // preview player asking for a playlist no decoder accepts. A map needs version 6 (RFC 8216 §7).
        const miniManifest = [
          HLS_M3U,
          `${HLS_VERSION}:${mapLine === null ? 3 : 6}`,
          `${HLS_TARGET_DURATION}:${PREVIEW_TARGET_DURATION_SECONDS}`,
          HLS_PLAYLIST_TYPE_VOD,
          HLS_MEDIA_SEQUENCE_ZERO,
          ...(mapLine === null ? [] : [mapLine]),
          seg.extinf,
          segUrl,
          HLS_ENDLIST,
        ].join('\n');

        await new Promise<void>((resolve) => {
          if (!videoRef.current || abort.signal.aborted) {
            resolve();
            return;
          }

          hls = new Hls({ pLoader: previewPlaylistLoader(miniManifest), fLoader: CustomFragmentLoader });
          hls.attachMedia(videoRef.current);
          hls.loadSource(PREVIEW_PLAYLIST_URL);

          const done = () => {
            abort.signal.removeEventListener('abort', done);
            resolve();
          };
          abort.signal.addEventListener('abort', done, { once: true });

          hls.on(Events.FRAG_LOADED, () => previews.reportUrlLoad({ loaded: true }));
          hls.on(Events.FRAG_CHANGED, () => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.pause();
            }
            setIsDataAvailable(true);
            setIsLoading(false);
            hls?.stopLoad();
            done();
          });

          hls.on(Events.ERROR, (_event, data) => {
            const segmentFailure = segmentLoadFailure(data);
            if (segmentFailure) {
              previews.reportUrlLoad(segmentFailure);
            }
            setIsLoading(false);
            done();
          });
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Thumbnail load failed:', err);
        setIsLoading(false);
      }
    });

    return () => {
      abort.abort();
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };
  }, [owner, topic, swarm, index, state, slotsKey, mode]);

  const showsPlaceholder = mode === 'placeholder' || (mode === 'probe' && !isLoading && !isDataAvailable);
  const showsLoading = isLoading || mode === 'waiting';

  return (
    <Link
      className={`stream-thumbnail ${variant}`}
      to={watchPath({ mediatype, owner, topic })}
      // In a card the title and the call to watch sit beside the picture, so the picture is a second,
      // pointer-only way in, still named for the stream it opens.
      aria-label={fillsCard ? title : undefined}
      tabIndex={fillsCard ? -1 : undefined}
    >
      <div className="stream-thumbnail-media">
        {/*
          The picture, from exactly one of the three sources `previewMode` names. The video element is
          mounted only for a probe: `videoRef` is what the effect attaches hls.js to, so rendering it
          beside an image would hand the card a second, black layer for no reason.
        */}
        {mode === 'image' && pictureUrl !== null && (
          <img
            // Keyed by the URL so a replaced thumbnail or another source mounts a new element rather than
            // having its `src` swapped underneath. React updates attributes in place, so without this an
            // error for the picture just replaced could arrive after it changed and be recorded against
            // the new one, demoting a card for a failure that was never its own.
            key={pictureUrl}
            className="stream-thumbnail-picture"
            src={pictureUrl}
            // Empty because the title names the stream, and the link reads it out.
            alt=""
            onLoad={() => previews.reportUrlLoad({ loaded: true })}
            onError={() => {
              previews.reportUrlLoad({ loaded: false, status: null });
              setFailedPictureUrl(pictureUrl);
            }}
          />
        )}
        {mode === 'probe' && (
          <video
            ref={videoRef}
            className="stream-thumbnail-picture"
            controls={false}
            muted
            playsInline
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        {showsPlaceholder && <PreviewPlaceholder />}
        {showsLoading && (
          <div className="stream-thumbnail-loading">
            <Spinner />
          </div>
        )}

        {/* Nothing to play yet on an announced broadcast, so the thumbnail does not promise one. */}
        {!isScheduled && !showsLoading && (
          <span className="stream-thumbnail-play" aria-hidden="true">
            <PlayIcon />
          </span>
        )}
        {isLive && !showsLoading && <span className="stream-thumbnail-live">Live</span>}
        {duration && !isLive && !showsLoading && (
          <span className="stream-thumbnail-duration">{formatDuration(Number.parseFloat(String(duration)))}</span>
        )}
      </div>

      {!fillsCard && <h3 className="stream-thumbnail-title">{title}</h3>}
    </Link>
  );
};
