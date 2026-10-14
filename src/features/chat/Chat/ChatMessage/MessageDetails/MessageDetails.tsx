import type { ChatIdentity } from '@solarpunkltd/swarm-chat-js';

import type { SenderBadge } from '../senderBadge';
import { BadgeIcon } from '../SenderLine/SenderLine';

import './MessageDetails.scss';

const SIGNATURE_MATCHES = 'matches this text';
const ID_LINK_CONFIRMED = 'confirmed by Swarm ID for this site';
const SENT_WITH_OWN_STAMP = 'with their own stamp';
const SENT_BY_GATEWAY = 'by the event gateway';

interface MessageDetailsProps {
  id: string;
  name: string;
  /** The sender's chat address, 40 hex digits without 0x, as the message carries it. */
  address: string;
  badge: SenderBadge;
  identity: ChatIdentity | null;
  ownStamp: boolean;
  onClose: () => void;
}

/** What the check of one message found: who signed it, whether Swarm ID vouched for them, and who paid to send it. */
export function MessageDetails({ id, name, address, badge, identity, ownStamp, onClose }: MessageDetailsProps) {
  return (
    // The card is inside the message, whose own click shows its actions.
    <div
      id={id}
      className="message-details"
      role="region"
      aria-label="Details for this message"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="message-details-header">
        <span className="message-details-title">
          <BadgeIcon badge={badge} />
          <b>{badge.name}</b>
        </span>
        <button type="button" className="message-details-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="message-details-list">
        <dt>Name</dt>
        <dd>{name}</dd>
        <dt>Identity</dt>
        <dd>{badge.line}</dd>
        <dt>Public address</dt>
        <dd className="message-details-address">0x{address}</dd>
        <dt>Signature</dt>
        <dd>{SIGNATURE_MATCHES}</dd>
        {identity && (
          <>
            <dt>ID link</dt>
            <dd>{ID_LINK_CONFIRMED}</dd>
            <dt>Swarm ID account</dt>
            <dd className="message-details-address">{identity.account}</dd>
          </>
        )}
        <dt>Sent</dt>
        <dd>{ownStamp ? SENT_WITH_OWN_STAMP : SENT_BY_GATEWAY}</dd>
      </dl>
    </div>
  );
}
