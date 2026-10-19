import type { ReactNode } from 'react';

import type { VisibleMessage } from '../../useSwarmChat';
import { ScrollableMessageList } from '../ScrollableMessageList/ScrollableMessageList';

import './ThreadView.scss';

interface ThreadViewProps {
  /** The message the thread hangs from, rendered by the caller. */
  original: ReactNode;
  replies: VisibleMessage[];
  renderReply: (reply: VisibleMessage, onHeightChange: () => void) => ReactNode;
  /** Whether the viewer wrote this reply, which brings the replies down to it. */
  isOwn: (reply: VisibleMessage) => boolean;
  /** The field to reply with, or the offer to join when the viewer has no name. */
  composer: ReactNode;
  onBack: () => void;
}

export function ThreadView({ original, replies, renderReply, isOwn, composer, onBack }: ThreadViewProps) {
  return (
    <div className="thread-view">
      <div className="thread-header">
        <button type="button" className="thread-back-button" aria-label="Back to the chat" onClick={onBack}>
          <span aria-hidden="true">←</span>
        </button>
        <h3 className="thread-title">Thread</h3>
      </div>

      <ol className="thread-original" aria-label="The message replied to">
        {original}
      </ol>

      {replies.length > 0 ? (
        <ScrollableMessageList items={replies} label="Replies" renderItem={renderReply} isOwn={isOwn} />
      ) : (
        <p className="thread-empty">No replies yet.</p>
      )}

      {composer}
    </div>
  );
}
