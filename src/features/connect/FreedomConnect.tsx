import { useEffect, useState } from 'react';

import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import {
  connectDeclined,
  connectSite,
  type ConnectOutcome,
  isFreedomBrowser,
  type SiteConnection,
  siteConnection,
} from '@/swarm/providers/freedom/freedomSwarm';

import {
  FREEDOM_CONNECT_FAILED_LINE,
  FREEDOM_CONNECT_LINE,
  FREEDOM_CONNECTED_LINE,
  FREEDOM_DECLINED_LINE,
} from './connectWords';

type Shown = SiteConnection | 'asking' | Exclude<ConnectOutcome, 'connected'>;

/**
 * Connect this site, for the Freedom browser's node: what it does and its button. Freedom is asked whether the site is
 * connected with no prompt, and the prompt opens only on the viewer's click. Once they declined, the page does not
 * ask again until it is loaded again, which is when Freedom shows its prompt again.
 */
export function FreedomConnect() {
  const [shown, setShown] = useState<Shown>(() => (connectDeclined() ? 'declined' : 'unknown'));

  useEffect(() => {
    if (connectDeclined()) {
      return;
    }
    let isCurrent = true;
    void siteConnection().then((connection) => {
      if (isCurrent) {
        setShown(connection);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const connect = async () => {
    setShown('asking');
    const outcome = await connectSite();
    setShown(outcome === 'connected' ? 'connected' : outcome);
  };

  if (!isFreedomBrowser()) {
    return null;
  }
  if (shown === 'connected') {
    return <p className="connect-hint">{FREEDOM_CONNECTED_LINE}</p>;
  }
  if (shown === 'declined') {
    return <p className="connect-hint">{FREEDOM_DECLINED_LINE}</p>;
  }
  return (
    <>
      <p className="connect-hint">{FREEDOM_CONNECT_LINE}</p>
      <div className="connect-inline">
        <Button
          variant={ButtonVariant.SECONDARY}
          className="connect-small"
          disabled={shown === 'asking'}
          onClick={() => void connect()}
        >
          Connect this site
        </Button>
        {shown === 'failed' && (
          <span className="connect-muted" role="status">
            {FREEDOM_CONNECT_FAILED_LINE}
          </span>
        )}
      </div>
    </>
  );
}
