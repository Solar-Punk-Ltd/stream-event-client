import { useState } from 'react';

import type { ChatIdentity } from '@solarpunkltd/swarm-chat-js';

import { ShortAddress } from '@/shared/components/Address/ShortAddress';

import { hasNonAsciiCharacters, NON_LATIN_NAME_NOTE } from '../../../ens/ensLookup';
import { OWN_STAMP_TITLE, type SenderBadge } from '../senderBadge';
import { OwnFeedCheck } from '../OwnFeedCheck/OwnFeedCheck';
import { BadgeIcon } from '../SenderLine/SenderLine';

import './MessageDetails.scss';

const SENT_BY_GATEWAY = 'Event gateway';
const SHOW_SIGNATURE = 'Signature checked, show it';
const PUBLIC_ADDRESS_LABEL = 'public address';
const SIGNATURE_LABEL = 'signature';
const ACCOUNT_LABEL = 'Swarm ID account';
const WALLET_LABEL = 'wallet address';
const ENS_CHECKED_LABEL = 'ENS name checked';

/** The wallet's reverse record names the name and the name's own record names the wallet back. */
function EnsCheckedTick() {
  return (
    <svg
      className="message-details-ens-tick"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      role="img"
      aria-label={ENS_CHECKED_LABEL}
    >
      <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The verified ENS name with what it stands in for, the name the sender chose and the wallet it was read for. A name
 * with characters outside ASCII is said to be one, since such a character can pass for a Latin letter.
 */
function EnsRow({ ensName, chosenName, wallet }: { ensName: string; chosenName: string; wallet: string }) {
  return (
    <>
      <dt>ENS</dt>
      <dd className="message-details-ens">
        <span className="message-details-ens-name">
          <bdi>{ensName}</bdi>
          <EnsCheckedTick />
        </span>
        <span>
          <span className="message-details-ens-label">Chosen name</span> <bdi>{chosenName}</bdi>
        </span>
        <ShortAddress value={wallet} label={WALLET_LABEL} />
        {hasNonAsciiCharacters(ensName) && <span className="message-details-ens-note">{NON_LATIN_NAME_NOTE}</span>}
      </dd>
    </>
  );
}

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
  /** The name the sender chose. */
  name: string;
  /** The sender's verified ENS name, which heads the card in place of `name`. */
  ensName?: string;
  /** The sender's chat address, 40 hex digits without 0x, as the message carries it. */
  address: string;
  /** The signature the check matched to the text, as the message carries it. */
  signature: string;
  badge: SenderBadge;
  identity: ChatIdentity | null;
  /** Whether its sender paid with their own stamp, and so keeps a copy in their own feed, which the details read. */
  ownStamp: boolean;
  onClose: () => void;
}

/** What the check of one message found: who signed it, whether Swarm ID vouched for them, and who paid to send it. */
export function MessageDetails({
  id,
  name,
  ensName,
  address,
  signature,
  badge,
  identity,
  ownStamp,
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
          <b>
            <bdi>{ensName ?? name}</bdi>
          </b>
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
        {ensName !== undefined && identity?.wallet && (
          <EnsRow ensName={ensName} chosenName={name} wallet={identity.wallet} />
        )}
        <dt>Sent</dt>
        <dd>{ownStamp ? OWN_STAMP_TITLE : SENT_BY_GATEWAY}</dd>
      </dl>
      {ownStamp && <OwnFeedCheck sender={address} signature={signature} />}
    </div>
  );
}
