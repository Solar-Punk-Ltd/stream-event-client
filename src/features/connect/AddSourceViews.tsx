import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { checkSourceAddress } from '@/features/gateway/gatewayProbe';
import { checksPassed } from '@/features/gateway/sourceChecks';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { useNodeStatus } from '@/shared/nodeInTabStatus';
import type { SwarmClient } from '@/swarm/client';
import { SOURCE_NAME_MAX_LENGTH, type SourceType } from '@/swarm/sources';

import { CheckList } from './CheckList';
import { ADD_TILES, ADD_VIEWS, ADDRESS_PLACEHOLDERS, ALREADY_ADDED } from './connectWords';
import { useCheckClient, useSourceChecks } from './useSourceChecks';

/** The kinds a browser holds one of. A browser runs one weeb-3 node, and the design offers one Bee node of one's own. */
const ONE_EACH: readonly SourceType[] = ['bee-node', 'weeb-3'];

interface AddTilesProps {
  readonly onPick: (type: SourceType) => void;
}

/** Add source: a tile per kind, a kind the viewer already added greyed. */
export function AddTiles({ onPick }: AddTilesProps) {
  const { sources } = useAppContext();
  return (
    <div className="connect-tiles">
      {(['gateway', 'bee-node', 'weeb-3'] as const).map((type) => {
        const isAdded = ONE_EACH.includes(type) && sources.some((source) => source.type === type);
        return (
          <button key={type} type="button" className="connect-tile" disabled={isAdded} onClick={() => onPick(type)}>
            <b>{ADD_TILES[type].name}</b>
            <span>{isAdded ? ALREADY_ADDED : ADD_TILES[type].line}</span>
          </button>
        );
      })}
    </div>
  );
}

interface AddAddressProps {
  readonly type: 'gateway' | 'bee-node';
  /** Told the new source's id once it is added. */
  readonly onAdded: (id: string) => void;
}

/** What the name field starts with, the design's own words. */
const DEFAULT_NAMES = { gateway: 'My gateway', 'bee-node': 'My Bee node' } as const;

/** The address as the checks take it: with the scheme a viewer left out, else as typed, for the checks to refuse. */
function addressToCheck(type: 'gateway' | 'bee-node', typed: string): string {
  const checked = checkSourceAddress(type, typed);
  return checked.ok ? checked.url : typed.trim();
}

/**
 * Adding a gateway or a Bee node: its address and name, Test connection, and the checks. The add button stays
 * disabled until every check passed for the address in the field, and nothing is added before.
 */
export function AddAddressView({ type, onAdded }: AddAddressProps) {
  const app = useAppContext();
  const { results, run, reset } = useSourceChecks();
  const [address, setAddress] = useState<string>(type === 'bee-node' ? ADDRESS_PLACEHOLDERS[type] : '');
  const [name, setName] = useState<string>(DEFAULT_NAMES[type]);
  const [tested, setTested] = useState<string | null>(null);
  const addressId = useId();
  const nameId = useId();
  // A second click on Add can land before the view has gone, and must not add the source twice.
  const isAdded = useRef(false);

  const test = () => {
    const url = addressToCheck(type, address);
    setTested(url);
    void run({ id: 'checked', type, url, offered: false });
  };

  const canAdd = tested !== null && results !== null && checksPassed(results);

  return (
    <>
      <div className="connect-parts">
        <div className="connect-part">
          <label htmlFor={addressId}>Address</label>
          <input
            id={addressId}
            className="connect-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={ADDRESS_PLACEHOLDERS[type]}
            data-dialog-focus
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setTested(null);
              reset();
            }}
          />
        </div>
        <div className="connect-part">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            className="connect-input"
            type="text"
            autoComplete="off"
            maxLength={SOURCE_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>
      <div className="connect-inline">
        <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={test}>
          Test connection
        </Button>
      </div>
      <CheckList type={type} results={results} isAdding />
      <div className="connect-foot">
        <Button
          disabled={!canAdd}
          onClick={() => {
            if (canAdd && tested !== null && !isAdded.current) {
              isAdded.current = true;
              onAdded(app.addSource({ type, name, url: tested }));
            }
          }}
        >
          {ADD_VIEWS[type].action}
        </Button>
      </div>
    </>
  );
}

