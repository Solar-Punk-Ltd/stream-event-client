import { useId, useState } from 'react';

import { ChevronIcon } from '@/shared/components/Icons/ChevronIcon';
import { canMoveFallback, moveFallback } from '@/swarm/fallbackOrder';

interface FallbackOrderProps {
  /** The order the fallbacks are asked in, the event gateway last. */
  readonly order: readonly string[];
  readonly nameOf: (id: string) => string;
  /** The source every part reads from, in one-source mode, which is never asked as its own fallback. */
  readonly inUseId: string | null;
  readonly onChange: (order: readonly string[]) => void;
}

/**
 * What the fallback line says: off, the order asked, or with nothing behind the source in use, that
 * source alone.
 */
function fallbackLine(order: readonly string[], asked: readonly string[], nameOf: (id: string) => string): string {
  if (order.length === 0) {
    return 'Off';
  }
  return asked.length === 0 ? `${nameOf(order[0])} only` : asked.map(nameOf).join(', then ');
}

/**
 * The one order of fallbacks, as a line, and a small list to reorder it with a button up and a button
 * down per gateway. The event gateway is pinned last, so it has neither.
 */
export function FallbackOrder({ order, nameOf, inUseId, onChange }: FallbackOrderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const listId = useId();
  const canReorder = order.length > 2;
  const asked = order.filter((id) => id !== inUseId);

  return (
    <section className="fallback sources-section" aria-label="Fallback">
      <div className="sources-setting">
        <span className="sources-setting-label">Fallback</span>
        <span className="sources-setting-value">{fallbackLine(order, asked, nameOf)}</span>
        {canReorder && (
          <button
            type="button"
            className="sources-small-button ghost"
            aria-expanded={isEditing}
            aria-controls={listId}
            onClick={() => setIsEditing((editing) => !editing)}
          >
            {isEditing ? 'Close order' : 'Edit order'}
          </button>
        )}
      </div>
      {isEditing && canReorder && (
        <ol className="fallback-list" id={listId} aria-label="Fallback order">
          {order.map((id, at) => {
            const name = nameOf(id);
            const isPinned = at === order.length - 1;
            return (
              <li key={id} className="fallback-item">
                <span className="fallback-item-name">{name}</span>
                {isPinned ? (
                  <span className="source-tag">Always last</span>
                ) : (
                  <span className="fallback-item-moves">
                    <MoveButton name={name} direction="up" order={order} id={id} onChange={onChange} />
                    <MoveButton name={name} direction="down" order={order} id={id} onChange={onChange} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

interface MoveButtonProps {
  readonly name: string;
  readonly direction: 'up' | 'down';
  readonly order: readonly string[];
  readonly id: string;
  readonly onChange: (order: readonly string[]) => void;
}

/**
 * Marked rather than disabled where it cannot move, because a disabled button drops focus to the page,
 * which is where a keyboard user moving a gateway to the top would land.
 */
function MoveButton({ name, direction, order, id, onChange }: MoveButtonProps) {
  const by = direction === 'up' ? -1 : 1;
  const canMove = canMoveFallback(order, id, by);
  return (
    <button
      type="button"
      className="sources-icon-button"
      aria-label={`Move ${name} ${direction}`}
      aria-disabled={!canMove}
      onClick={() => canMove && onChange(moveFallback(order, id, by))}
    >
      <span className={`fallback-move ${direction}`} aria-hidden="true">
        <ChevronIcon />
      </span>
    </button>
  );
}
