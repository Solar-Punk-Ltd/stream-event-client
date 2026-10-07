import { useEffect, useRef, useState } from 'react';
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
import { previewMode, thumbnailFailed } from '@/features/catalog/StreamPreview/previewMode';
import { previewSourceFrom } from '@/features/catalog/StreamPreview/previewSource';
import { CustomFragmentLoader } from '@/features/player/CustomManifestLoader';
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
import { watchPath } from '@/features/catalog/watchPath';
import { PlayIcon } from '@/shared/components/Icons/PlayIcon';
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
  /**
   * The thumbnail reference the browser could not load, which demotes this card out of `image` mode.
   * Held in state rather than handled in the `onError` branch directly, so the decision stays in
   * `previewMode`. A scheduled card must not fall back to a probe, and that rule lives in one place
   * with a test rather than in two handlers.
   *
   * ⛔ The reference and not a boolean, because a card outlives the picture it was given. `StreamList`
   * keys a card by topic, and a topic outlives every broadcast published under it, so a publisher replacing a broken thumbnail re-renders this same mounted component
   * with a new `thumbnail` prop. A boolean latched on the first failure never cleared, and the card
   * went on probing, or, for a scheduled stream, went on showing the placeholder for ever, since a
   * scheduled card is never probed. Comparing against the current reference makes the failure a fact
   * about one picture rather than about the card.
   */
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const imageFailed = thumbnailFailed(failedThumbnail, thumbnail);

  const mode = previewMode({ thumbnail, state, imageFailed });
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
    // announced broadcasts used to mean ten serial misses before a live card could get its frame.
    if (mode !== 'probe') {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    const abort = new AbortController();
    let hls: Hls | null = null;
    let blobUrl: string | null = null;

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

        // Split from the check below, because the two used to share an early return and only one of
        // them is a reason to leave the spinner up. An aborted card is being unmounted and nobody is
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

        // Spelled from the shared constants rather than by hand, so a tag rename cannot leave the
        // preview player asking for a playlist no decoder accepts.
        const miniManifest = [
          HLS_M3U,
          `${HLS_VERSION}:3`,
          `${HLS_TARGET_DURATION}:${PREVIEW_TARGET_DURATION_SECONDS}`,
          HLS_PLAYLIST_TYPE_VOD,
          HLS_MEDIA_SEQUENCE_ZERO,
          seg.extinf,
          segUrl,
          HLS_ENDLIST,
        ].join('\n');

        const blob = new Blob([miniManifest], { type: 'application/vnd.apple.mpegurl' });
        blobUrl = URL.createObjectURL(blob);

        if (abort.signal.aborted) {
          return;
        }

        await new Promise<void>((resolve) => {
          if (!videoRef.current || abort.signal.aborted) {
            resolve();
            return;
          }

          hls = new Hls({ fLoader: CustomFragmentLoader });
          hls.attachMedia(videoRef.current);
          hls.loadSource(blobUrl!);

          const done = () => {
            abort.signal.removeEventListener('abort', done);
            resolve();
          };
          abort.signal.addEventListener('abort', done, { once: true });

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

          hls.on(Events.ERROR, () => {
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
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
    };
  }, [owner, topic, swarm, index, state, slotsKey, mode]);

  const showsPlaceholder = mode === 'placeholder' || (mode === 'probe' && !isLoading && !isDataAvailable);

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
        {mode === 'image' && thumbnail && (
          <img
            // Keyed by the reference so a replaced thumbnail mounts a new element rather than having its
            // `src` swapped underneath. React updates attributes in place, so without this an error for
            // the picture just replaced could arrive after the prop changed and be recorded against the
            // new reference, demoting a card for a failure that was never its own.
            key={thumbnail}
            className="stream-thumbnail-picture"
            src={previews.urlFor(thumbnail, 'thumbnail') ?? undefined}
            // Empty because the title names the stream, and the link reads it out.
            alt=""
            onError={() => setFailedThumbnail(thumbnail)}
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
        {isLoading && (
          <div className="stream-thumbnail-loading">
            <Spinner />
          </div>
        )}

        {/* Nothing to play yet on an announced broadcast, so the thumbnail does not promise one. */}
        {!isScheduled && !isLoading && (
          <span className="stream-thumbnail-play" aria-hidden="true">
            <PlayIcon />
          </span>
        )}
        {isLive && !isLoading && <span className="stream-thumbnail-live">Live</span>}
        {duration && !isLive && !isLoading && (
          <span className="stream-thumbnail-duration">{formatDuration(Number.parseFloat(String(duration)))}</span>
        )}
      </div>

      {!fillsCard && <h3 className="stream-thumbnail-title">{title}</h3>}
    </Link>
  );
};
