import { Link, useParams, useSearchParams } from 'react-router';

import { SwarmHlsPlayer } from '@/features/player/SwarmHlsPlayer';
import { useAppContext } from '@/app/AppProvider';
import type { SwarmClient } from '@/swarm/client';
import { watchPageCatalogPollMs } from '@/features/catalog/catalogPoll';
import { useCatalogPoll } from '@/features/catalog/useCatalogPoll';
import { ROUTES } from '@/app/routes';
import { MEDIA_TYPE_AUDIO, MEDIA_TYPE_VIDEO, MediaType } from '@/features/catalog/stream';
import { playableRenditions } from '@/features/player/playableRenditions';
import { scheduledStartMs } from '@/features/catalog/scheduledStart';
import { WATCH_VIEW_PLAYER, watchPageDescription, watchPageView } from '@/features/catalog/watchPageView';
import { WatchChat } from '@/features/chat/WatchChat';

import { useIsWaitingForStart } from './useIsWaitingForStart';
import { WatchLayout } from './WatchLayout';
import { WatchNotice, WatchPlaceholder } from './WatchPlaceholder';

import './StreamWatcher.scss';

const VALID_MEDIA_TYPES: MediaType[] = [MEDIA_TYPE_AUDIO, MEDIA_TYPE_VIDEO];

function isMediaType(value: string): value is MediaType {
  return VALID_MEDIA_TYPES.includes(value as MediaType);
}

/** The picture a publisher gave the stream, where the gateway serves it. Absent and empty mean none. */
function streamPictureUrl(swarm: SwarmClient, thumbnail: string | undefined): string | null {
  return typeof thumbnail === 'string' && thumbnail.trim() !== ''
    ? swarm.reader('previews').urlFor(thumbnail, 'thumbnail')
    : null;
}

export function StreamWatcher() {
  const { mediatype, owner, topic } = useParams<{
    mediatype: string;
    owner: string;
    topic: string;
  }>();
  const [searchParams] = useSearchParams();
  const { streamList, isStreamListLoaded, chat, swarm, readNextStreamListSlot } = useAppContext();

  // The ladder lives in the catalog, keyed by the primary feed the browser links to. Current
  // entries name the master, older ones the lowest rung. Waiting for the first catalog read
  // rather than rendering without
  // it keeps a deep link from starting single-rendition and rebuilding a second later.
  const stream = streamList.find((entry) => entry.owner === owner && entry.topic === topic);

  // Above the early return, because a hook may not be skipped on some renders.
  const isWaiting = useIsWaitingForStart(`${owner}/${topic}`, stream);
  const view = watchPageView(isStreamListLoaded, stream, isWaiting);
  useCatalogPoll(watchPageCatalogPollMs(view));

  const streamKey = `${owner}/${topic}`;

  const back = (
    <Link className="watch-back" to={ROUTES.STREAM_BROWSER}>
      <span aria-hidden="true">←</span> Back
    </Link>
  );

  if (!mediatype || !owner || !topic || !isMediaType(mediatype)) {
    return (
      <WatchLayout
        back={back}
        stage={
          <WatchNotice>
            <p className="watch-notice-title">This link does not name a stream.</p>
          </WatchNotice>
        }
      />
    );
  }

  const enableQoeOverlay = searchParams.get('qoe') === '1';
  // ?level=<rung name> pins playback to one rung, ?level=auto hands the choice to ABR. The route
  // carries no ladder of its own, so the rung names come from the catalog entry below.
  const level = searchParams.get('level') ?? undefined;

  // Neither message mounts the player. An announced broadcast has no manifest feed under its topic
  // yet, so a player there polls a slot nobody writes and loads for ever. See `watchPageView`.
  const description = stream ? watchPageDescription(stream) : null;

  return (
    <WatchLayout
      back={back}
      stage={
        view === WATCH_VIEW_PLAYER ? (
          <SwarmHlsPlayer
            owner={owner}
            topicString={topic}
            mediaType={mediatype}
            enableQoeOverlay={enableQoeOverlay}
            renditions={playableRenditions(stream)}
            level={level}
            onLadderShort={readNextStreamListSlot}
          />
        ) : (
          <WatchPlaceholder
            view={view}
            scheduledStart={scheduledStartMs(stream?.scheduledStartTime)}
            thumbnailUrl={streamPictureUrl(swarm, stream?.thumbnail)}
          />
        )
      }
      side={chat && <WatchChat key={streamKey} chat={chat} topic={topic} />}
      info={
        stream && (
          <div className="watch-info">
            <h1 className="watch-info-title">{stream.title}</h1>
            {description && <p className="watch-info-description">{description}</p>}
          </div>
        )
      }
    />
  );
}
