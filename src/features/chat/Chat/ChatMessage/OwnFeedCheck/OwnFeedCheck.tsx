import { isInOwnFeed, type OwnFeedRecord } from '../../../stamp/ownFeedComparison';
import {
  COUNTED,
  COUNTING,
  messagesText,
  TOO_LARGE,
  UNCOUNTABLE,
  useOwnFeedComparison,
  useOwnFeedSource,
} from '../../../stamp/useOwnFeedComparison';

import './OwnFeedCheck.scss';

/** How many missing messages each side lists, newest first. */
const LISTED_MISSING = 5;

const MISSING_FROM_OWN_FEED = 'Missing from their own feed';
const MISSING_FROM_CHAT = 'Missing from the chat feed';

function MissingList({ label, records }: { readonly label: string; readonly records: readonly OwnFeedRecord[] }) {
  if (records.length === 0) {
    return null;
  }
  const more = records.length - LISTED_MISSING;
  return (
    <div className="own-feed-missing" aria-label={label} role="group">
      <span className="own-feed-hint">{label}</span>
      <ul>
        {records.slice(0, LISTED_MISSING).map(({ index, message }) => (
          <li key={`${index}-${message.sig}`}>{message.text}</li>
        ))}
      </ul>
      {more > 0 && <span className="own-feed-hint">and {more} more</span>}
    </div>
  );
}

/**
 * How the sender's own feed compares with the chat: how many messages each holds, whether this message has its copy,
 * and which messages one side holds and the other does not. It reads the whole chat and the whole own feed through
 * the source the viewer picked for the chat history, and writes nothing.
 */
export function OwnFeedCheck({ sender, signature }: { readonly sender: string; readonly signature: string }) {
  const source = useOwnFeedSource();
  const { count, recount } = useOwnFeedComparison(source, sender);
  if (!source) {
    return null;
  }
  return (
    <section className="own-feed-check" aria-label="Own feed">
      {count.status === COUNTING && <span className="own-feed-hint">Counting…</span>}
      {count.status === UNCOUNTABLE && (
        <span className="own-feed-hint">
          Their own feed could not be counted.{' '}
          <button type="button" className="own-feed-again" onClick={recount}>
            Try again
          </button>
        </span>
      )}
      {count.status === TOO_LARGE && <span className="own-feed-hint">Their own feed is too large to count.</span>}
      {count.status === COUNTED && (
        <>
          {count.comparison.own === null ? (
            <span>No own feed found.</span>
          ) : (
            <>
              <span>Own feed: {messagesText(count.comparison.own.length)}</span>
              <span className="own-feed-this">
                {isInOwnFeed(count.comparison, signature) ? (
                  <>
                    <svg className="own-feed-tick" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M2.5 6.2 5 8.6l4.5-5"
                        fill="none"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    In their own feed
                  </>
                ) : (
                  'Not in their own feed'
                )}
              </span>
            </>
          )}
          <span>Chat feed: {messagesText(count.comparison.chatOnOwnStamp.length)} on their own stamp</span>
          {count.comparison.own !== null && (
            <>
              <MissingList label={MISSING_FROM_OWN_FEED} records={count.comparison.missingFromOwnFeed} />
              <MissingList label={MISSING_FROM_CHAT} records={count.comparison.missingFromChat} />
            </>
          )}
        </>
      )}
    </section>
  );
}
