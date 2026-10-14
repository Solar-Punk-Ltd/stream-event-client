import { CHECK_STEPS, checkLine } from '@/features/gateway/checkWords';
import { HelpSteps } from '@/features/gateway/HelpSteps';
import { firstFailure, type StepState } from '@/features/gateway/sourceChecks';
import type { SourceType } from '@/swarm/sources';

type Shown = StepState['state'];

const MARKS: Readonly<Record<Shown, string>> = {
  waiting: '·',
  running: '…',
  passed: '✓',
  failed: '✕',
  skipped: '–',
};

const STATE_WORDS: Readonly<Record<Shown, string>> = {
  waiting: 'not run yet',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  skipped: 'not run',
};

interface CheckListProps {
  readonly type: SourceType;
  readonly results: readonly StepState[] | null;
  /** Whether the checks stand between the viewer and adding the source, which the warning then says. */
  readonly isAdding: boolean;
}

/**
 * The checks of a source, one line each with its mark and its time, and under them, for a failure, what is
 * wrong and what to fix. Before a run every line waits.
 */
export function CheckList({ type, results, isAdding }: CheckListProps) {
  const failure = results === null ? null : firstFailure(results);
  return (
    <>
      <ul className="connect-checks" aria-label="Checks" aria-live="polite">
        {CHECK_STEPS[type].map((step, at) => {
          const result = results?.[at];
          const state: Shown = result?.state ?? 'waiting';
          return (
            <li key={step} data-check={step} data-state={state}>
              <span className={`connect-check-mark ${state}`} aria-hidden="true">
                {MARKS[state]}
              </span>
              <span>{checkLine(type, step)}</span>
              <span className="connect-check-ms">
                {result?.state === 'passed' ? (result.note ?? `${result.ms} ms`) : ''}
              </span>
              <span className="connect-visually-hidden">: {STATE_WORDS[state]}</span>
            </li>
          );
        })}
      </ul>
      {failure && (
        <div className="connect-warn" role="status">
          <strong>{isAdding ? `Not added. ${failure.reason}` : failure.reason}</strong>
          <span className="connect-hint">{failure.fix}</span>
          {failure.help && <HelpSteps help={failure.help} />}
        </div>
      )}
    </>
  );
}
