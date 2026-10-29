import type { MouseEvent } from 'react';

import { GuestBadgeIcon } from '@/shared/components/Icons/GuestBadgeIcon';
import { OwnStampIcon } from '@/shared/components/Icons/OwnStampIcon';
import { SwarmIdBadgeIcon } from '@/shared/components/Icons/SwarmIdBadgeIcon';

import { hasNonAsciiCharacters, NON_LATIN_NAME_NOTE } from '../../../ens/ensLookup';
import { messageTime } from '../messageTime';
import { badgeLabel, OWN_STAMP_TITLE, ownStampLabel, type SenderBadge } from '../senderBadge';

import './SenderLine.scss';

export function BadgeIcon({ badge }: { badge: SenderBadge }) {
  return badge.isSwarmId ? <SwarmIdBadgeIcon /> : <GuestBadgeIcon />;
}

/** The short form of the details' note, for an ENS name with characters a reader may take for other letters. */
function NonLatinNameMark() {
  return (
    <svg
      className="ens-name-note"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      role="img"
      aria-label={NON_LATIN_NAME_NOTE}
    >
      <title>{NON_LATIN_NAME_NOTE}</title>
      <circle cx="6" cy="6" r="5" fill="none" strokeWidth="1.2" />
      <path d="M6 3.2v3.4M6 8.4v.4" fill="none" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

interface SenderLineProps {
  name: string;
  /** Whether `name` is the sender's verified ENS name, cut with an ellipsis when long and marked when not plain ASCII. */
  isEnsName?: boolean;
  badge: SenderBadge;
  /** Whether the sender paid for the write with a stamp of their own. */
  ownStamp: boolean;
  /** Whether the viewer sent the message, so the stamp is named as the viewer's. */
  sentByViewer: boolean;
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
  sentByViewer,
  timestamp,
  detailsId,
  areDetailsShown,
  onToggleDetails,
}: SenderLineProps) {
  const time = messageTime(timestamp);
  const nameClasses = ['chat-message-name', badge.isSwarmId ? 'linked' : 'guest', isEnsName && 'ens-name']
    .filter(Boolean)
    .join(' ');
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    // The buttons are inside the message, whose own click shows its actions.
    event.stopPropagation();
    onToggleDetails(event.currentTarget);
  };
  return (
    <p className="chat-message-sender">
      <bdi className={nameClasses} title={isEnsName ? name : undefined}>
        {name}
      </bdi>
      {isEnsName && hasNonAsciiCharacters(name) && <NonLatinNameMark />}
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
          aria-label={ownStampLabel(sentByViewer)}
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
