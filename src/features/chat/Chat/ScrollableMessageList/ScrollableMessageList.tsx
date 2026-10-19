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
  const previousNewestRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
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
    const newest = items.at(-1);
    const newestId = newest?.id ?? null;
    const arrived = newest !== undefined && newestId !== previousNewestRef.current;
    if (arrived && isOwn?.(newest)) {
      followingRef.current = true;
    }
    if (arrived && followingRef.current) {
      requestAnimationFrame(scrollToBottom);
    }
    previousNewestRef.current = newestId;
  }, [items, isOwn]);

  return (
    <ol className="chat-messages-container" ref={containerRef} aria-label={label} onScroll={handleScroll}>
      {items.map((item) => renderItem(item, handleHeightChange))}
    </ol>
  );
}
