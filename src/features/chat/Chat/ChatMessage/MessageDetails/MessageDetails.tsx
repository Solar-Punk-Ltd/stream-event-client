import { useState } from 'react';

import type { ChatIdentity } from '@solarpunkltd/swarm-chat-js';

import { ShortAddress } from '@/shared/components/Address/ShortAddress';

import { OWN_STAMP_TITLE, type SenderBadge } from '../senderBadge';
import { OwnCopies } from '../OwnCopies/OwnCopies';
import { BadgeIcon } from '../SenderLine/SenderLine';

import './MessageDetails.scss';

const SENT_BY_GATEWAY = 'Event gateway';
const SHOW_SIGNATURE = 'Signature checked, show it';
const PUBLIC_ADDRESS_LABEL = 'public address';
const SIGNATURE_LABEL = 'signature';
const ACCOUNT_LABEL = 'Swarm ID account';

/**
 * The check mark of a signature that matches the text, which a press turns into the signature itself. The mark carries
 * the success colour, which on the Swarm theme measures 3.4:1, enough for a mark.
 */
function SignatureCheck({ signature }: { signature: string }) {
  const [isShown, setIsShown] = useState(false);
  return (
    <dd className="message-details-signature">
      <button
        type="button"
        className="message-details-check-button"
        aria-label={SHOW_SIGNATURE}
        aria-expanded={isShown}
        onClick={() => setIsShown((shown) => !shown)}
      >
        <svg className="message-details-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isShown && <ShortAddress value={signature} label={SIGNATURE_LABEL} />}
    </dd>
  );
}

interface MessageDetailsProps {
  id: string;
  name: string;
  /** The sender's chat address, 40 hex digits without 0x, as the message carries it. */
  address: string;
  /** The signature the check matched to the text, as the message carries it. */
  signature: string;
  badge: SenderBadge;
  identity: ChatIdentity | null;
  ownStamp: boolean;
  /** Whether the message says its sender keeps a copy in their own feed, which the details then read. */
  hasOwnCopy: boolean;
  onClose: () => void;
}

/** What the check of one message found: who signed it, whether Swarm ID vouched for them, and who paid to send it. */
export function MessageDetails({
  id,
  name,
  address,
  signature,
  badge,
  identity,
  ownStamp,
  hasOwnCopy,
  onClose,
}: MessageDetailsProps) {
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
          <b>{name}</b>
          <BadgeIcon badge={badge} />
        </span>
        <button type="button" className="message-details-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="message-details-list">
        <dt>Identity</dt>
        <dd>{badge.name}</dd>
        <dt>Public address</dt>
        <dd>
          <ShortAddress value={address} label={PUBLIC_ADDRESS_LABEL} />
        </dd>
        <dt>Signature</dt>
        <SignatureCheck signature={signature} />
        {identity && (
          <>
            <dt>Swarm ID account</dt>
            <dd>
              <ShortAddress value={identity.account} label={ACCOUNT_LABEL} />
            </dd>
          </>
        )}
        <dt>Sent</dt>
        <dd>{ownStamp ? OWN_STAMP_TITLE : SENT_BY_GATEWAY}</dd>
      </dl>
      {hasOwnCopy && <OwnCopies owner={address} />}
    </div>
  );
}
