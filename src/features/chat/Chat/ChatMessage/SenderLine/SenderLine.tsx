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

const ENS_NAME_TICK_LABEL = 'Verified ENS name';

/** The tick after a name that is the sender's ENS name, read both ways on chain, rather than one they chose. */
export function EnsNameTick() {
  return (
    <svg
      className="ens-name-tick"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      role="img"
      aria-label={ENS_NAME_TICK_LABEL}
    >
      <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SenderLineProps {
  name: string;
  /** Whether `name` is the sender's verified ENS name, which a tick then follows. */
  isEnsName?: boolean;
  badge: SenderBadge;
  /** Whether the sender paid for the write with a stamp of their own. */
  ownStamp: boolean;
  /** The server's receive time once published, the sender's clock while sending, in milliseconds. */
  timestamp: number;
  /** The id of the details card the badge opens. */
  detailsId: string;
  areDetailsShown: boolean;
  /** Called with the button pressed, which gets focus back when the details close. */
  onToggleDetails: (opener: HTMLButtonElement) => void;
}

/**
 * The sender's name, badge and the message's time above a message. The badge, and the stamp of a sender who paid
 * with their own, both open the message's details.
 */
export function SenderLine({
  name,
  isEnsName = false,
  badge,
  ownStamp,
  timestamp,
  detailsId,
  areDetailsShown,
  onToggleDetails,
}: SenderLineProps) {
  const time = messageTime(timestamp);
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    // The buttons are inside the message, whose own click shows its actions.
    event.stopPropagation();
    onToggleDetails(event.currentTarget);
  };
  return (
    <p className="chat-message-sender">
      <span className={badge.isSwarmId ? 'chat-message-name linked' : 'chat-message-name guest'}>{name}</span>
      {isEnsName && <EnsNameTick />}
      <button
        type="button"
        className="sender-badge"
        aria-label={badgeLabel(badge)}
        title={badge.name}
        aria-expanded={areDetailsShown}
        aria-controls={areDetailsShown ? detailsId : undefined}
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
          aria-controls={areDetailsShown ? detailsId : undefined}
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
