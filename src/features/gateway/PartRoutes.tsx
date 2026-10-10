import { type ReactNode, useId } from 'react';

import { ChevronIcon } from '@/shared/components/Icons/ChevronIcon';
import type { SwarmFeature } from '@/swarm/client';
import { CHAT_SERVICE_ID, type PartSources, type Routing, setLinked, setPart } from '@/swarm/routing';
import { servesVideoOnly, type Source } from '@/swarm/sources';

import { StatusDot } from './StatusDot';
import type { SourceStatus } from './sourceStatus';
import { CHAT_SEND_NOTE, CHAT_SERVICE_NAME, PART_LABELS, UNLINKED_NOTE, VIDEO_ONLY } from './sourceWords';

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
 * list of sources, with the video and the stream list linked until the viewer unlinks them, by a "Same
 * as video" toggle on the stream list's label line.
 */
export function PartRoutes({ sources, routing, parts, statuses, hasChat, onChange }: PartRoutesProps) {
  const noteId = useId();
  const linkLabel = routing.linked ? 'Unlink video and stream list' : 'Link video and stream list';

  const row = (part: SwarmFeature, aside?: ReactNode) => (
    <PartRow
      key={part}
      part={part}
      sources={sources}
      value={parts[part]}
      status={statuses[parts[part]]}
      describedBy={part === 'chat' ? noteId : undefined}
      aside={aside}
      onPick={(id) => onChange(setPart(routing, part, id))}
    />
  );

  const link = (
    <button
      type="button"
      className={`part-link-button${routing.linked ? ' linked' : ''}`}
      aria-label={linkLabel}
      aria-pressed={routing.linked}
      title={linkLabel}
      onClick={() => onChange(setLinked(routing, !routing.linked))}
    >
      <LinkIcon />
      <span aria-hidden="true">Same as video</span>
    </button>
  );

  return (
    <div className="part-routes" aria-label="Source per part" role="group">
      {row('player')}
      {row('stream-list', link)}
      {!routing.linked && <p className="sources-muted part-note">{UNLINKED_NOTE}</p>}
      {row('previews')}
      {hasChat && (
        <>
          {row('chat')}
          <p className="sources-muted part-note" id={noteId}>
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
  /** A control at the end of the label's line. */
  readonly aside?: ReactNode;
  readonly onPick: (id: string) => void;
}

/** A part's label over its select, with the dot of the source it reads from inside the field. */
function PartRow({ part, sources, value, status, describedBy, aside, onPick }: PartRowProps) {
  const selectId = useId();
  return (
    <div className="part-row" data-part={part}>
      <span className="part-row-head">
        <label className="part-row-label" htmlFor={selectId}>
          {PART_LABELS[part]}
        </label>
        {aside}
      </span>
      <span className="part-row-field">
        <select
          id={selectId}
          className="sources-input part-row-select"
          value={value}
          aria-describedby={describedBy}
          onChange={(event) => onPick(event.target.value)}
        >
          {part === 'chat' && <option value={CHAT_SERVICE_ID}>{CHAT_SERVICE_NAME}</option>}
          {sources.map((source) => {
            // The node in this browser is offered for the video alone, so its reads have no feed head
            // lookup and no verified chat slot to make, and neither gap can be reached from here.
            const videoOnly = part !== 'player' && servesVideoOnly(source.type);
            return (
              <option key={source.id} value={source.id} disabled={videoOnly}>
                {videoOnly ? `${source.name} (${VIDEO_ONLY})` : source.name}
              </option>
            );
          })}
        </select>
        <StatusDot status={value === CHAT_SERVICE_ID ? undefined : status} withWords={false} />
        <span className="part-row-caret" aria-hidden="true">
          <ChevronIcon />
        </span>
      </span>
    </div>
  );
}

/** Two chain links. */
function LinkIcon() {
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
      <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5L8.5 4" />
      <path d="M9 7a2.5 2.5 0 0 0-3.5 0L3 9.5a2.5 2.5 0 0 0 3.5 3.5l1-1" />
    </svg>
  );
}
