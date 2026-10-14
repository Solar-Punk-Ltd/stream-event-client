import { GuestBadgeIcon } from '@/shared/components/Icons/GuestBadgeIcon';
import { OwnStampIcon } from '@/shared/components/Icons/OwnStampIcon';
import { SwarmIdBadgeIcon } from '@/shared/components/Icons/SwarmIdBadgeIcon';

import { messageTime } from '../messageTime';
import { OWN_STAMP_LABEL, type SenderBadge } from '../senderBadge';

import './SenderLine.scss';

export function BadgeIcon({ badge }: { badge: SenderBadge }) {
  return badge.isSwarmId ? <SwarmIdBadgeIcon /> : <GuestBadgeIcon />;
}

interface SenderLineProps {
  name: string;
  badge: SenderBadge;
  /** Whether the sender paid for the write with a stamp of their own. */
  ownStamp: boolean;
  /** The server's receive time once published, the sender's clock while sending, in milliseconds. */
  timestamp: number;
  /** The id of the details card the badge opens. */
  detailsId: string;
  areDetailsShown: boolean;
  onToggleDetails: () => void;
}

/**
 * The sender's name, badge and the message's time above a message. The badge opens the message's details. The stamp says only that the
 * sender paid for the write, and opens nothing yet.
 */
export function SenderLine({
  name,
  badge,
  ownStamp,
  timestamp,
  detailsId,
  areDetailsShown,
  onToggleDetails,
}: SenderLineProps) {
  return (
    <p className="chat-message-sender">
      <span className={badge.isSwarmId ? 'chat-message-name linked' : 'chat-message-name guest'}>{name}</span>
      <button
        type="button"
        className="sender-badge"
        aria-label={badge.name}
        title={badge.name}
        aria-expanded={areDetailsShown}
        aria-controls={detailsId}
        onClick={(event) => {
          // The badge is inside the message, whose own click shows its actions.
          event.stopPropagation();
          onToggleDetails();
        }}
      >
        <BadgeIcon badge={badge} />
      </button>
      {ownStamp && (
        <span className="sender-stamp" role="img" aria-label={OWN_STAMP_LABEL} title={OWN_STAMP_LABEL}>
          <OwnStampIcon />
        </span>
      )}
      <time className="chat-message-time" dateTime={new Date(timestamp).toISOString()}>
        {messageTime(timestamp)}
      </time>
    </p>
  );
}
