import { useId } from 'react';

import type { SwarmFeature } from '@/swarm/client';
import { CHAT_SERVICE_ID, type PartSources, type Routing, setLinked, setPart } from '@/swarm/routing';
import type { Source } from '@/swarm/sources';

import { StatusDot } from './StatusDot';
import type { SourceStatus } from './sourceStatus';
import { CHAT_SEND_NOTE, CHAT_SERVICE_NAME, PART_LABELS, UNLINKED_NOTE } from './sourceWords';

interface PartRoutesProps {
  readonly sources: readonly Source[];
  readonly routing: Routing;
  /** The source each part reads from now, which is what each select shows. */
  readonly parts: PartSources;
  readonly statuses: Readonly<Record<string, SourceStatus>>;
  readonly hasChat: boolean;
  readonly onChange: (routing: Routing) => void;
}

/**
 * Per part: a source for the video, the stream list, the previews and the chat, each from the same
 * list of sources, with the video and the stream list linked until the viewer unlinks them.
 */
export function PartRoutes({ sources, routing, parts, statuses, hasChat, onChange }: PartRoutesProps) {
  const noteId = useId();
  const linkLabel = routing.linked ? 'Unlink video and stream list' : 'Link video and stream list';

  const row = (part: SwarmFeature) => (
    <PartRow
      key={part}
      part={part}
      sources={sources}
      value={parts[part]}
      status={statuses[parts[part]]}
      describedBy={part === 'chat' ? noteId : undefined}
      onPick={(id) => onChange(setPart(routing, part, id))}
    />
  );

  return (
    <div className="part-routes" aria-label="Source per part" role="group">
      {row('player')}
      <div className="part-link">
        <div className="part-link-inner">
          <button
            type="button"
            className={`sources-icon-button part-link-button${routing.linked ? ' linked' : ''}`}
            aria-label={linkLabel}
            aria-pressed={routing.linked}
            title={linkLabel}
            onClick={() => onChange(setLinked(routing, !routing.linked))}
          >
            <LinkIcon broken={!routing.linked} />
          </button>
          {!routing.linked && <span className="sources-muted">{UNLINKED_NOTE}</span>}
        </div>
      </div>
      {row('stream-list')}
      {row('previews')}
      {hasChat && (
        <>
          {row('chat')}
          <p className="sources-muted" id={noteId}>
            {CHAT_SEND_NOTE}
          </p>
        </>
      )}
    </div>
  );
}

interface PartRowProps {
  readonly part: SwarmFeature;
  readonly sources: readonly Source[];
  readonly value: string;
  readonly status?: SourceStatus;
  readonly describedBy?: string;
  readonly onPick: (id: string) => void;
}

function PartRow({ part, sources, value, status, describedBy, onPick }: PartRowProps) {
  const selectId = useId();
  return (
    <div className="part-row" data-part={part}>
      <label className="part-row-label" htmlFor={selectId}>
        {PART_LABELS[part]}
      </label>
      <select
        id={selectId}
        className="sources-input part-row-select"
        value={value}
        aria-describedby={describedBy}
        onChange={(event) => onPick(event.target.value)}
      >
        {part === 'chat' && <option value={CHAT_SERVICE_ID}>{CHAT_SERVICE_NAME}</option>}
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
      {value === CHAT_SERVICE_ID ? (
        <span className="part-row-status" />
      ) : (
        <StatusDot status={status} withWords={false} />
      )}
    </div>
  );
}

/** Two chain links, drawn apart while the parts are unlinked. */
function LinkIcon({ broken }: { broken: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {broken ? (
        <>
          <path d="M6.5 4.5 5 3a2.5 2.5 0 0 0-3.5 3.5L3 8" />
          <path d="M9.5 11.5 11 13a2.5 2.5 0 0 0 3.5-3.5L13 8" />
        </>
      ) : (
        <>
          <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5L8.5 4" />
          <path d="M9 7a2.5 2.5 0 0 0-3.5 0L3 9.5a2.5 2.5 0 0 0 3.5 3.5l1-1" />
        </>
      )}
    </svg>
  );
}
