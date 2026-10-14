import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { ChatReads } from '../../../chatParts';
import { type OwnCopy, readOwnCopies } from '../../../stamp/ownCopies';
import { chatVerifier } from '../../../verify/chatVerifier';

import './OwnCopies.scss';

/** Where the details read a sender's own copies: the chat's reader on the chat history's source, and its topic. */
interface OwnCopiesSource {
  readonly reads: () => Pick<ChatReads, 'readFeedHead' | 'readChunk'>;
  readonly chatTopic: string;
}

const OwnCopiesContext = createContext<OwnCopiesSource | null>(null);

export function OwnCopiesProvider({ source, children }: { source: OwnCopiesSource; children: ReactNode }) {
  return <OwnCopiesContext.Provider value={source}>{children}</OwnCopiesContext.Provider>;
}

const PAGE_SIZE = 10;
const READ_TIMEOUT_MS = 10_000;

type Reading = 'reading' | 'ready' | 'unreadable';

/**
 * The copies a sender kept in their own feed, under a message that says it has one, so a reader can compare them
 * with the chat. Newest first, ten at a time, each checked as every chat message is, and one that fails is not shown.
 * It reads through the source the viewer picked for the chat history, and writes nothing.
 */
export function OwnCopies({ owner }: { readonly owner: string }) {
  const source = useContext(OwnCopiesContext);
  const [copies, setCopies] = useState<readonly OwnCopy[]>([]);
  const [nextIndex, setNextIndex] = useState<number | null>(null);
  const [hidden, setHidden] = useState(0);
  const [reading, setReading] = useState<Reading>('reading');
  const isMounted = useRef(true);

  const readPage = useCallback(
    (from: number | null) => {
      if (!source) {
        return;
      }
      setReading('reading');
      readOwnCopies({
        reads: source.reads,
        verify: chatVerifier(),
        owner,
        chatTopic: source.chatTopic,
        from,
        count: PAGE_SIZE,
        timeoutMs: READ_TIMEOUT_MS,
      }).then(
        (page) => {
          if (!isMounted.current) {
            return;
          }
          setCopies((shown) => (from === null ? page.copies : [...shown, ...page.copies]));
          setNextIndex(page.nextIndex);
          setHidden((count) => (from === null ? page.hidden : count + page.hidden));
          setReading('ready');
        },
        () => {
          if (isMounted.current) {
            setReading('unreadable');
          }
        },
      );
    },
    [source, owner],
  );

  useEffect(() => {
    isMounted.current = true;
    readPage(null);
    return () => {
      isMounted.current = false;
    };
  }, [readPage]);

  if (!source) {
    return null;
  }
  return (
    <section className="own-copies" aria-label="Their own copies" data-hidden-copies={hidden}>
      <b className="own-copies-title">Their own copies</b>
      <span className="own-copies-hint">Their own feed, newest first, {PAGE_SIZE} at a time.</span>
      {copies.length > 0 && (
        <ul className="own-copies-list">
          {copies.map(({ index, message }) => (
            <li key={index}>
              <span className="own-copy-index">#{index}</span>
              <span className="own-copy-text">{message.text}</span>
            </li>
          ))}
        </ul>
      )}
      {reading === 'reading' && <span className="own-copies-hint">Reading their own feed…</span>}
      {reading === 'ready' && copies.length === 0 && (
        <span className="own-copies-hint">No copy could be read from their own feed.</span>
      )}
      {reading === 'unreadable' && (
        <span className="own-copies-hint">
          Their own feed could not be read.{' '}
          <button type="button" className="own-copies-more" onClick={() => readPage(copies.length ? nextIndex : null)}>
            Try again
          </button>
        </span>
      )}
      {reading === 'ready' && nextIndex !== null && (
        <button type="button" className="own-copies-more" onClick={() => readPage(nextIndex)}>
          Load more
        </button>
      )}
    </section>
  );
}
