import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';
import { useId } from 'react';

import {
  SITE_STAMP_NONE,
  SITE_STAMP_READ,
  SITE_STAMP_READING,
  SITE_STAMP_UNREADABLE,
  useChatStamp,
} from '@/features/chat/stamp/ChatStamp';
import { SwarmIdButton } from '@/features/chat/swarmId/SwarmIdParts';
import { SWARM_ID_BUTTON_COMPACT } from '@/features/chat/swarmId/swarmIdButtonLook';
import { daysLeftText, SITE_STAMP_RAN_OUT, type SiteStamp } from '@/features/chat/stamp/siteStamp';
import { ButtonVariant } from '@/shared/components/Button/Button';
import { OwnStampIcon } from '@/shared/components/Icons/OwnStampIcon';

import {
  OWN_FEED_COPY,
  OWN_STAMP_NEEDS_SIGN_IN,
  OWN_STAMP_NEEDS_SIGN_IN_AND_SOURCE,
  OWN_STAMP_NEEDS_SOURCE,
} from './connectWords';
import { OwnFeedSync } from './OwnFeedSync';

const CHANGE_STAMP = 'Change stamp in Swarm ID';
const CHOOSE_STAMP = 'Choose a stamp in Swarm ID';
const UNNAMED_STAMP = 'Stamp for this site';

const SENDS_THROUGH = {
  'bee-node': 'your own Bee node',
  'weeb-3': 'Weeb3, the Swarm node in this browser',
} as const;

/**
 * Who pays for the viewer's chat messages, between ID and Swarm access in Connect. The gateway pays by default, and
 * once signed in with Swarm ID the viewer may pick the stamp Swarm ID gives this site, which needs a Bee node of their
 * own or Weeb3 in their list to send it. Choosing and managing that stamp happen in Swarm ID, and the viewer only shows how it stands.
 */
export function ChatStampSection() {
  const { canUseOwnStamp, choice, choosePayWith, route } = useChatStamp();
  const name = useId();
  const ownStampPays = choice.payWith === MessageVia.OWN_STAMP;
  const canPickOwnStamp = canUseOwnStamp && route.ok;
  const ownStampLine = !canUseOwnStamp
    ? route.ok
      ? OWN_STAMP_NEEDS_SIGN_IN
      : OWN_STAMP_NEEDS_SIGN_IN_AND_SOURCE
    : route.ok
      ? `The stamp Swarm ID gives this site. Your messages go out through ${SENDS_THROUGH[route.through]}, without the event's gateway deciding.`
      : OWN_STAMP_NEEDS_SOURCE;

  return (
    <section className="connect-group" aria-label="Chat stamp">
      <div className="connect-section-label">Chat stamp</div>
      <p className="connect-hint">Every message on Swarm needs a postage stamp.</p>
      <div className="connect-parts">
        <label className="connect-choice">
          <input type="radio" name={name} checked={!ownStampPays} onChange={() => choosePayWith(MessageVia.GATEWAY)} />
          <span>
            Gateway pays
            <small>Free for you. The event&apos;s gateway stamps and sends your message.</small>
          </span>
        </label>
        <label className={canPickOwnStamp ? 'connect-choice' : 'connect-choice off'}>
          <input
            type="radio"
            name={name}
            checked={ownStampPays}
            disabled={!canPickOwnStamp}
            onChange={() => choosePayWith(MessageVia.OWN_STAMP)}
          />
          <span>
            My stamp
            <small>{ownStampLine}</small>
          </span>
        </label>
      </div>
      {ownStampPays && <SiteStampBox />}
    </section>
  );
}

function SiteStampBox() {
  const { siteStamp, canUseOwnStamp } = useChatStamp();
  return (
    <>
      <div className="connect-box connect-site-stamp">
        {siteStamp.status === SITE_STAMP_READ && <StampFigures stamp={siteStamp.stamp} />}
        <OwnFeedSync />
        {siteStamp.status === SITE_STAMP_READING && <p className="connect-hint">Reading your stamp from Swarm ID…</p>}
        {siteStamp.status === SITE_STAMP_UNREADABLE && (
          <p className="connect-hint">Swarm ID did not say how your stamp stands. It is read again shortly.</p>
        )}
        {siteStamp.status === SITE_STAMP_NONE && (
          <p className="connect-hint">
            Swarm ID has given this site no stamp yet. Choose one and confirm it in the Swarm ID window.
          </p>
        )}
        {canUseOwnStamp && (
          <div className="connect-between">
            <span className="connect-ex">Chosen, topped up and made bigger in Swarm ID</span>
            <SwarmIdButton
              action="change-stamp"
              text={siteStamp.status === SITE_STAMP_NONE ? CHOOSE_STAMP : CHANGE_STAMP}
              variant={ButtonVariant.SECONDARY}
              size={SWARM_ID_BUTTON_COMPACT}
            />
          </div>
        )}
        <p className="connect-hint">{OWN_FEED_COPY}</p>
      </div>
    </>
  );
}

function StampFigures({ stamp }: { readonly stamp: SiteStamp }) {
  const ranOut = stamp.state === SITE_STAMP_RAN_OUT;
  const label = stamp.label ?? UNNAMED_STAMP;
  return (
    <>
      <div className="connect-between">
        <span className="connect-inline">
          <OwnStampIcon spent={ranOut} />
          <b>{label}</b>
        </span>
        <span className="connect-ex">
          {ranOut ? 'ran out' : stamp.daysLeft === null ? 'time left unknown' : daysLeftText(stamp.daysLeft)}
        </span>
      </div>
      <div
        className={`connect-progress connect-stamp-meter ${stamp.state}`}
        role="progressbar"
        aria-label={`${label}, used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={stamp.percentUsed}
      >
        <i style={{ width: `${stamp.percentUsed}%` }} />
      </div>
      <span className="connect-ex">
        {stamp.percentUsed}% used · given to this site by Swarm ID, which stamps each message
      </span>
    </>
  );
}
