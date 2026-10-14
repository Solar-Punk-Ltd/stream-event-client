import { useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { useChatUser } from '@/features/chat/User';
import { useSourceStatuses } from '@/features/gateway/useSourceStatuses';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { Dialog } from '@/shared/components/Dialog/Dialog';
import { GuestBadgeIcon } from '@/shared/components/Icons/GuestBadgeIcon';
import { SwarmIdBadgeIcon } from '@/shared/components/Icons/SwarmIdBadgeIcon';
import type { SwarmClient } from '@/swarm/client';
import type { SourceType } from '@/swarm/sources';

import { AddAddressView, AddTiles, AddWeeb3View } from './AddSourceViews';
import { useConnect } from './ConnectContext';
import { ADD_VIEWS } from './connectWords';
import { IdSection } from './IdSection';
import { SourceSettings } from './SourceSettings';
import { SwarmAccess } from './SwarmAccess';
import { UseFor } from './UseFor';

import './Connect.scss';

type View =
  | { readonly kind: 'menu' }
  | { readonly kind: 'add' }
  | { readonly kind: 'add-source'; readonly type: SourceType }
  | { readonly kind: 'source'; readonly id: string }
  | { readonly kind: 'leave' };

const MENU: View = { kind: 'menu' };

/**
 * Connect, which the header opens: who the viewer is in the chat, every source they can read Swarm through with
 * Add source below, and what each source is used for. Adding a source and a source's settings open in its place,
 * with a way back. Every change applies at once and nothing switches a source by itself.
 */
export function Connect() {
  const app = useAppContext();
  const { chat, sources, routing, parts, catalogFeed } = app;
  const { isOpen, open, close } = useConnect();
  const { session, swarmIdSession, logout } = useChatUser();
  const [view, setView] = useState<View>(MENU);
  // Closing stops the node in this browser a viewer is adding, so Connect asks first rather than stop it unseen.
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const { statuses } = useSourceStatuses(sources, isOpen, catalogFeed);
  // The node in this browser a viewer just added keeps running while Connect stays open, so its row shows its
  // peers. The video holds it too if it reads from it, and the node stops once neither does.
  const addedNode = useRef<SwarmClient | null>(null);
  const chatsAs = chat ? session : null;

  const shownSource = view.kind === 'source' ? (sources.find(({ id }) => id === view.id) ?? null) : null;
  const shown: View = view.kind === 'source' && shownSource === null ? MENU : view;
  const isAddingWeeb3 = shown.kind === 'add-source' && shown.type === 'weeb-3';

  const showView = (next: View) => {
    setIsConfirmingClose(false);
    setView(next);
  };

  const closeConnect = () => {
    if (isAddingWeeb3 && !isConfirmingClose) {
      setIsConfirmingClose(true);
      return;
    }
    setIsConfirmingClose(false);
    void addedNode.current?.stop();
    addedNode.current = null;
    setView(MENU);
    close();
  };

  const title = (() => {
    switch (shown.kind) {
      case 'menu':
        return 'Connect';
      case 'add':
        return 'Add source';
      case 'add-source':
        return ADD_VIEWS[shown.type].title;
      case 'source':
        return shownSource?.name ?? 'Connect';
      case 'leave':
        return 'Leave the chat as a guest?';
    }
  })();

  const back = (() => {
    if (isConfirmingClose) {
      return () => setIsConfirmingClose(false);
    }
    switch (shown.kind) {
      case 'menu':
        return undefined;
      case 'add-source':
        return () => showView({ kind: 'add' });
      default:
        return () => showView(MENU);
    }
  })();

  const viewName = [
    shown.kind,
    shown.kind === 'add-source' ? shown.type : shown.kind === 'source' ? shown.id : '',
    isConfirmingClose ? 'confirming-close' : '',
  ].join(' ');

  return (
    <>
      <button type="button" className="connect-button" aria-haspopup="dialog" aria-expanded={isOpen} onClick={open}>
        {chatsAs ? (
          <>
            <span className="connect-button-name">{chatsAs.username}</span>
            {swarmIdSession ? <SwarmIdBadgeIcon /> : <GuestBadgeIcon />}
          </>
        ) : (
          'Connect'
        )}
      </button>

      {isOpen && (
        <Dialog
          title={title}
          onClose={closeConnect}
          closeLabel="Close Connect"
          onBack={back}
          view={viewName}
          atSide={shown.kind === 'menu'}
        >
          <div className="connect-body">
            {shown.kind === 'menu' && (
              <>
                {chat && (
                  <section className="connect-group" aria-label="ID">
                    <div className="connect-section-label">ID</div>
                    <IdSection onLeave={() => showView({ kind: 'leave' })} />
                  </section>
                )}
                {/* The chat stamp, how a viewer's messages are paid for, sits here, between ID and Swarm access. */}
                <section className="connect-group" aria-label="Swarm access">
                  <div className="connect-section-label">Swarm access</div>
                  <SwarmAccess
                    sources={sources}
                    statuses={statuses}
                    onSettings={(id) => showView({ kind: 'source', id })}
                    onAdd={() => showView({ kind: 'add' })}
                  />
                </section>
                <section className="connect-group" aria-label="Use for">
                  <UseFor
                    sources={sources}
                    routing={routing}
                    parts={parts}
                    hasChat={chat !== null}
                    onChange={app.setRouting}
                  />
                </section>
              </>
            )}
            {shown.kind === 'add' && <AddTiles onPick={(type) => showView({ kind: 'add-source', type })} />}
            {isConfirmingClose && (
              <div className="connect-box" role="alert">
                <p>Closing stops the node in this tab. Weeb3 is not added yet.</p>
                <div className="connect-foot">
                  <Button
                    variant={ButtonVariant.SECONDARY}
                    data-dialog-focus
                    onClick={() => setIsConfirmingClose(false)}
                  >
                    Keep adding
                  </Button>
                  <Button onClick={closeConnect}>Stop and close</Button>
                </div>
              </div>
            )}
            {shown.kind === 'add-source' &&
              (shown.type === 'weeb-3' ? (
                <AddWeeb3View
                  onAdded={(_id, client) => {
                    addedNode.current = client;
                    showView(MENU);
                  }}
                />
              ) : (
                <AddAddressView key={shown.type} type={shown.type} onAdded={() => showView(MENU)} />
              ))}
            {shown.kind === 'source' && shownSource && (
              <SourceSettings
                key={shownSource.id}
                source={shownSource}
                status={statuses[shownSource.id]}
                onRemoved={() => showView(MENU)}
              />
            )}
            {shown.kind === 'leave' && (
              <>
                <p className="connect-hint">
                  If you leave, your display name won&apos;t be saved. You&apos;ll need to choose one again next time.
                </p>
                <div className="connect-foot">
                  <Button variant={ButtonVariant.SECONDARY} onClick={() => showView(MENU)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      logout();
                      showView(MENU);
                    }}
                  >
                    Leave
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
