import { useId, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { Dialog } from '@/shared/components/Dialog/Dialog';

import {
  checkOwnNodeAddress,
  describeProbeFailure,
  gatewayLabel,
  isDefaultGateway,
  OWN_NODE_DEFAULT_ADDRESS,
  probeGateway,
} from './gatewayProbe';

import './DomainSelector.scss';

const KEY_ENTER = 'Enter';

type PickerStatus = { kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; text: string };

const IDLE: PickerStatus = { kind: 'idle' };

/** What the header shows while segments come from the browser's own node. */
const BROWSER_NODE_LABEL = 'This browser';

/**
 * The picker a viewer uses to choose where the video loads from: the event gateway, or a Bee node on
 * their own machine.
 *
 * A browser that loaded this page from Swarm offers its own node in place of the second, which is
 * the one node such a page can reach. See `browserNode`.
 *
 * Nothing is saved until the own node has answered a health check, so a wrong port, or a node that
 * refuses this site's origin, is reported here in words rather than reaching the viewer later as a
 * catalog with nothing in it. The event gateway is one click, because a viewer who tried their own
 * node and gave up has no other route back.
 */
export function DomainSelector() {
  const {
    gatewayUrl,
    setGatewayUrl,
    defaultGatewayUrl,
    isBrowserNodeOffered,
    segmentsFromBrowserNode,
    switchToBrowserNode,
  } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(OWN_NODE_DEFAULT_ADDRESS);
  const [status, setStatus] = useState<PickerStatus>(IDLE);
  // Bumped on every confirm and on close, so a probe that comes back after the viewer cancelled or
  // retyped cannot save an address they no longer meant.
  const probeGeneration = useRef(0);
  const inputId = useId();
  const descriptionId = useId();
  const statusId = useId();

  const isOnEventGateway = !segmentsFromBrowserNode && isDefaultGateway(gatewayUrl, defaultGatewayUrl);

  const handleOpen = () => {
    setInputValue(isOnEventGateway ? OWN_NODE_DEFAULT_ADDRESS : gatewayUrl);
    setStatus(IDLE);
    setIsOpen(true);
  };

  const close = () => {
    probeGeneration.current += 1;
    setIsOpen(false);
  };

  // probeGateway answers every failure as an outcome, so the button calls this without awaiting.
  const handleUseOwnNode = async () => {
    if (status.kind === 'checking') {
      return;
    }

    const address = checkOwnNodeAddress(inputValue);
    if (!address.ok) {
      setStatus({ kind: 'error', text: address.text });
      return;
    }

    const generation = ++probeGeneration.current;
    setStatus({ kind: 'checking' });
    const outcome = await probeGateway(address.url);
    if (generation !== probeGeneration.current) {
      return;
    }

    if (outcome.kind === 'ok') {
      setGatewayUrl(address.url);
      close();
      return;
    }
    setStatus({ kind: 'error', text: describeProbeFailure(outcome) });
  };

  const handleUseEventGateway = () => {
    setGatewayUrl(defaultGatewayUrl);
    close();
  };

  const handleUseBrowserNode = () => {
    switchToBrowserNode();
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === KEY_ENTER) {
      void handleUseOwnNode();
    }
  };

  const handleTyping = (value: string) => {
    setInputValue(value);
    if (status.kind !== 'idle') {
      // A result about the previous address must not stand under a new one, and a probe still in
      // flight for it must not land on this one either.
      probeGeneration.current += 1;
      setStatus(IDLE);
    }
  };

  return (
    <>
      <button
        type="button"
        className="gateway-button"
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Choose where the video loads from"
      >
        <span className="gateway-button-label">Bee node</span>
        <span className="gateway-button-current">
          {segmentsFromBrowserNode ? BROWSER_NODE_LABEL : gatewayLabel(gatewayUrl, defaultGatewayUrl)}
        </span>
      </button>

      {isOpen && (
        <Dialog title="Where the video loads from" onClose={close}>
          {isBrowserNodeOffered && (
            <section className="gateway-choice">
              <h3 className="gateway-choice-title">This browser's node</h3>
              <p className="gateway-choice-description">
                The Swarm node this browser runs. The video loads from it, and the list of streams still comes from the
                event gateway.
              </p>
              <Button onClick={handleUseBrowserNode} disabled={segmentsFromBrowserNode}>
                {segmentsFromBrowserNode ? 'In use' : "Use this browser's node"}
              </Button>
            </section>
          )}

          <section className="gateway-choice">
            <h3 className="gateway-choice-title">Event gateway</h3>
            <p className="gateway-choice-description">The Bee node the event runs for every viewer.</p>
            <Button variant={ButtonVariant.SECONDARY} onClick={handleUseEventGateway} disabled={isOnEventGateway}>
              {isOnEventGateway ? 'In use' : 'Use the event gateway'}
            </Button>
          </section>

          {!isBrowserNodeOffered && (
            <section className="gateway-choice">
              <h3 className="gateway-choice-title">My own Bee node</h3>
              <p className="gateway-choice-description" id={descriptionId}>
                A Bee node on this computer, for example Swarm Desktop. Change the port if yours is not 1633.
              </p>
              <label className="gateway-input-label" htmlFor={inputId}>
                Address of your own Bee node
              </label>
              <input
                id={inputId}
                className="gateway-input"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={inputValue}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={OWN_NODE_DEFAULT_ADDRESS}
                aria-describedby={`${descriptionId} ${statusId}`}
                aria-invalid={status.kind === 'error'}
              />
              <p id={statusId} className={`gateway-status ${status.kind}`} role="status">
                {status.kind === 'checking' && 'Checking the node...'}
                {status.kind === 'error' && status.text}
              </p>
              <div className="gateway-actions">
                <Button variant={ButtonVariant.SECONDARY} onClick={close}>
                  Cancel
                </Button>
                <Button onClick={() => void handleUseOwnNode()} disabled={status.kind === 'checking'}>
                  {status.kind === 'checking' ? 'Checking...' : 'Check and use'}
                </Button>
              </div>
            </section>
          )}
        </Dialog>
      )}
    </>
  );
}
