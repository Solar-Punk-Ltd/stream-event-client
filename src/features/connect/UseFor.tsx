import { useId } from 'react';

import type { SwarmFeature } from '@/swarm/client';
import {
  chooseSource,
  type PartSources,
  type Routing,
  type RoutingMode,
  servesEveryPart,
  servesPart,
  setMode,
  setPart,
} from '@/swarm/routing';
import type { Source } from '@/swarm/sources';

import { FREEDOM_PARTS_NOTE, PART_LABELS, WEEB3_PARTS_NOTE } from './connectWords';

const MODE_LABELS: Readonly<Record<RoutingMode, string>> = { one: 'All features', 'per-part': 'Per feature' };

interface UseForProps {
  readonly sources: readonly Source[];
  readonly routing: Routing;
  /** The source each part reads from now, which each select shows. */
  readonly parts: PartSources;
  readonly hasChat: boolean;
  readonly onChange: (routing: Routing) => void;
}

/**
 * What each source is used for: one source for all features, the chat history included, or a source each for the
 * video, the stream list, the previews and the chat history. Each select offers only the sources that may serve its
 * part, so Weeb3 is offered for the video alone and the Freedom browser's node for all but the chat history. Who
 * sends a chat message is not picked here.
 */
export function UseFor({ sources, routing, parts, hasChat, onChange }: UseForProps) {
  const isOne = routing.mode === 'one';
  const shownParts: readonly SwarmFeature[] = hasChat
    ? ['player', 'stream-list', 'previews', 'chat']
    : ['player', 'stream-list', 'previews'];
  return (
    <>
      <div className="connect-between">
        <div className="connect-section-label">Use for</div>
        <div className="connect-seg" role="group" aria-label="One access for all features, or per feature">
          {(['one', 'per-part'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={routing.mode === mode}
              onClick={() => onChange(setMode(routing, mode))}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>
      <div className="connect-parts">
        {isOne ? (
          <PartSelect
            label="All features"
            sources={sources.filter(({ type }) => servesEveryPart(type))}
            value={parts.player}
            onPick={(id) => onChange(chooseSource(routing, id))}
          />
        ) : (
          shownParts.map((part) => (
            <PartSelect
              key={part}
              label={PART_LABELS[part]}
              sources={sources.filter(({ type }) => servesPart(type, part))}
              value={parts[part]}
              onPick={(id) => onChange(setPart(routing, part, id))}
            />
          ))
        )}
      </div>
      {sources.some(({ type }) => type === 'weeb-3') && <p className="connect-hint">{WEEB3_PARTS_NOTE}</p>}
      {sources.some(({ type }) => type === 'freedom') && <p className="connect-hint">{FREEDOM_PARTS_NOTE}</p>}
    </>
  );
}

interface PartSelectProps {
  readonly label: string;
  readonly sources: readonly Source[];
  readonly value: string;
  readonly onPick: (id: string) => void;
}

function PartSelect({ label, sources, value, onPick }: PartSelectProps) {
  const selectId = useId();
  return (
    <div className="connect-part">
      <label htmlFor={selectId}>{label}</label>
      <select id={selectId} className="connect-input" value={value} onChange={(event) => onPick(event.target.value)}>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
    </div>
  );
}
