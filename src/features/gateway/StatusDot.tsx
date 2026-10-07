import { sourceHealthWord, type SourceStatus, sourceStatusWords, UNCHECKED } from './sourceStatus';

/** A source's light check at a glance: a dot whose colour is its health, and its time or state in words. */
export function StatusDot({ status = UNCHECKED, withWords = true }: { status?: SourceStatus; withWords?: boolean }) {
  return (
    <span className={`source-status ${status.health}`} data-health={status.health}>
      <span className="source-status-dot" aria-hidden="true" />
      {withWords ? (
        <span className="source-status-words">{sourceStatusWords(status)}</span>
      ) : (
        <span className="sources-visually-hidden">{sourceHealthWord(status.health)}</span>
      )}
    </span>
  );
}
