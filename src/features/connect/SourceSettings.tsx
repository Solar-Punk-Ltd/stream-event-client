import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { statusRows } from '@/features/gateway/providerStatus';
import { reportText } from '@/features/gateway/report';
import type { StepState } from '@/features/gateway/sourceChecks';
import { type SourceStatus, sourceStatusWords } from '@/features/gateway/sourceStatus';
import { StatusDot } from '@/features/gateway/StatusDot';
import { useNodeInTabStatus } from '@/features/gateway/useNodeInTabStatus';
import { BUILD_LABEL, WEEB3_VERSION } from '@/shared/buildLabel';
import { LOST_WORDS } from '@/shared/nodeInTabStatus';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { hasAddress, SOURCE_NAME_MAX_LENGTH, type Source, sourceName } from '@/swarm/sources';

import { CheckList } from './CheckList';
import { OFFERED_NOTE } from './connectWords';
import { useCheckClient, useSourceChecks } from './useSourceChecks';

const KEY_ENTER = 'Enter';

/** The network the node in this browser joins, which its package's bootnodes are on. */
const WEEB3_NETWORK = 'Swarm mainnet';

type CopyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copied' }
  | { readonly kind: 'failed'; readonly report: string };

interface SourceSettingsProps {
  readonly source: Source;
  readonly status?: SourceStatus;
  /** Told once the source is removed. */
  readonly onRemoved: () => void;
}

/**
 * A source's settings: its name and address, the checks again on asking, and the diagnostics to copy. A source the
 * deployment offers is read only. Removing one moves every part that read from it to the event gateway.
 */
export function SourceSettings({ source, status, onRemoved }: SourceSettingsProps) {
  const app = useAppContext();
  const clientFor = useCheckClient();
  const { results, run } = useSourceChecks();
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' });
  const nameId = useId();
  const addressId = useId();
  // A test of the node in this browser runs it, and it is let go once these settings close.
  const { id, type, url, offered } = source;
  const client = useMemo(() => clientFor({ id, type, url, offered }), [clientFor, id, type, url, offered]);
  const holdsNode = useRef(false);
  useEffect(
    () => () => {
      if (holdsNode.current) {
        void client.stop();
      }
    },
    [client],
  );

  const test = () => {
    if (!hasAddress(source.type)) {
      if (!holdsNode.current) {
        holdsNode.current = true;
        client.start().catch(() => undefined);
      }
      client.restart();
    }
    void run(source, client);
  };

  const copyDiagnostics = async () => {
    const text = reportText({
      tested: results === null ? null : { name: source.name, address: source.url, type: source.type, results },
      status: statusRows(app.swarm.activity(), (id) => sourceName(app.sources, id)).filter(
        ({ feature }) => feature !== 'chat' || app.chat !== null,
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

  const actions = (
    <div className="connect-inline">
      <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={test}>
        Test connection
      </Button>
      <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={() => void copyDiagnostics()}>
        Copy diagnostics
      </Button>
      <span className="connect-muted" role="status">
        {copy.kind === 'copied' && 'Diagnostics copied'}
        {copy.kind === 'failed' && 'Copy the diagnostics below'}
      </span>
    </div>
  );

  return (
    <>
      {source.offered && <p className="connect-hint">{OFFERED_NOTE}</p>}
      {hasAddress(source.type) ? (
        <>
          <div className="connect-parts">
            <div className="connect-part">
              <label htmlFor={nameId}>Name</label>
              <NameField id={nameId} source={source} onRename={(name) => app.renameSource(source.id, name)} />
            </div>
            <div className="connect-part">
              <label htmlFor={addressId}>Address</label>
              <input id={addressId} className="connect-input" type="text" value={source.url} disabled readOnly />
            </div>
          </div>
          {actions}
          {results === null ? (
            <LastAnswer status={status} />
          ) : (
            <CheckList type={source.type} results={results} isAdding={false} />
          )}
        </>
      ) : (
        <div className="connect-box">
          <NodeFacts source={source} />
          {actions}
          {results !== null && (
            <CheckList type={source.type} results={results as readonly StepState[]} isAdding={false} />
          )}
        </div>
      )}
      {copy.kind === 'failed' && (
        <textarea
          className="connect-input connect-report"
          readOnly
          value={copy.report}
          aria-label="Diagnostics"
          rows={8}
        />
      )}
      {!source.offered && (
        <div>
          <Button
            variant={ButtonVariant.SECONDARY}
            className="connect-small connect-danger"
            onClick={() => {
              app.removeSource(source.id);
              onRemoved();
            }}
          >
            Remove
          </Button>
        </div>
      )}
    </>
  );
}

/** A name a viewer changes and keeps on leaving the field or on Enter. An offered source's cannot be changed. */
function NameField({ id, source, onRename }: { id: string; source: Source; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(source.name);
  const keep = () => {
    if (draft !== source.name) {
      onRename(draft);
    }
  };
  return (
    <input
      id={id}
      className="connect-input"
      type="text"
      maxLength={SOURCE_NAME_MAX_LENGTH}
      value={source.offered ? source.name : draft}
      disabled={source.offered}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={keep}
      onKeyDown={(event) => {
        if (event.key === KEY_ENTER) {
          keep();
        }
      }}
    />
  );
}

function LastAnswer({ status }: { status?: SourceStatus }) {
  return (
    <span className="connect-muted connect-inline">
      <StatusDot status={status} withWords={false} />
      {status?.elapsedMs != null
        ? `Last answer ${status.elapsedMs} ms`
        : status
          ? sourceStatusWords(status)
          : 'Checking'}
    </span>
  );
}

/** The node in this browser at a glance: its peers, its network and its build. */
function NodeFacts({ source }: { source: Source }) {
  const status = useNodeInTabStatus(source);
  return (
    <>
      {status.state === 'lost' && (
        <p className="connect-warn" role="status">
          {LOST_WORDS}. Test connection starts it again.
        </p>
      )}
      <dl className="connect-kv">
        <dt>Peers</dt>
        <dd>
          {status.peers ?? 0} of {status.healthyPeers ?? 200}
        </dd>
        <dt>Network</dt>
        <dd>{WEEB3_NETWORK}</dd>
        {WEEB3_VERSION !== null && (
          <>
            <dt>Version</dt>
            <dd>weeb-3 {WEEB3_VERSION}</dd>
          </>
        )}
      </dl>
    </>
  );
}
