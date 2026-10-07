import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { Dialog } from '@/shared/components/Dialog/Dialog';
import { BUILD_LABEL } from '@/shared/buildLabel';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import {
  choiceForAddress,
  gatewayName,
  type GatewaySetting,
  OWN_GATEWAY_ID,
  type SwarmSettings,
} from '@/swarm/settings';

import {
  checkOwnNodeAddress,
  describeProbeFailure,
  onlyGateway,
  OWN_NODE_DEFAULT_ADDRESS,
  probeFailureHelp,
  probeGateway,
} from './gatewayProbe';
import { type Help, OWN_NODE_DESCRIPTION } from './checkSentences';
import { isServingFromFallback, statusRows } from './providerStatus';
import { CHECK_LABELS, type CheckResult, testProvider } from './providerTest';
import { reportText, type TestedGateway } from './report';

import './ControlPanel.scss';

const KEY_ENTER = 'Enter';

/** How often the status view and the header's fallback marker read the client's counts again. */
const STATUS_REFRESH_MS = 2_000;

type OwnNodeStatus = { kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; text: string; help?: Help | null };

const IDLE: OwnNodeStatus = { kind: 'idle' };

type GatewayTest = { readonly state: 'running' } | ({ readonly state: 'done' } & TestedGateway);

type CopyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copied' }
  | { readonly kind: 'failed'; readonly report: string };

const NOT_COPIED: CopyState = { kind: 'idle' };

const OUTCOME_WORDS = { passed: 'Passed', failed: 'Failed', skipped: 'Not tested' } as const;

/** Where a gateway is, as a viewer can recognise it: its host, or this site for a path such as `/bee`. */
function whereIs(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'On this site';
  }
}

/** A row's Test button as a screen reader names it, since every row has one. */
function testButtonName(name: string, test: GatewayTest | undefined): string {
  return test?.state === 'running' ? `Testing ${name}` : `Test ${name}`;
}

/** What the header shows beside the panel's button: the gateway's name, or the host of a node of the viewer's own. */
function headerName(settings: SwarmSettings, choice: GatewaySetting): string {
  return choice.id === OWN_GATEWAY_ID ? whereIs(choice.url) : gatewayName(settings, choice.id);
}

/**
 * The control panel: where a viewer chooses which gateway the video, the stream list and the previews
 * load from, tests any of them on this event's real content, sees who answered in the last minute, and
 * copies a report for whoever runs the site.
 *
 * It lists the gateways the deployment offers and one of the viewer's own. A node of their own is
 * checked before it is used, so a wrong port, or a node that refuses this site, is reported here in
 * words rather than later as an empty stream list. The choice is remembered in the browser.
 */
