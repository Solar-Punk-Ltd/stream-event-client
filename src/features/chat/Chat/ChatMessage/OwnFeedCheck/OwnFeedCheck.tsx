import { useRef } from 'react';

import { useClipboardCopy } from '@/shared/components/Address/useClipboardCopy';

import {
  isInOwnFeed,
  ownFeedAddress,
  type OwnFeedComparison,
  type OwnFeedRecord,
} from '../../../stamp/ownFeedComparison';
import {
  CHAT_NOT_READ_YET,
  CHAT_NOT_READ_YET_TEXT,
  CHECKED,
  CHECKING,
  messagesText,
  oneOrMany,
  REFUSED,
  TOO_LARGE,
  UNREADABLE,
  useOwnFeedComparison,
  useOwnFeedSource,
} from '../../../stamp/useOwnFeedComparison';

import '@/shared/components/Address/ShortAddress.scss';
import './OwnFeedCheck.scss';

/** How many messages each list names, newest first. */
const LISTED_MISSING = 5;

/** How many hex digits the short form of the own feed's owner and topic keeps at each end. */
const KEPT_DIGITS = 4;

const VERIFY = 'Verify';
const STOP = 'Stop';
const COPY_LABEL = 'Copy the own feed address';
const BAD_SIGNATURES = 'Signature does not match';
const MISSING_FROM_CHAT = 'Missing from the chat feed';

/** How the check's lines name the own feed it reads, and the address that owns it. */
interface FeedOwnerWords {
  /** Inside a sentence, as in "not in your own feed". */
  readonly ownFeed: string;
  /** At the start of a sentence, as in "Your own feed could not be read." */
  readonly ownFeedFirst: string;
  readonly address: string;
  /** The first line when no own feed is found. */
  readonly noOwnFeed: string;
}

/** Under a message the viewer sent. */
const VIEWER_WORDS: FeedOwnerWords = {
  ownFeed: 'your own feed',
  ownFeedFirst: 'Your own feed',
  address: 'your address',
  noOwnFeed: 'No own feed of yours was found in this chat.',
};

/** Under anyone else's message. */
const SENDER_WORDS: FeedOwnerWords = {
  ownFeed: "the sender's own feed",
  ownFeedFirst: "The sender's own feed",
  address: "the sender's address",
  noOwnFeed: "No own feed of the sender's was found in this chat.",
};

function inChatOnlyLine(count: number, { ownFeed }: FeedOwnerWords): string {
  return `${messagesText(count)} ${oneOrMany(count, 'is', 'are')} in this chat but not in ${ownFeed}`;
}

function inOwnFeedOnlyLine(count: number, { ownFeed }: FeedOwnerWords): string {
  return `${messagesText(count)} ${oneOrMany(count, 'is', 'are')} in ${ownFeed} but not in this chat`;
}

function badSignaturesLine(count: number, { address }: FeedOwnerWords): string {
  const doesNotMatch = oneOrMany(count, 'its signature does not match', 'their signatures do not match');
  return `${messagesText(count)} ${oneOrMany(count, 'carries', 'carry')} ${address}, but ${doesNotMatch}`;
}

const shortHex = (hex: string) => `${hex.slice(0, KEPT_DIGITS)}…${hex.slice(-KEPT_DIGITS)}`;

interface MessageListProps {
  readonly label: string;
  /** The line counting `records`, such as "2 messages are in this chat but not in your own feed". */
  readonly line: (count: number) => string;
  readonly records: readonly OwnFeedRecord[];
}

/** A count of `records` and the newest of them, shown only when there is at least one. */
function MessageList({ label, line, records }: MessageListProps) {
  if (records.length === 0) {
    return null;
  }
  const more = records.length - LISTED_MISSING;
  return (
    <div className="own-feed-missing" aria-label={label} role="group">
      <span>{line(records.length)}</span>
      <ul>
        {records.slice(0, LISTED_MISSING).map(({ index, message }) => (
          <li key={`${index}-${message.sig}`}>{message.text}</li>
        ))}
      </ul>
      {more > 0 && <span className="own-feed-hint">and {more} more</span>}
    </div>
  );
}

