import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';

import { SITE_STAMP_NONE, useChatStamp } from '@/features/chat/stamp/ChatStamp';
import { SwarmIdButton } from '@/features/chat/swarmId/SwarmIdParts';
import { SWARM_ID_BUTTON_COMPACT } from '@/features/chat/swarmId/swarmIdButtonLook';
import { useConnect } from '@/features/connect/ConnectContext';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { OPEN_MY_SWARM } from '@/shared/mySwarmPanel';

import './StampWarningBar.scss';

/**
 * The line above the message field while the viewer's own stamp pays and something about it holds sending: the
 * chat's source cannot send on it, Swarm ID gives this site no stamp, it ran out, or it is not usable yet. Every way
 * out is a button the viewer presses. Nothing here moves a message to the gateway by itself.
 */
export function StampWarningBar() {
  const { warning, route, siteStamp, canUseOwnStamp, choosePayWith } = useChatStamp();
  const { open: openConnect } = useConnect();
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
        {!route.ok ? (
          <Button variant={ButtonVariant.SECONDARY} className="stamp-warning-button" onClick={openConnect}>
            {OPEN_MY_SWARM}
          </Button>
        ) : (
          canUseOwnStamp && (
            <SwarmIdButton
              action="change-stamp"
              text={siteStamp.status === SITE_STAMP_NONE ? 'Choose a stamp in Swarm ID' : 'Change stamp in Swarm ID'}
              variant={warning.blocksSending ? ButtonVariant.PRIMARY : ButtonVariant.SECONDARY}
              size={SWARM_ID_BUTTON_COMPACT}
            />
          )
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
