import type { MouseEvent } from 'react';

import { GuestBadgeIcon } from '@/shared/components/Icons/GuestBadgeIcon';
import { OwnStampIcon } from '@/shared/components/Icons/OwnStampIcon';
import { SwarmIdBadgeIcon } from '@/shared/components/Icons/SwarmIdBadgeIcon';

import { messageTime } from '../messageTime';
import { badgeLabel, OWN_STAMP_LABEL, OWN_STAMP_TITLE, type SenderBadge } from '../senderBadge';

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
 * The sender's name, badge and the message's time above a message. The badge, and the stamp of a sender who paid
 * with their own, both open the message's details.
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
  const time = messageTime(timestamp);
  const toggle = (event: MouseEvent) => {
    // The buttons are inside the message, whose own click shows its actions.
    event.stopPropagation();
    onToggleDetails();
  };
  return (
    <p className="chat-message-sender">
      <span className={badge.isSwarmId ? 'chat-message-name linked' : 'chat-message-name guest'}>{name}</span>
      <button
        type="button"
        className="sender-badge"
        aria-label={badgeLabel(badge)}
        title={badge.name}
        aria-expanded={areDetailsShown}
        aria-controls={detailsId}
        onClick={toggle}
      >
        <BadgeIcon badge={badge} />
      </button>
      {ownStamp && (
        <button
          type="button"
          className="sender-badge"
          aria-label={OWN_STAMP_LABEL}
          title={OWN_STAMP_TITLE}
          aria-expanded={areDetailsShown}
          aria-controls={detailsId}
          onClick={toggle}
        >
          <OwnStampIcon />
        </button>
      )}
      {time && (
        <time className="chat-message-time" dateTime={time.iso}>
          {time.shown}
        </time>
      )}
    </p>
  );
}
