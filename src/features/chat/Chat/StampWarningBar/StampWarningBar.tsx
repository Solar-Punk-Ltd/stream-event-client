import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';

import { SITE_STAMP_NONE, useChatStamp } from '@/features/chat/stamp/ChatStamp';
import { SwarmIdButton } from '@/features/chat/swarmId/SwarmIdParts';
import { SWARM_ID_BUTTON_COMPACT } from '@/features/chat/swarmId/swarmIdButtonLook';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';

import './StampWarningBar.scss';

/**
 * The line above the message field while the viewer's own stamp pays and something about it holds sending. With no
 * Bee node and no Weeb3 in the viewer's list it is one plain line saying what to add. Otherwise it is a bar: Swarm ID
 * gives this site no stamp, it ran out, or it is not usable yet, and every way out is a button the viewer presses.
 * Nothing here moves a message to the gateway by itself.
 */
export function StampWarningBar() {
  const { warning, noRouteLine, siteStamp, canUseOwnStamp, choosePayWith } = useChatStamp();
  if (noRouteLine) {
    return (
      <p className="stamp-no-route" role="status">
        {noRouteLine}
      </p>
    );
  }
  if (!warning) {
    return null;
  }
  return (
    <div className={warning.blocksSending ? 'stamp-warning out' : 'stamp-warning'}>
      {/* Only the words are a live region, since Swarm ID's button among the actions says its own news. */}
      <span role="status">
        <strong>{warning.title}</strong> {warning.detail}
      </span>
      <div className="stamp-warning-actions">
        {canUseOwnStamp && (
          <SwarmIdButton
            action="change-stamp"
            text={siteStamp.status === SITE_STAMP_NONE ? 'Choose a stamp in Swarm ID' : 'Change stamp in Swarm ID'}
            variant={warning.blocksSending ? ButtonVariant.PRIMARY : ButtonVariant.SECONDARY}
            size={SWARM_ID_BUTTON_COMPACT}
          />
        )}
        {warning.blocksSending && (
          <Button
            variant={ButtonVariant.SECONDARY}
            className="stamp-warning-button"
            onClick={() => choosePayWith(MessageVia.GATEWAY)}
          >
            Let the gateway pay
          </Button>
        )}
      </div>
    </div>
  );
}
