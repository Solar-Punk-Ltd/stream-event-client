import { useId, useState } from 'react';

import { ChevronIcon } from '@/shared/components/Icons/ChevronIcon';
import { weeb3StatusWords } from '@/shared/nodeInTabStatus';
import { hasAddress, SOURCE_NAME_MAX_LENGTH, type Source } from '@/swarm/sources';

import { HelpSteps } from './HelpSteps';
import type { CheckResult } from './providerTest';
import { StatusDot } from './StatusDot';
import type { SourceStatus } from './sourceStatus';
import { BADGE_LABELS, fixGroups, OUTCOME_WORDS, testStatusLine } from './sourceWords';
import { useNodeInTabStatus } from './useNodeInTabStatus';

const KEY_ENTER = 'Enter';
const KEY_ESCAPE = 'Escape';

/** A source's Test: running, or done with one result per check. */
export type SourceTest =
  | { readonly state: 'running' }
  | { readonly state: 'done'; readonly results: readonly CheckResult[] };

interface SourceRowProps {
  readonly source: Source;
  readonly isInUse: boolean;
  /**
   * The name every row's radio shares, so the list is one group, or null where a row cannot be put in
   * use from the list, as in per part, where each part picks its own.
   */
  readonly radioName: string | null;
  /** Why the radio cannot put this source in use, or null when it can. */
  readonly pickRefusal?: string | null;
  readonly status?: SourceStatus;
  readonly test?: SourceTest;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onUse: () => void;
  readonly onRetest: () => void;
  readonly onRename: (name: string) => void;
  readonly onRemove: () => void;
}

/** Where a source is, as a viewer can recognise it: its host, or this site for a path such as `/bee`. */
function whereIs(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'On this site';
  }
}

/** The node in this browser's own status line, where another source shows its host. */
function NodeInTabStatusLine({ source }: { readonly source: Source }) {
  return (
    <span className="source-row-address" role="status">
      {weeb3StatusWords(useNodeInTabStatus(source))}
    </span>
  );
}

/**
 * One source in the list: a radio that puts it in use, its name, an In use tag, where it is, and its
 * status dot. The node in this browser shows its status line where the others show their host, and is
 * never tested, since its own start says whether it works. The rest of the row opens its details, where the Test's result shows as badges and one
 * line, the actions that apply, and a failure's sentences and fix only behind "How to fix".
 */
export function SourceRow(props: SourceRowProps) {
  const { source, isInUse, radioName, pickRefusal = null, status, isExpanded, onToggle } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const detailsId = useId();

  const finishRename = () => {
    if (draft !== null) {
      props.onRename(draft);
    }
    setDraft(null);
  };

  return (
    <li className={`source-row${isExpanded ? ' expanded' : ''}`} data-source-row={source.id}>
      <div className={`source-row-main${radioName === null ? ' no-pick' : ''}`}>
        {radioName !== null && (
          <span className="source-row-pick">
            <input
              type="radio"
              className="source-row-radio"
              name={radioName}
              checked={isInUse}
              disabled={pickRefusal !== null}
              onChange={props.onUse}
              aria-label={source.name}
            />
          </span>
        )}
        <span className="source-row-title">
          {draft === null ? (
            <button
              type="button"
              className="source-row-toggle"
              onClick={onToggle}
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              aria-label={`Details of ${source.name}`}
            >
              <span className="source-row-name">{source.name}</span>
            </button>
          ) : (
            <input
              className="sources-input source-row-rename"
              type="text"
              value={draft}
              maxLength={SOURCE_NAME_MAX_LENGTH}
              autoFocus
              aria-label={`New name for ${source.name}`}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key === KEY_ENTER) {
                  finishRename();
                } else if (event.key === KEY_ESCAPE) {
                  // Escape here leaves the name as it was rather than closing the whole screen.
                  event.stopPropagation();
                  setDraft(null);
                }
              }}
            />
          )}
          {isInUse && <span className="source-tag in-use">In use</span>}
        </span>
        {hasAddress(source.type) ? (
          <span className="source-row-address">{whereIs(source.url)}</span>
        ) : (
          <NodeInTabStatusLine source={source} />
        )}
        <StatusDot status={status} />
        <span className="source-row-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </div>
      {pickRefusal !== null && <p className="sources-muted source-row-note">{pickRefusal}</p>}
      {isExpanded && <SourceDetails {...props} id={detailsId} onStartRename={() => setDraft(source.name)} />}
    </li>
  );
}

function SourceDetails({
  id,
  source,
  isInUse,
  radioName,
  pickRefusal = null,
  test,
  onUse,
  onRetest,
  onRemove,
  onStartRename,
}: SourceRowProps & { readonly id: string; readonly onStartRename: () => void }) {
  const results = test?.state === 'done' ? test.results : [];
  const fixes = fixGroups(results);
  const isRunning = test?.state === 'running';

  return (
    <div className="source-details" id={id}>
      {results.length > 0 && (
        <ul className="source-badges" aria-label={`Checks of ${source.name}`}>
          {results.map(({ check, outcome }) => (
            <li key={check} className={`source-badge ${outcome}`} data-check={check}>
              <span className="source-badge-mark" aria-hidden="true" />
              {BADGE_LABELS[check]}
              <span className="sources-visually-hidden">: {OUTCOME_WORDS[outcome]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="source-details-bar">
        <p className="source-status-line" role="status">
          {isRunning && 'Testing every part'}
          {/* One fix's heading already names every failure, and the badges say the rest. */}
          {!isRunning && test?.state === 'done' && fixes.length !== 1 && testStatusLine(results)}
        </p>
        <div className="source-actions">
          {radioName !== null && !isInUse && pickRefusal === null && (
            <button type="button" className="sources-small-button" onClick={onUse} aria-label={`Use ${source.name}`}>
              Use
            </button>
          )}
          {hasAddress(source.type) && (
            <button
              type="button"
              className="sources-small-button"
              onClick={onRetest}
              disabled={isRunning}
              aria-label={isRunning ? `Testing ${source.name}` : `Retest ${source.name}`}
            >
              {isRunning ? 'Testing' : 'Retest'}
            </button>
          )}
          {!source.offered && (
            <>
              <button
                type="button"
                className="sources-small-button"
                onClick={onStartRename}
                aria-label={`Rename ${source.name}`}
              >
                Rename
              </button>
              <button
                type="button"
                className="sources-small-button"
                onClick={onRemove}
                aria-label={`Remove ${source.name}`}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      {fixes.length > 0 && (
        <details className="source-fix">
          <summary>
            How to fix
            <ChevronIcon />
          </summary>
          <ul className="source-fix-list" aria-label={`How to fix ${source.name}`}>
            {fixes.map((fix) => (
              <li key={fix.heading} className="source-fix-item">
                <span className="source-fix-name">{fix.heading}</span>
                <span className="source-fix-sentence">{fix.sentence}</span>
                {fix.help && <HelpSteps help={fix.help} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
