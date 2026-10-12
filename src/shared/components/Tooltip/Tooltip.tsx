import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import './Tooltip.scss';

/** How long the pointer rests on the anchor before the tooltip shows, as on the Swarm site. */
const SHOW_DELAY_MS = 200;
/** The room between the tooltip's arrow and its anchor. */
const ANCHOR_GAP = 8;
/** The least room kept between the tooltip and either side of the window. */
const EDGE_GAP = 8;

const SIDE_ABOVE = 'top';
const SIDE_BELOW = 'bottom';
type Side = typeof SIDE_ABOVE | typeof SIDE_BELOW;

interface Place {
  top: number;
  left: number;
  side: Side;
}

/**
 * Below the anchor, or above it when the window has no room below, centred on it but kept inside the
 * window. The arrow stays on the centre, so it is only off the anchor when the anchor hugs an edge.
 */
function tooltipPlace(anchor: DOMRect, tooltip: DOMRect): Place {
  const fitsBelow = window.innerHeight - anchor.bottom >= tooltip.height + ANCHOR_GAP;
  const side = fitsBelow || anchor.top < tooltip.height + ANCHOR_GAP ? SIDE_BELOW : SIDE_ABOVE;
  const top = side === SIDE_BELOW ? anchor.bottom + ANCHOR_GAP : anchor.top - tooltip.height - ANCHOR_GAP;
  const halfWidth = tooltip.width / 2;
  const centre = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(centre, halfWidth + EDGE_GAP), window.innerWidth - halfWidth - EDGE_GAP);
  return { top, left, side };
}

interface TooltipProps {
  content: string;
  children: ReactNode;
}

/**
 * The Swarm site's tooltip: words on a dark card with an arrow, floating over the page beside whatever
 * it names. Drawn into the body so no scrolling list clips it. A phone shows it on a tap, which it
 * reports as the pointer arriving. It says nothing a screen reader does not already get from the
 * anchor's own name.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [isShown, setIsShown] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);

  const measure = useCallback(() => {
    if (anchorRef.current && tooltipRef.current) {
      setPlace(tooltipPlace(anchorRef.current.getBoundingClientRect(), tooltipRef.current.getBoundingClientRect()));
    }
  }, []);

  const showSoon = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsShown(true), SHOW_DELAY_MS);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setIsShown(false);
    setPlace(null);
  };

  useLayoutEffect(() => {
    if (isShown) {
      measure();
    }
  }, [isShown, measure]);

  useEffect(() => {
    if (!isShown) {
      return;
    }
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isShown, measure]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <span ref={anchorRef} className="tooltip-anchor" onMouseEnter={showSoon} onMouseLeave={hide}>
        {children}
      </span>
      {isShown &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className={`tooltip tooltip--${place?.side ?? SIDE_BELOW}`}
            style={place ? { top: place.top, left: place.left } : { visibility: 'hidden' }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
