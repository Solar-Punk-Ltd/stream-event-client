import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';
import { useId } from 'react';

import {
  SITE_STAMP_NONE,
  SITE_STAMP_READ,
  SITE_STAMP_READING,
  SITE_STAMP_UNREADABLE,
  useChatStamp,
} from '@/features/chat/stamp/ChatStamp';
import { daysLeftText, SITE_STAMP_RAN_OUT, type SiteStamp } from '@/features/chat/stamp/siteStamp';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { OwnStampIcon } from '@/shared/components/Icons/OwnStampIcon';

const SIGN_IN_FIRST = 'Sign in with Swarm ID first.';
const CHANGE_STAMP = 'Change stamp in Swarm ID';
const CHOOSE_STAMP = 'Choose a stamp in Swarm ID';
const UNNAMED_STAMP = 'Stamp for this site';

/**
 * Who pays for the viewer's chat messages, between ID and Swarm access in Connect. The gateway pays by default, and
 * once signed in with Swarm ID the viewer may pick the stamp Swarm ID gives this site, which the chat's source must be
 * able to send. Choosing and managing that stamp happen in Swarm ID, and the viewer only shows how it stands.
 */
export function ChatStampSection() {
  const { canUseOwnStamp, choice, choosePayWith, route } = useChatStamp();
  const name = useId();
  const ownStampPays = choice.payWith === MessageVia.OWN_STAMP;
  const canPickOwnStamp = canUseOwnStamp && (route.ok || ownStampPays);
  const ownStampLine = !canUseOwnStamp
    ? SIGN_IN_FIRST
    : route.ok
      ? "The stamp Swarm ID gives this site. Your messages go out through your own Bee node, without the event's gateway deciding."
      : `${route.reason} ${route.hint}`;

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
  const { siteStamp, openStampInSwarmId, choice, chooseOwnFeed } = useChatStamp();
  return (
    <>
      <div className="connect-box connect-site-stamp">
        {siteStamp.status === SITE_STAMP_READ && <StampFigures stamp={siteStamp.stamp} />}
        {siteStamp.status === SITE_STAMP_READING && <p className="connect-hint">Reading your stamp from Swarm ID…</p>}
        {siteStamp.status === SITE_STAMP_UNREADABLE && (
          <p className="connect-hint">Swarm ID did not say how your stamp stands. It is read again shortly.</p>
        )}
        {siteStamp.status === SITE_STAMP_NONE && (
          <p className="connect-hint">Swarm ID has given this site no stamp yet.</p>
        )}
        {openStampInSwarmId && (
          <div className="connect-between">
            <span className="connect-ex">Chosen, topped up and made bigger in Swarm ID</span>
            <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={openStampInSwarmId}>
              {siteStamp.status === SITE_STAMP_NONE ? CHOOSE_STAMP : CHANGE_STAMP}
            </Button>
          </div>
        )}
      </div>
      <label className="connect-choice">
        <input type="checkbox" checked={choice.ownFeed} onChange={(event) => chooseOwnFeed(event.target.checked)} />
        <span>
          Also write my own feed
          <small>
            Every message you send is also saved to a feed only you can write. Anyone can compare it with the chat, so
            your messages stay checkable even if the chat leaves one out. Uses about twice the stamp.
          </small>
        </span>
      </label>
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
