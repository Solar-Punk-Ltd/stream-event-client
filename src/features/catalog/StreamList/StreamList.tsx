import { useMemo, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { FeaturedStream } from '@/features/catalog/FeaturedStream/FeaturedStream';
import { Pagination } from '@/features/catalog/Pagination/Pagination';
import { StreamCard } from '@/features/catalog/StreamCard/StreamCard';
import { StreamPreview } from '@/features/catalog/StreamPreview/StreamPreview';
import { StreamSearch } from '@/features/catalog/StreamSearch/StreamSearch';
import type { Stream } from '@/features/catalog/stream';
import { BROWSE_CLOCK_TICK_MS, useNow } from '@/features/catalog/useNow';

import { browseSections, displayedStreams } from './displayedStreams';
import { clampPage, pageCount, pageItems, PAST_STREAMS_PER_PAGE } from './pagination';
import { isSearching, searchStreams } from './streamSearch';

import './StreamList.scss';

/**
 * The search box and the streams under it: every live stream and the next upcoming one featured, then
 * the upcoming and past sections as cards, the past ones a page at a time. While a search is typed the
 * matches are one flat list instead, paged the same way, as msrs-client shows them.
 */
export function StreamList() {
  const { streamList } = useAppContext();
  const [query, setQuery] = useState('');
  const [requestedPage, setRequestedPage] = useState(1);
  const now = useNow(BROWSE_CLOCK_TICK_MS);

  const searching = isSearching(query);
  const sections = useMemo(() => browseSections(streamList, now), [streamList, now]);
  const matches = useMemo(
    () => (searching ? searchStreams(displayedStreams(streamList, now), query) : []),
    [searching, streamList, query, now],
  );

  const paged = searching ? matches : sections.past;
  const pages = pageCount(paged.length, PAST_STREAMS_PER_PAGE);
  const page = clampPage(requestedPage, pages);
  const pageStreams = pageItems(paged, page, PAST_STREAMS_PER_PAGE);

  const search = (next: string) => {
    setQuery(next);
    setRequestedPage(1);
  };

  return (
    <div className="stream-list">
      <StreamSearch query={query} onChange={search} />
      <div className="stream-list-content">
        {searching ? (
          <SearchResults query={query} streams={pageStreams} />
        ) : (
          <div className="stream-list-sections">
            {sections.live.map((stream) => (
              <section key={stream.topic} className="stream-section featured live" aria-label="Live now">
                <h2 className="stream-section-title">Live now</h2>
                <FeaturedStream stream={stream} now={now} />
              </section>
            ))}
            {sections.next && (
              <section className="stream-section featured" aria-label="Next stream">
                <FeaturedStream stream={sections.next} now={now} />
              </section>
            )}
            <CardSection title="Upcoming streams" streams={sections.upcoming} now={now} />
            <CardSection title="Past streams" streams={pageStreams} now={now} />
          </div>
        )}
      </div>
      <Pagination page={page} count={pages} onChange={setRequestedPage} />
    </div>
  );
}

function CardSection({ title, streams, now }: { title: string; streams: Stream[]; now: number }) {
  if (streams.length === 0) {
    return null;
  }

  return (
    <section className="stream-section">
      <h2 className="stream-section-title">{title}</h2>
      <ul className="stream-section-grid">
        {streams.map((stream) => (
          <li key={stream.topic}>
            <StreamCard stream={stream} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SearchResults({ query, streams }: { query: string; streams: Stream[] }) {
  if (streams.length === 0) {
    return <p className="stream-list-empty">No streams found matching &quot;{query}&quot;</p>;
  }

  return (
    <ul className="stream-list-results">
      {streams.map((stream) => (
        <li key={stream.topic}>
          <StreamPreview
            variant="compact"
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
        </li>
      ))}
    </ul>
  );
}
