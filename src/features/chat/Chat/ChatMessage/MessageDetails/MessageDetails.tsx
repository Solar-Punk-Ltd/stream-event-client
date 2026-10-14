import type { ChatIdentity } from '@solarpunkltd/swarm-chat-js';

import type { SenderBadge } from '../senderBadge';
import { BadgeIcon } from '../SenderLine/SenderLine';

import './MessageDetails.scss';

const SIGNATURE_MATCHES = 'matches this text';
const ID_LINK_CONFIRMED = 'confirmed by Swarm ID for this site';
const SENT_WITH_OWN_STAMP = 'with their own stamp';
const SENT_BY_GATEWAY = 'by the event gateway';

/**
 * A line the check confirmed. The check mark carries the success colour, which on the Swarm theme measures 3.4:1, enough
 * for a mark and short of the 4.5:1 text needs, so the words stay in the text colour.
 */
function ConfirmedLine({ text }: { text: string }) {
  return (
    <dd className="message-details-ok">
      <svg className="message-details-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {text}
    </dd>
  );
}

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
        <ConfirmedLine text={SIGNATURE_MATCHES} />
        {identity && (
          <>
            <dt>ID link</dt>
            <ConfirmedLine text={ID_LINK_CONFIRMED} />
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
