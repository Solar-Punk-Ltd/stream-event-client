import { type SourceStatus, sourceStatusWords } from '@/features/gateway/sourceStatus';
import { StatusDot } from '@/features/gateway/StatusDot';
import { useNodeInTabStatus } from '@/features/gateway/useNodeInTabStatus';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { weeb3StatusWords } from '@/shared/nodeInTabStatus';
import { hasAddress, type Source } from '@/swarm/sources';

import { KIND_LABELS } from './connectWords';

/** An address as the viewer reaches it, a path on this site shown with the page's origin. */
function shownAddress(url: string): string {
  try {
    return new URL(url, window.location.origin).href.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/** The node in this browser's peers where another source shows its address and time. */
function NodeInTabMeta({ source }: { source: Source }) {
  const status = useNodeInTabStatus(source);
  return (
    <>
      {KIND_LABELS[source.type]} · {weeb3StatusWords(status)} · in this tab
    </>
  );
}

interface SwarmAccessProps {
  readonly sources: readonly Source[];
  readonly statuses: Readonly<Record<string, SourceStatus>>;
  readonly onSettings: (id: string) => void;
  readonly onAdd: () => void;
}

/**
 * Every source in one flat list: the deployment's, marked Offered, then the viewer's own, each with its status dot,
 * its kind, where it is and how long it took to answer, and its settings.
 */
export function SwarmAccess({ sources, statuses, onSettings, onAdd }: SwarmAccessProps) {
  return (
    <>
      <ul className="connect-rows" aria-label="Sources">
        {sources.map((source) => (
          <li key={source.id} className="connect-row" data-source-row={source.id}>
            <StatusDot status={statuses[source.id]} withWords={false} />
            <div className="connect-row-text">
              <span className="connect-row-name">{source.name}</span>
              {source.offered && <span className="connect-badge">Offered</span>}
              <div className="connect-row-meta">
                {hasAddress(source.type) ? (
                  <>
                    {KIND_LABELS[source.type]} · {shownAddress(source.url)}
                    {statuses[source.id] && ` · ${sourceStatusWords(statuses[source.id])}`}
                  </>
                ) : (
                  <NodeInTabMeta source={source} />
                )}
              </div>
            </div>
            <Button
              variant={ButtonVariant.SECONDARY}
              className="connect-small"
              aria-label={`Settings of ${source.name}`}
              onClick={() => onSettings(source.id)}
            >
              Settings
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={onAdd}>
          Add source
        </Button>
      </div>
    </>
  );
}
