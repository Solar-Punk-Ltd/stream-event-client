import { useId, useState } from 'react';

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
 * The one order of fallbacks, as a line, and a small list to reorder it with a button up and a button
 * down per gateway. The event gateway is pinned last, so it has neither.
 */
export function FallbackOrder({ order, nameOf, inUseId, onChange }: FallbackOrderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const listId = useId();
  const canReorder = order.length > 2;
  const asked = order.filter((id) => id !== inUseId);

  return (
    <section className="fallback" aria-label="Fallback">
      <p className="sources-line">
        <span className="sources-line-label">Fallback</span>
        <span className="fallback-order">
          {order.length === 0 ? 'Off' : asked.length === 0 ? 'None' : asked.map(nameOf).join(', then ')}
        </span>
        {canReorder && (
          <button
            type="button"
            className="sources-text-button"
            aria-expanded={isEditing}
            aria-controls={listId}
            onClick={() => setIsEditing((editing) => !editing)}
          >
            {isEditing ? 'Close order' : 'Edit order'}
          </button>
        )}
      </p>
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
      <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
    </button>
  );
}
