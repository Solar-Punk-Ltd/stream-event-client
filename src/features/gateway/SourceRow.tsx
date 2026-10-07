import { useId, useState } from 'react';

import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { SOURCE_NAME_MAX_LENGTH, type Source } from '@/swarm/sources';

import { HelpSteps } from './HelpSteps';
import type { CheckResult } from './providerTest';
import { StatusDot } from './StatusDot';
import type { SourceStatus } from './sourceStatus';
import { BADGE_LABELS, OUTCOME_WORDS, testStatusLine } from './sourceWords';

const KEY_ENTER = 'Enter';
const KEY_ESCAPE = 'Escape';

/** A source's Test: running, or done with one result per check. */
export type SourceTest =
  | { readonly state: 'running' }
  | { readonly state: 'done'; readonly results: readonly CheckResult[] };

interface SourceRowProps {
  readonly source: Source;
  readonly isInUse: boolean;
  /** The name every row's radio shares, so the list is one group. */
  readonly radioName: string;
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
export function whereIs(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'On this site';
  }
}

/**
 * One source in the list: a radio that puts it in use, its name and where it is, its tags, its status
 * dot, and for a source the viewer added, a menu to rename or remove it. The row opens its details,
 * where the Test's result shows as badges and one line, and a failure's sentences and fix only behind
 * "How to fix".
 */
export function SourceRow(props: SourceRowProps) {
  const { source, isInUse, radioName, status, isExpanded, onToggle } = props;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const detailsId = useId();
  const menuId = useId();

  const startRename = () => {
    setIsMenuOpen(false);
    setDraft(source.name);
  };
  const finishRename = () => {
    if (draft !== null) {
      props.onRename(draft);
    }
    setDraft(null);
  };

  return (
    <li className={`source-row${isExpanded ? ' expanded' : ''}`} data-source-row={source.id}>
      <div className="source-row-main">
        <input
          type="radio"
          className="source-row-radio"
          name={radioName}
          checked={isInUse}
          onChange={props.onUse}
          aria-label={source.name}
        />
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
            <span className="source-row-address">{whereIs(source.url)}</span>
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
        <span className="source-row-tags">
          {source.offered && <span className="source-tag">Offered</span>}
          {isInUse && <span className="source-tag in-use">In use</span>}
        </span>
        <StatusDot status={status} />
        {!source.offered && (
          <button
            type="button"
            className="sources-icon-button"
            aria-label={`Actions for ${source.name}`}
            aria-expanded={isMenuOpen}
            aria-controls={menuId}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        )}
      </div>
      {isMenuOpen && (
        <div className="source-row-menu" id={menuId}>
          <Button variant={ButtonVariant.SECONDARY} onClick={startRename} aria-label={`Rename ${source.name}`}>
            Rename
          </Button>
          <Button variant={ButtonVariant.SECONDARY} onClick={props.onRemove} aria-label={`Remove ${source.name}`}>
            Remove
          </Button>
        </div>
      )}
      {isExpanded && <SourceDetails {...props} id={detailsId} onStartRename={startRename} />}
    </li>
  );
}

function SourceDetails({
  id,
  source,
  isInUse,
  test,
  onUse,
  onRetest,
  onRemove,
  onStartRename,
}: SourceRowProps & { readonly id: string; readonly onStartRename: () => void }) {
  const results = test?.state === 'done' ? test.results : [];
  const failures = results.filter(({ outcome }) => outcome === 'failed');
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
      <p className="source-status-line" role="status">
        {isRunning && 'Testing every part'}
        {!isRunning && test?.state === 'done' && testStatusLine(results)}
      </p>
      <div className="source-actions">
        <Button
          onClick={onUse}
          disabled={isInUse}
          aria-label={isInUse ? `${source.name} is in use` : `Use ${source.name}`}
        >
          {isInUse ? 'In use' : 'Use'}
        </Button>
        <Button
          variant={ButtonVariant.SECONDARY}
          onClick={onRetest}
          disabled={isRunning}
          aria-label={isRunning ? `Testing ${source.name}` : `Retest ${source.name}`}
        >
          {isRunning ? 'Testing' : 'Retest'}
        </Button>
        {!source.offered && (
          <>
            <Button variant={ButtonVariant.SECONDARY} onClick={onStartRename}>
              Rename
            </Button>
            <Button variant={ButtonVariant.SECONDARY} onClick={onRemove}>
              Remove
            </Button>
          </>
        )}
      </div>
      {failures.length > 0 && (
        <details className="source-fix">
          <summary>How to fix</summary>
          <ul className="source-fix-list" aria-label={`How to fix ${source.name}`}>
            {failures.map((failure) => (
              <li key={failure.check} className="source-fix-item">
                <span className="source-fix-name">{BADGE_LABELS[failure.check]}</span>
                <span className="source-fix-sentence">{failure.sentence}</span>
                {failure.help && <HelpSteps help={failure.help} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
