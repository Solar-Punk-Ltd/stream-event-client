import { Link } from 'react-router';

import { type Stream, STREAM_STATUS_LIVE } from '@/features/catalog/stream';
import { callToAction } from '@/features/catalog/streamLabels';
import { watchPath } from '@/features/catalog/watchPath';
import { LinkIcon } from '@/shared/components/LinkIcon/LinkIcon';

import swarmMarkUrl from '@/design/assets/swarm-mark.svg';

import './WatchLink.scss';

/**
 * The outlined call to open a stream under its thumbnail, filled in orange while the stream is live. It
 * carries the Swarm mark, so it reads as the Swarm way to watch beside a stream's links to other places.
 */
export function WatchLink({ stream }: { stream: Pick<Stream, 'mediatype' | 'owner' | 'topic' | 'state'> }) {
  const isLive = stream.state === STREAM_STATUS_LIVE;

  return (
    <Link className={`watch-link${isLive ? ' live' : ''}`} to={watchPath(stream)}>
      <LinkIcon url={swarmMarkUrl} />
      {callToAction(stream.state)}
    </Link>
  );
}
