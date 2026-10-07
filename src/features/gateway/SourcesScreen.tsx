import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { Button } from '@/shared/components/Button/Button';
import { Dialog } from '@/shared/components/Dialog/Dialog';
import { BUILD_LABEL } from '@/shared/buildLabel';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { chooseSource, CHAT_SERVICE_ID, ROUTING_MODES, type RoutingMode, setMode } from '@/swarm/routing';
import { gatewaySettingOf, type Source, SOURCE_TYPES, sourceName, type SourceType } from '@/swarm/sources';

import { type AddCheck, AddSource } from './AddSource';
import { FallbackOrder } from './FallbackOrder';
import { describeProbeFailure, onlyGateway, probeFailureHelp, probeGateway } from './gatewayProbe';
import { PartRoutes } from './PartRoutes';
import { isServingFromFallback, statusRows } from './providerStatus';
import { type CheckResult, testProvider } from './providerTest';
import { reportText, type TestedGateway } from './report';
import { type SourceTest, SourceRow } from './SourceRow';
import { CHAT_SERVICE_NAME, TYPE_GROUP_LABELS } from './sourceWords';
import { useSourceStatuses } from './useSourceStatuses';

import './SourcesScreen.scss';

/** How often the header's fallback marker reads the client's counts again. */
const STATUS_REFRESH_MS = 2_000;

const MODE_LABELS: Readonly<Record<RoutingMode, string>> = { one: 'One source', 'per-part': 'Per part' };

type CopyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copied' }
  | { readonly kind: 'failed'; readonly report: string };

const NOT_COPIED: CopyState = { kind: 'idle' };

/** The name a source goes by in the header and the report, the chat's service included. */
function nameIn(sources: readonly Source[], id: string): string {
  return id === CHAT_SERVICE_ID ? CHAT_SERVICE_NAME : sourceName(sources, id);
}

/**
 * The Sources screen: where a viewer picks what the video, the stream list, the previews and the chat
 * read from, sees each source's state at a glance, adds gateways and Bee nodes of their own, orders the
 * fallbacks, and copies diagnostics for whoever runs the site. Every change applies at once and is
 * remembered in the browser.
 */
