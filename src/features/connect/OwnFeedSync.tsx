import { encodeChatMessage } from '@solarpunkltd/swarm-chat-js/message';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type OwnFeedChat, useOwnFeedChat } from '@/features/chat/stamp/OwnFeedChat';
import type { OwnFeedRecord } from '@/features/chat/stamp/ownFeedComparison';
import { COPIED } from '@/features/chat/stamp/ownFeedCopies';
import {
  CHECKED,
  CHECKING,
  messagesText,
  NOT_CHECKED,
  REFUSED,
  TOO_LARGE,
  useOwnFeedComparison,
} from '@/features/chat/stamp/useOwnFeedComparison';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';

const SYNC = 'Sync';
const TRY_AGAIN = 'Try again';
const OWN_FEED_GROUP = 'Own feed in this chat';

const NOT_SYNCED = 'not-synced';
const SYNCING = 'syncing';
const SYNCED = 'synced';
const SYNC_FAILED = 'sync-failed';

type SyncState =
  | { readonly status: typeof NOT_SYNCED }
  | { readonly status: typeof SYNCING; readonly at: number; readonly total: number }
  | { readonly status: typeof SYNCED }
  | { readonly status: typeof SYNC_FAILED; readonly failed: readonly OwnFeedRecord[] };

const IDLE: SyncState = { status: NOT_SYNCED };

/**
 * My messages in the chat on screen against the copies in my own feed, in the My stamp box, with a sync that writes
 * the missing copies with my stamp, one after the other, stopping at the first that fails, and counts again after.
 * Shown only while a chat on my own stamp is on screen, and counted when it shows, each count read afresh.
 */
export function OwnFeedSync() {
  const chat = useOwnFeedChat();
  return chat ? <OwnFeedSyncOf key={`${chat.source.chatTopic}/${chat.sender}`} chat={chat} /> : null;
}

function OwnFeedSyncOf({ chat }: { readonly chat: OwnFeedChat }) {
  const { state: count, check } = useOwnFeedComparison(chat.source, chat.sender);
  const recount = useCallback(() => check(), [check]);
  /** Counts anew behind the count on screen, which stays until the new one is made. */
  const refresh = useCallback(() => check(true), [check]);
  const [sync, setSync] = useState<SyncState>(IDLE);
  const isShown = useRef(true);
  useEffect(() => {
    isShown.current = true;
    return () => {
      isShown.current = false;
    };
  }, []);

  useEffect(recount, [recount]);
  useEffect(() => chat.onSendSettled(refresh), [chat, refresh]);

  const copyAll = useCallback(
    async (records: readonly OwnFeedRecord[]) => {
      let failed: readonly OwnFeedRecord[] = [];
      for (const [at, record] of records.entries()) {
        if (isShown.current) {
          setSync({ status: SYNCING, at: at + 1, total: records.length });
        }
        const outcome = await chat.copy(record.message.id, encodeChatMessage(record.message));
        // A copy given up after its tries keeps its index, so every later copy would wait out the same tries first.
        if (outcome !== COPIED) {
          failed = records.slice(at);
          break;
        }
      }
      if (isShown.current) {
        setSync(failed.length === 0 ? { status: SYNCED } : { status: SYNC_FAILED, failed });
        recount();
      }
    },
    [chat, recount],
  );

  if (count.status === CHECKING || count.status === NOT_CHECKED) {
    return (
      <div className="connect-own-feed" aria-label={OWN_FEED_GROUP} role="group">
        <span className="connect-ex">Counting…</span>
      </div>
    );
  }
  if (count.status === TOO_LARGE) {
    return (
      <div className="connect-own-feed" aria-label={OWN_FEED_GROUP} role="group">
        <span className="connect-ex">Your own feed is too large to count.</span>
      </div>
    );
  }
  if (count.status === REFUSED) {
    return (
      <div className="connect-own-feed" aria-label={OWN_FEED_GROUP} role="group">
        <span className="connect-ex">This source does not serve your own feed, so it cannot be counted here.</span>
      </div>
    );
  }
  if (count.status !== CHECKED) {
    return (
      <div className="connect-own-feed" aria-label={OWN_FEED_GROUP} role="group">
        <span className="connect-ex">Your own feed could not be counted.</span>
        <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={recount}>
          {TRY_AGAIN}
        </Button>
      </div>
    );
  }

  const { chatOnOwnStamp: inChat, missingFromOwnFeed } = count.comparison;
  const notCopied = sync.status === SYNC_FAILED ? sync.failed.length : sync.status === SYNCED ? 0 : null;
  const copied = inChat.length - (notCopied ?? missingFromOwnFeed.length);
  return (
    <div className="connect-own-feed" aria-label={OWN_FEED_GROUP} role="group">
      <span>
        Own feed: {copied} of {messagesText(inChat.length)}
      </span>
      {sync.status === NOT_SYNCED && missingFromOwnFeed.length > 0 && (
        <div className="connect-between">
          <span className="connect-ex">{missingFromOwnFeed.length} missing</span>
          <Button
            variant={ButtonVariant.SECONDARY}
            className="connect-small"
            onClick={() => void copyAll(missingFromOwnFeed)}
          >
            {SYNC}
          </Button>
        </div>
      )}
      {sync.status === SYNCING && (
        <span className="connect-ex" role="status">
          Syncing… {sync.at} of {sync.total}
        </span>
      )}
      {sync.status === SYNCED && (
        <span className="connect-ex" role="status">
          All {inChat.length} copied
        </span>
      )}
      {sync.status === SYNC_FAILED && (
        <div className="connect-between">
          <span className="connect-ex" role="status">
            {sync.failed.length} could not be copied
          </span>
          <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={() => void copyAll(sync.failed)}>
            {TRY_AGAIN}
          </Button>
        </div>
      )}
    </div>
  );
}
