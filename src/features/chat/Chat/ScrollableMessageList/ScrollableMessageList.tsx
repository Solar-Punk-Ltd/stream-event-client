import { ReactNode, useCallback, useEffect, useRef } from 'react';

import type { VisibleMessage } from '../../useSwarmChat';

import './ScrollableMessageList.scss';

interface ScrollableMessageListProps {
  items: VisibleMessage[];
  label: string;
  renderItem: (item: VisibleMessage, onHeightChange: () => void) => ReactNode;
  /** Whether the viewer wrote this message, which brings the list down to it wherever the viewer was. */
  isOwn?: (item: VisibleMessage) => boolean;
}

/** How near the bottom, in pixels, still counts as reading the newest messages. */
const NEAR_BOTTOM_PX = 50;

/**
 * Follows new messages while the viewer is at the bottom, and leaves them where they are when they have
 * scrolled up to read. A message the viewer sends always brings the list down to it.
 *
 * Whether the viewer is following is read when they scroll, never after a message is drawn: a new
 * message taller than the slack would otherwise read as the viewer having scrolled away.
 */
export function ScrollableMessageList({ items, label, renderItem, isOwn }: ScrollableMessageListProps) {
  const containerRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  const seenIdsRef = useRef<ReadonlySet<string>>(new Set());

  const scrollToBottom = () => {
    const container = containerRef.current;
    if (container) {
      // Instant, over the list's smooth style: a smooth scroll fires scroll events short of the bottom, which
      // would read as the viewer leaving it.
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
    }
  };

  const handleScroll = () => {
    const container = containerRef.current;
    if (container) {
      followingRef.current = container.scrollTop + container.clientHeight >= container.scrollHeight - NEAR_BOTTOM_PX;
    }
  };

  const handleHeightChange = useCallback(() => {
    if (followingRef.current) {
      requestAnimationFrame(scrollToBottom);
    }
  }, []);

  useEffect(() => {
    const arrived = newlyArrived(items, seenIdsRef.current);
    if (arrived.some((item) => isOwn?.(item))) {
      followingRef.current = true;
    }
    if (arrived.length > 0 && followingRef.current) {
      requestAnimationFrame(scrollToBottom);
    }
    seenIdsRef.current = new Set(items.map((item) => item.id));
  }, [items, isOwn]);

  return (
    <ol className="chat-messages-container" ref={containerRef} aria-label={label} onScroll={handleScroll}>
      {items.map((item) => renderItem(item, handleHeightChange))}
    </ol>
  );
}

/**
 * The messages that are new since the last render and below the oldest one already shown. Older history
 * loaded above is left out, and a message that lands above the viewer's pending one, which the chat keeps
 * last until it is read back, still counts.
 */
function newlyArrived(items: readonly VisibleMessage[], seen: ReadonlySet<string>): VisibleMessage[] {
  const firstSeen = items.findIndex((item) => seen.has(item.id));
  const from = firstSeen === -1 ? 0 : firstSeen + 1;
  return items.slice(from).filter((item) => !seen.has(item.id));
}