/** The own feed's owner and topic, short, with a button that copies both in full as a feed read names them. */
function OwnFeedAddress({ sender, chatTopic }: { readonly sender: string; readonly chatTopic: string }) {
  const { owner, topic } = ownFeedAddress(sender, chatTopic);
  const shown = useRef<HTMLSpanElement>(null);
  const { isCopied, isRefused, copy } = useClipboardCopy(shown);
  const full = `${owner}/${topic}`;
  return (
    <span className="own-feed-address">
      <span>
        Own feed:{' '}
        <span ref={shown} className="own-feed-address-value" title={full}>
          {isRefused ? full : `${shortHex(owner)}/${shortHex(topic)}`}
        </span>
      </span>
      <button type="button" className="short-address-copy" aria-label={COPY_LABEL} onClick={() => copy(full)}>
        {isCopied ? 'Copied' : 'Copy'}
      </button>
      <span className="short-address-status" role="status">
        {isCopied ? 'Copied the own feed address' : ''}
      </span>
    </span>
  );
}

interface ResultProps {
  readonly comparison: OwnFeedComparison;
  readonly signature: string;
  readonly words: FeedOwnerWords;
}

/**
 * Whether this message is in its sender's own feed first, then only what disagrees: the sender's messages in the chat
 * with no copy in their own feed, copies in their own feed the chat does not hold, and messages carrying their address
 * whose signature does not match. A check that found nothing wrong says the first line alone.
 */
function Result({ comparison, signature, words }: ResultProps) {
  return (
    <>
      {comparison.own === null ? (
        <span className="own-feed-this">{words.noOwnFeed}</span>
      ) : (
        <span className="own-feed-this">
          {isInOwnFeed(comparison, signature) ? (
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
              This message is in {words.ownFeed}.
            </>
          ) : (
            `This message is not in ${words.ownFeed}.`
          )}
        </span>
      )}
      <MessageList
        label={`Missing from ${words.ownFeed}`}
        line={(count) => inChatOnlyLine(count, words)}
        records={comparison.missingFromOwnFeed}
      />
      <MessageList
        label={MISSING_FROM_CHAT}
        line={(count) => inOwnFeedOnlyLine(count, words)}
        records={comparison.missingFromChat}
      />
      <MessageList
        label={BAD_SIGNATURES}
        line={(count) => badSignaturesLine(count, words)}
        records={comparison.badSignatures}
      />
    </>
  );
}

interface OwnFeedCheckProps {
  /** The sender's chat address, which owns the own feed the check reads. */
  readonly sender: string;
  readonly signature: string;
  /** Whether the viewer sent the message, so the check names the own feed as the viewer's. */
  readonly sentByViewer: boolean;
}

/**
 * The sender's own feed for this chat, and a check of it against the chat that runs only when asked: the whole chat
 * and the whole own feed, read afresh through the source the viewer picked for the chat history, with how far it has
 * got and a way to stop it. It writes nothing.
 */
export function OwnFeedCheck({ sender, signature, sentByViewer }: OwnFeedCheckProps) {
  const source = useOwnFeedSource();
  const { state, check, stop } = useOwnFeedComparison(source, sender);
  if (!source) {
    return null;
  }
  const words = sentByViewer ? VIEWER_WORDS : SENDER_WORDS;
  return (
    <section className="own-feed-check" aria-label="Own feed">
      <OwnFeedAddress sender={sender} chatTopic={source.chatTopic} />
      {state.status === CHECKING ? (
        <span className="own-feed-progress">
          <span role="status">
            Checked {state.checked} of {state.planned}
          </span>
          <button type="button" className="own-feed-again" onClick={stop}>
            {STOP}
          </button>
        </span>
      ) : (
        <button type="button" className="own-feed-again own-feed-verify" onClick={() => check()}>
          {VERIFY}
        </button>
      )}
      {state.status === CHAT_NOT_READ_YET && <span className="own-feed-hint">{CHAT_NOT_READ_YET_TEXT}</span>}
      {state.status === REFUSED && (
        <span className="own-feed-hint">This source does not serve {words.ownFeed}, so it cannot be checked here.</span>
      )}
      {state.status === UNREADABLE && <span className="own-feed-hint">{words.ownFeedFirst} could not be read.</span>}
      {state.status === TOO_LARGE && <span className="own-feed-hint">{words.ownFeedFirst} is too large to check.</span>}
      {state.status === CHECKED && <Result comparison={state.comparison} signature={signature} words={words} />}
    </section>
  );
}