const BYTES_PER_MB = 1_000_000;
const mb = (bytes: number) => (bytes / BYTES_PER_MB).toFixed(1);
const percent = (part: number, whole: number) => `${Math.min(100, Math.max(0, (part / whole) * 100))}%`;

interface NodeProgressProps {
  readonly client: SwarmClient;
}

/** How far the node's module has downloaded, and its peers against the healthy count, as they climb. */
function NodeProgress({ client }: NodeProgressProps) {
  const status = useNodeStatus(useMemo(() => () => client.status(), [client]));
  const healthy = status.healthyPeers ?? 200;
  const peers = status.peers ?? 0;
  const download = status.download;
  const isDownloaded = status.state === 'ready' || (status.state === 'starting' && download === undefined);
  const total = download?.totalBytes ?? null;
  const received = download?.receivedBytes ?? 0;
  const share = isDownloaded ? '100%' : total === null ? '0%' : percent(received, total);
  return (
    <>
      <div className="connect-box">
        <div className="connect-between">
          <span>Downloading the node</span>
          <span className="connect-ex">
            {isDownloaded ? 'Done' : total === null ? `${mb(received)} MB` : `${mb(received)} of ${mb(total)} MB`}
          </span>
        </div>
        <div className="connect-progress" role="progressbar" aria-label="Download" aria-valuetext={share}>
          <i style={{ width: share }} />
        </div>
      </div>
      <div className="connect-box">
        <div className="connect-between">
          <span>Peers</span>
          <span className="connect-big">
            {peers}
            <span className="connect-muted"> of {healthy}</span>
          </span>
        </div>
        <div
          className="connect-progress"
          role="progressbar"
          aria-label="Peers"
          aria-valuetext={`${peers} of ${healthy}`}
        >
          <i style={{ width: percent(peers, healthy) }} />
        </div>
        <p className="connect-hint">{healthy} is the healthy target. Playback can start before that.</p>
      </div>
    </>
  );
}

interface AddWeeb3Props {
  /** Told the new source's id, and handed the client that holds its node, which keeps running while Connect is open. */
  readonly onAdded: (id: string, client: SwarmClient) => void;
}

/**
 * Adding the node in this browser: it starts as the view opens, its download and peers show as they climb, and its
 * checks run at once. The node stops when the view goes away without adding it.
 */
export function AddWeeb3View({ onAdded }: AddWeeb3Props) {
  const app = useAppContext();
  const clientFor = useCheckClient();
  const { results, run } = useSourceChecks();
  const client = useMemo(() => clientFor({ id: 'checked', type: 'weeb-3', url: '', offered: false }), [clientFor]);
  // Read as the view goes away, so the node an added source holds is not stopped with the view, and by a second
  // click on Add that lands before the view has gone.
  const isKept = useRef(false);
  // Read through a ref, so the checks start once, as the node does, however often the stream list they read is read again.
  const latestRun = useRef(run);

  latestRun.current = run;

  useEffect(() => {
    client.start().catch(() => undefined);
    void latestRun.current({ id: 'checked', type: 'weeb-3', url: '', offered: false }, client);
    return () => {
      if (!isKept.current) {
        void client.stop();
      }
    };
  }, [client]);

  const canAdd = results !== null && checksPassed(results);
  const isFinished = results !== null && results.every(({ state }) => state !== 'running' && state !== 'waiting');

  /** The checks once more on the node this view holds, which is started again first if it failed or was lost. */
  const testAgain = () => {
    client.restart();
    void run({ id: 'checked', type: 'weeb-3', url: '', offered: false }, client);
  };

  return (
    <>
      <p className="connect-hint">Runs a Swarm node in this tab.</p>
      <NodeProgress client={client} />
      <CheckList type="weeb-3" results={results} isAdding />
      {isFinished && !canAdd && (
        <div className="connect-inline">
          <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={testAgain}>
            Test again
          </Button>
        </div>
      )}
      <div className="connect-foot">
        <Button
          disabled={!canAdd}
          onClick={() => {
            if (canAdd && !isKept.current) {
              isKept.current = true;
              onAdded(app.addSource({ type: 'weeb-3', name: '', url: '' }), client);
            }
          }}
        >
          {ADD_VIEWS['weeb-3'].action}
        </Button>
      </div>
    </>
  );
}
