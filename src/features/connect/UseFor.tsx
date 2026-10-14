import { useId } from 'react';

import type { SwarmFeature } from '@/swarm/client';
import { chooseSource, type PartSources, type Routing, type RoutingMode, setMode, setPart } from '@/swarm/routing';
import { servesVideoOnly, type Source } from '@/swarm/sources';

import { PART_LABELS, VIDEO_ONLY } from './connectWords';

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
 * video, the stream list, the previews and the chat history. Chat messages are always sent through the event's
 * chat write address, which no source here changes.
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
            sources={sources}
            value={parts.player}
            isVideo={false}
            onPick={(id) => onChange(chooseSource(routing, id))}
          />
        ) : (
          shownParts.map((part) => (
            <PartSelect
              key={part}
              label={PART_LABELS[part]}
              sources={sources}
              value={parts[part]}
              isVideo={part === 'player'}
              onPick={(id) => onChange(setPart(routing, part, id))}
            />
          ))
        )}
      </div>
    </>
  );
}

interface PartSelectProps {
  readonly label: string;
  readonly sources: readonly Source[];
  readonly value: string;
  /** Whether the select picks the video's source, the one part the node in this browser serves for now. */
  readonly isVideo: boolean;
  readonly onPick: (id: string) => void;
}

function PartSelect({ label, sources, value, isVideo, onPick }: PartSelectProps) {
  const selectId = useId();
  return (
    <div className="connect-part">
      <label htmlFor={selectId}>{label}</label>
      <select id={selectId} className="connect-input" value={value} onChange={(event) => onPick(event.target.value)}>
        {sources.map((source) => {
          const isVideoOnly = !isVideo && servesVideoOnly(source.type);
          return (
            <option key={source.id} value={source.id} disabled={isVideoOnly}>
              {isVideoOnly ? `${source.name} (${VIDEO_ONLY})` : source.name}
            </option>
          );
        })}
      </select>
    </div>
  );
}