export function SourcesScreen() {
  const app = useAppContext();
  const { swarmSettings: settings, sources, routing, parts, fallbackOrder, swarm, chat, catalogFeed } = app;
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, SourceTest>>({});
  const [lastTested, setLastTested] = useState<TestedGateway | null>(null);
  const [copy, setCopy] = useState<CopyState>(NOT_COPIED);
  const [, setRefreshes] = useState(0);
  const running = useRef(new Set<AbortController>());
  const radioName = useId();
  const { statuses, recheck } = useSourceStatuses(sources, isOpen, catalogFeed);
  const nameOf = useCallback((id: string) => nameIn(sources, id), [sources]);

  // Also while closed, because the header button marks the fallback serving from the same counts.
  useEffect(() => {
    const timer = setInterval(() => setRefreshes((count) => count + 1), STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const runTest = useCallback(
    async (source: Source): Promise<readonly CheckResult[] | null> => {
      const controller = new AbortController();
      running.current.add(controller);
      setTests((current) => ({ ...current, [source.id]: { state: 'running' } }));
      const results = await testProvider({
        client: createSwarmClient(onlyGateway(gatewaySettingOf(source))),
        address: source.url,
        catalog: catalogFeed,
        knownStreams: app.streamList,
        chat,
        isOwnNode: source.type === 'bee-node',
        clockOffsetMs: swarm.clockOffsetMs(),
        signal: controller.signal,
      });
      running.current.delete(controller);
      if (controller.signal.aborted) {
        return null;
      }
      setTests((current) => ({ ...current, [source.id]: { state: 'done', results } }));
      setLastTested({ name: source.name, address: source.url, results });
      setCopy(NOT_COPIED);
      return results;
    },
    [app.streamList, catalogFeed, chat, swarm],
  );

  const close = () => {
    for (const controller of running.current) {
      controller.abort();
    }
    running.current.clear();
    // A stopped Test never reaches its result, so its row would stay testing with Retest disabled.
    setTests((current) => Object.fromEntries(Object.entries(current).filter(([, test]) => test.state === 'done')));
    setExpandedId(null);
    setIsOpen(false);
  };

  const toggle = (source: Source) => {
    const opening = expandedId !== source.id;
    setExpandedId(opening ? source.id : null);
    if (opening && tests[source.id] === undefined) {
      void runTest(source);
    }
  };

  const retest = (source: Source) => {
    recheck(source.id);
    void runTest(source);
  };

  /** A Bee node is asked the node picker's probe, a gateway the Test, whose connection must pass. */
  const checkNew = async (type: SourceType, url: string): Promise<AddCheck> => {
    if (type === 'bee-node') {
      const outcome = await probeGateway(url);
      return outcome.kind === 'ok'
        ? { ok: true }
        : {
            ok: false,
            text: describeProbeFailure(outcome),
            help: probeFailureHelp(outcome, window.location.origin),
          };
    }
    const results = await runTest({ id: 'adding', type, name: 'New gateway', url, offered: false });
    const connection = results?.find(({ check }) => check === 'connection');
    if (connection === undefined) {
      return { ok: false, text: 'The check was stopped before it finished.', help: null };
    }
    return connection.outcome === 'passed'
      ? { ok: true, results: results ?? undefined }
      : { ok: false, text: connection.sentence, help: connection.help ?? null };
  };

  const add = (source: { type: SourceType; name: string; url: string }, results?: readonly CheckResult[]) => {
    const id = app.addSource(source);
    setTests(({ adding: _checked, ...current }) =>
      results ? { ...current, [id]: { state: 'done', results } } : current,
    );
    if (routing.mode === 'one') {
      app.setRouting(chooseSource(routing, id));
    }
  };

  const copyDiagnostics = async () => {
    const text = reportText({
      tested: lastTested,
      status: statusRows(swarm.activity(), swarm.health(), Date.now(), nameOf).filter(
        ({ feature }) => feature !== 'chat' || chat !== null,
      ),
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

  const inUseId = parts.player;
  const headerName = routing.mode === 'per-part' ? 'Per part' : nameOf(inUseId);

  return (
    <>
      <button
        type="button"
        className="sources-button"
        onClick={() => {
          setCopy(NOT_COPIED);
          setIsOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Choose where the video loads from"
      >
        <span className="sources-button-label">Sources</span>
        <span className="sources-button-current">{headerName}</span>
        {isServingFromFallback(swarm.activity(), swarm.health()) && (
          <span className="sources-button-marker">Using fallback</span>
        )}
      </button>

      {isOpen && (
        <Dialog title="Sources" onClose={close} closeLabel="Close sources">
          <div className="sources-modes" role="radiogroup" aria-label="Routing">
            {ROUTING_MODES.map((mode) => (
              <label key={mode} className={`sources-mode${routing.mode === mode ? ' picked' : ''}`}>
                <input
                  type="radio"
                  name={`${radioName}-mode`}
                  checked={routing.mode === mode}
                  onChange={() => app.setRouting(setMode(routing, mode))}
                />
                {MODE_LABELS[mode]}
              </label>
            ))}
          </div>

          {routing.mode === 'one' ? (
            SOURCE_TYPES.filter((type) => sources.some((source) => source.type === type)).map((type) => (
              <section key={type} className="sources-group" aria-label={TYPE_GROUP_LABELS[type]}>
                <h3 className="sources-group-title">{TYPE_GROUP_LABELS[type]}</h3>
                <ul className="sources-list">
                  {sources
                    .filter((source) => source.type === type)
                    .map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        isInUse={source.id === inUseId}
                        radioName={radioName}
                        status={statuses[source.id]}
                        test={tests[source.id]}
                        isExpanded={expandedId === source.id}
                        onToggle={() => toggle(source)}
                        onUse={() => app.setRouting(chooseSource(routing, source.id))}
                        onRetest={() => retest(source)}
                        onRename={(name) => app.renameSource(source.id, name)}
                        onRemove={() => {
                          setExpandedId(null);
                          app.removeSource(source.id);
                        }}
                      />
                    ))}
                </ul>
              </section>
            ))
          ) : (
            <PartRoutes
              sources={sources}
              routing={routing}
              parts={parts}
              statuses={statuses}
              hasChat={chat !== null}
              onChange={app.setRouting}
            />
          )}

          <AddSource access={settings.beeNodes} kinds={settings.kinds} check={checkNew} onAdd={add} />

          <FallbackOrder
            order={fallbackOrder}
            nameOf={nameOf}
            inUseId={routing.mode === 'one' ? inUseId : null}
            onChange={app.setFallbackOrder}
          />

          <div className="sources-footer">
            <button type="button" className="sources-text-button" onClick={() => void copyDiagnostics()}>
              Copy diagnostics
            </button>
            <Button onClick={close}>Done</Button>
          </div>
          <p className="sources-message" role="status">
            {copy.kind === 'copied' && 'Diagnostics copied'}
            {copy.kind === 'failed' && 'Copy the diagnostics below'}
          </p>
          {copy.kind === 'failed' && (
            <textarea
              className="sources-input sources-report"
              readOnly
              value={copy.report}
              aria-label="Diagnostics"
              rows={8}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
