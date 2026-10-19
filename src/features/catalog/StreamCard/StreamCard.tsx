import { startHasPassed } from '@/features/catalog/scheduledStart';
import { StreamPreview } from '@/features/catalog/StreamPreview/StreamPreview';
import type { Stream } from '@/features/catalog/stream';
import { cardDateLabel, streamLabel } from '@/features/catalog/streamLabels';
import { WatchLink } from '@/features/catalog/WatchLink/WatchLink';

import { CardDescription } from './CardDescription';

import './StreamCard.scss';

/** A card in the upcoming or past section: its label and date, the title, the thumbnail, the call to watch, the description. */
export function StreamCard({ stream, now }: { stream: Stream; now: number }) {
  const date = cardDateLabel(stream);

  return (
    <article className="stream-card">
      <div className="stream-card-header">
        <span className="stream-card-label">
          {streamLabel(stream.state, startHasPassed(stream.scheduledStartTime, now))}
        </span>
        {date && <span className="stream-card-date">{date}</span>}
      </div>
      <h3 className="stream-card-title">{stream.title}</h3>
      <div className="stream-card-media">
        <StreamThumbnail stream={stream} />
        <WatchLink stream={stream} />
      </div>
      <CardDescription description={stream.description} />
    </article>
  );
}

/** The thumbnail of a card or featured block, filling its width. */
export function StreamThumbnail({ stream }: { stream: Stream }) {
  return (
    <StreamPreview
      variant="fill"
      owner={stream.owner}
      topic={stream.topic}
      state={stream.state}
      duration={stream.duration}
      mediatype={stream.mediatype}
      title={stream.title}
      index={stream.index}
      renditions={stream.renditions}
      thumbnail={stream.thumbnail}
    />
  );
}