export function ControlPanel() {
  const { swarmSettings: settings, gatewayUrl, setGatewayUrl, swarm, streamList, chat, catalogFeed } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [ownAddress, setOwnAddress] = useState(OWN_NODE_DEFAULT_ADDRESS);
  const [ownStatus, setOwnStatus] = useState<OwnNodeStatus>(IDLE);
  const [tests, setTests] = useState<Record<string, GatewayTest>>({});
  const [lastTested, setLastTested] = useState<TestedGateway | null>(null);
  const [copy, setCopy] = useState<CopyState>(NOT_COPIED);
  const [, setRefreshes] = useState(0);
  // Bumped on every check and on close, so a probe that comes back after the viewer cancelled or
  // retyped cannot save an address they no longer meant.
  const probeGeneration = useRef(0);
  const running = useRef(new Set<AbortController>());
  const inputId = useId();
  const descriptionId = useId();
  const statusId = useId();

  const choice = useMemo(() => choiceForAddress(settings, gatewayUrl), [settings, gatewayUrl]);
  const fallbackId = swarm.activity().find(({ feature }) => feature === 'player')?.fallback ?? null;
  const nameOf = useCallback((id: string) => gatewayName(settings, id), [settings]);

  // Also while closed, because the header button marks the fallback serving from the same counts.
  useEffect(() => {
    const timer = setInterval(() => setRefreshes((count) => count + 1), STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const handleOpen = () => {
    setOwnAddress(choice.id === OWN_GATEWAY_ID ? choice.url : OWN_NODE_DEFAULT_ADDRESS);
    setOwnStatus(IDLE);
    setCopy(NOT_COPIED);
    setIsOpen(true);
  };

  const close = () => {
    probeGeneration.current += 1;
    for (const controller of running.current) {
      controller.abort();
    }
    running.current.clear();
    // A stopped Test never reaches its result, so its row would stay "Testing..." with Test disabled.
    setTests((current) => Object.fromEntries(Object.entries(current).filter(([, test]) => test.state === 'done')));
    setIsOpen(false);
  };

  const runTest = async (rowId: string, gateway: GatewaySetting, name: string) => {
    const controller = new AbortController();
    running.current.add(controller);
    setTests((current) => ({ ...current, [rowId]: { state: 'running' } }));
    const results = await testProvider({
      client: createSwarmClient(onlyGateway(gateway)),
      address: gateway.url,
      catalog: catalogFeed,
      knownStreams: streamList,
      chat,
      isOwnNode: gateway.id === OWN_GATEWAY_ID,
      clockOffsetMs: swarm.clockOffsetMs(),
      signal: controller.signal,
    });
    running.current.delete(controller);
    if (controller.signal.aborted) {
      return;
    }
    const tested: TestedGateway = { name, address: gateway.url, results };
    setTests((current) => ({ ...current, [rowId]: { state: 'done', ...tested } }));
    setLastTested(tested);
    setCopy(NOT_COPIED);
  };

  const testOwnNode = () => {
    const address = checkOwnNodeAddress(ownAddress, settings.beeNodes);
    if (!address.ok) {
      setOwnStatus({ kind: 'error', text: address.text });
      return;
    }
    void runTest(OWN_GATEWAY_ID, { id: OWN_GATEWAY_ID, kind: 'bee-http', url: address.url }, 'Your own node');
  };

  // probeGateway answers every failure as an outcome, so the button calls this without awaiting.
  const checkAndUseOwnNode = async () => {
    if (ownStatus.kind === 'checking') {
      return;
    }
    const address = checkOwnNodeAddress(ownAddress, settings.beeNodes);
    if (!address.ok) {
      setOwnStatus({ kind: 'error', text: address.text });
      return;
    }
    const generation = ++probeGeneration.current;
    setOwnStatus({ kind: 'checking' });
    const outcome = await probeGateway(address.url);
    if (generation !== probeGeneration.current) {
      return;
    }
    if (outcome.kind === 'ok') {
      setGatewayUrl(address.url);
      setOwnStatus(IDLE);
      close();
      return;
    }
    setOwnStatus({
      kind: 'error',
      text: describeProbeFailure(outcome),
      help: probeFailureHelp(outcome, window.location.origin),
    });
  };

  const typeOwnAddress = (value: string) => {
    setOwnAddress(value);
    if (ownStatus.kind !== 'idle') {
      // A result about the previous address must not stand under a new one, and a probe still in
      // flight for it must not land on this one either.
      probeGeneration.current += 1;
      setOwnStatus(IDLE);
    }
  };

  /** The status view's rows, the chat's left out on a site that has no chat. */
  function statusOf() {
    return statusRows(swarm.activity(), swarm.health(), Date.now(), nameOf).filter(
      ({ feature }) => feature !== 'chat' || chat !== null,
    );
  }

  const copyReport = async () => {
    const text = reportText({
      tested: lastTested,
      status: statusOf(),
      build: BUILD_LABEL,
      browser: navigator.userAgent,
      atMs: Date.now(),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopy({ kind: 'copied' });
    } catch {
      setCopy({ kind: 'failed', report: text });
    }
  };

  const isOwnInUse = choice.id === OWN_GATEWAY_ID;
  const status = statusOf();

  return (
    <>
      <button
        type="button"
        className="gateway-button"
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Choose and test where the video loads from"
      >
        <span className="gateway-button-label">Gateway</span>
        <span className="gateway-button-current">{headerName(settings, choice)}</span>
        {isServingFromFallback(swarm.activity(), swarm.health()) && (
          <span className="gateway-button-marker">Using fallback</span>
        )}
      </button>

      {isOpen && (
        <Dialog title="Where the video loads from" onClose={close}>
          <p className="panel-intro">
            The video, the stream list and the previews load from the gateway in use. When it fails, the fallback
            answers in its place. Test a gateway to see what loads from it.
            {chat !== null &&
              " The chat itself reads from the event's chat address, whichever gateway is in use, so the chat feed is checked on your own node only."}
          </p>

          <ul className="panel-gateways" aria-label="Gateways">
            {settings.gateways.map((gateway) => {
              const name = gatewayName(settings, gateway.id);
              const isInUse = choice.id === gateway.id;
              return (
                <li key={gateway.id} className="panel-gateway" data-gateway-row>
                  <GatewayHeading
                    name={name}
                    where={whereIs(gateway.url)}
                    isInUse={isInUse}
                    isFallback={!isInUse && fallbackId === gateway.id}
                  />
                  <div className="panel-gateway-actions">
                    <Button
                      variant={ButtonVariant.SECONDARY}
                      onClick={() => void runTest(gateway.id, gateway, name)}
                      disabled={tests[gateway.id]?.state === 'running'}
                      aria-label={testButtonName(name, tests[gateway.id])}
                    >
                      {tests[gateway.id]?.state === 'running' ? 'Testing...' : 'Test'}
                    </Button>
                    <Button
                      onClick={() => {
                        setGatewayUrl(gateway.url);
                        close();
                      }}
                      disabled={isInUse}
                      aria-label={isInUse ? `${name} is in use` : `Use ${name}`}
                    >
                      {isInUse ? 'In use' : 'Use'}
                    </Button>
                  </div>
                  <TestResults test={tests[gateway.id]} />
                </li>
              );
            })}

            <li className="panel-gateway" data-gateway-row>
              <GatewayHeading
                name="Your own node"
                where={isOwnInUse ? whereIs(choice.url) : 'Not in use'}
                isInUse={isOwnInUse}
                isFallback={false}
              />
              <p className="panel-description" id={descriptionId}>
                {OWN_NODE_DESCRIPTION[settings.beeNodes]}
              </p>
              <label className="panel-input-label" htmlFor={inputId}>
                Address of your own Bee node
              </label>
              <input
                id={inputId}
                className="panel-input"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={ownAddress}
                onChange={(event) => typeOwnAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === KEY_ENTER) {
                    void checkAndUseOwnNode();
                  }
                }}
                placeholder={OWN_NODE_DEFAULT_ADDRESS}
                aria-label="Address of your own Bee node"
                aria-describedby={`${descriptionId} ${statusId}`}
                aria-invalid={ownStatus.kind === 'error'}
              />
              <p id={statusId} className={`panel-status ${ownStatus.kind}`} role="status">
                {ownStatus.kind === 'checking' && 'Checking the node...'}
                {ownStatus.kind === 'error' && ownStatus.text}
              </p>
              {ownStatus.kind === 'error' && ownStatus.help && <HelpSteps help={ownStatus.help} />}
              <div className="panel-gateway-actions">
                <Button
                  variant={ButtonVariant.SECONDARY}
                  onClick={testOwnNode}
                  disabled={tests[OWN_GATEWAY_ID]?.state === 'running'}
                  aria-label={testButtonName('your own node', tests[OWN_GATEWAY_ID])}
                >
                  {tests[OWN_GATEWAY_ID]?.state === 'running' ? 'Testing...' : 'Test'}
                </Button>
                <Button onClick={() => void checkAndUseOwnNode()} disabled={ownStatus.kind === 'checking'}>
                  {ownStatus.kind === 'checking' ? 'Checking...' : 'Check and use'}
                </Button>
              </div>
              <TestResults test={tests[OWN_GATEWAY_ID]} />
            </li>
          </ul>

          <section className="panel-section" aria-label="Status">
            <h3 className="panel-section-title">Who answered in the last minute</h3>
            <dl className="panel-status-rows">
              {status.map((row) => (
                <div key={row.feature} className="panel-status-row">
                  <dt>{row.label}</dt>
                  <dd>
                    {row.route} {row.answered}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="panel-section" aria-label="Report">
            <p className="panel-description">
              The report holds the last test, this status, the build and the browser, and no address but the tested
              gateway&apos;s. Paste it to whoever runs this site.
            </p>
            <div className="panel-gateway-actions">
              <Button variant={ButtonVariant.SECONDARY} onClick={() => void copyReport()}>
                Copy report
              </Button>
            </div>
            <p className="panel-status" role="status">
              {copy.kind === 'copied' && 'Report copied.'}
              {copy.kind === 'failed' && 'This browser did not let the page copy. Select the report below and copy it.'}
            </p>
            {copy.kind === 'failed' && (
              <textarea className="panel-report" readOnly value={copy.report} aria-label="Report" rows={8} />
            )}
          </section>
        </Dialog>
      )}
    </>
  );
}

interface GatewayHeadingProps {
  name: string;
  where: string;
  isInUse: boolean;
  isFallback: boolean;
}

function GatewayHeading({ name, where, isInUse, isFallback }: GatewayHeadingProps) {
  return (
    <div className="panel-gateway-heading">
      <h3 className="panel-gateway-name">{name}</h3>
      {isInUse && <span className="panel-badge in-use">In use</span>}
      {isFallback && <span className="panel-badge">Fallback</span>}
      <span className="panel-gateway-where">{where}</span>
    </div>
  );
}

function TestResults({ test }: { test: GatewayTest | undefined }) {
  if (test === undefined) {
    return null;
  }
  if (test.state === 'running') {
    return (
      <p className="panel-status" role="status">
        Testing every feature...
      </p>
    );
  }
  return (
    <ul className="panel-results" aria-label={`Test of ${test.name}`}>
      {test.results.map((result: CheckResult) => (
        <li key={result.check} className={`panel-result ${result.outcome}`}>
          <span className="panel-result-name">
            {CHECK_LABELS[result.check]}: {OUTCOME_WORDS[result.outcome]}
          </span>
          <span className="panel-result-sentence">{result.sentence}</span>
          {result.help && <HelpSteps help={result.help} />}
        </li>
      ))}
    </ul>
  );
}

/** The steps of a fix that takes more than one sentence, with any text to copy set apart as code. */
function HelpSteps({ help }: { help: Help }) {
  return (
    <div className="panel-help">
      <p>{help.intro}</p>
      <ul className="panel-help-steps">
        {help.steps.map((step) => (
          <li key={step.label}>
            <span className="panel-help-label">{step.label}</span>{' '}
            {step.code !== undefined && <code className="panel-help-code">{step.code}</code>}
            {step.text}
          </li>
        ))}
      </ul>
      <p>{help.note}</p>
    </div>
  );
}
