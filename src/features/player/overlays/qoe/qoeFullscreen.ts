/**
 * Where the QoE panel is rendered, and how it stays above a player in full screen.
 *
 * The panel is fixed to the browser window and rendered in the page's body, outside the player, which
 * clips what overflows it. Full screen shows only the element in full screen, and a browser's own
 * video controls put the `<video>` itself in full screen. Three things keep the panel visible and
 * usable there:
 *
 * - A video's full screen is handed to the player around it (`fullscreenHandOver`). Chrome makes
 *   everything outside the element in full screen inert, so a panel left outside a video in full screen
 *   is drawn but takes no clicks, and a video can hold no panel inside it. Measured in Chromium on
 *   2026-10-12: the hand-over is granted from the full screen change itself, with no click of its own.
 *   A browser that refuses it keeps the video's own full screen, and the panel stays in the page.
 * - Where the element in full screen can hold children, the player above all, the panel is rendered
 *   inside it (`panelHost`).
 * - It is a manual popover, so it sits in the browser's top layer, the same layer a full screen element
 *   is drawn in. The top layer draws in the order its elements entered it, so on every full screen
 *   change the panel leaves it and enters it again, which puts it above whatever just went full screen.
 */

/** Elements that draw their own content and take no children, the `<video>` above all. */
const REPLACED_ELEMENTS = new Set(['VIDEO', 'AUDIO', 'IMG', 'IFRAME', 'CANVAS', 'EMBED', 'OBJECT']);

const holdsNoChildren = (element: Element) => REPLACED_ELEMENTS.has(element.tagName);

/** The element the panel is rendered in: the one in full screen when it can hold the panel, otherwise the page. */
export function panelHost(fullscreenElement: Element | null, body: HTMLElement): Element {
  if (fullscreenElement && !holdsNoChildren(fullscreenElement)) {
    return fullscreenElement;
  }
  return body;
}

/** What a full screen change asks of the panel's player: take the full screen over, leave it, or nothing. */
type FullscreenHandOver = 'to-player' | 'exit' | 'none';

/**
 * A video of this player that just went full screen hands it to the player around it. When the player
 * was in full screen already, the video's own control was pressed from inside it, which the viewer
 * means as leaving, so the full screen ends instead of bouncing back.
 */
export function fullscreenHandOver(
  fullscreen: Element | null,
  previous: Element | null,
  player: Element | null | undefined,
): FullscreenHandOver {
  if (!fullscreen || !player || fullscreen === player || !holdsNoChildren(fullscreen) || !player.contains(fullscreen)) {
    return 'none';
  }
  return previous === player ? 'exit' : 'to-player';
}

/** The element in full screen, read through Safari's older name where the standard one is missing. */
export function fullscreenElementOf(doc: Document): Element | null {
  const legacy = doc as Document & { webkitFullscreenElement?: Element | null };
  return doc.fullscreenElement ?? legacy.webkitFullscreenElement ?? null;
}

/**
 * The events a document fires when an element enters or leaves full screen, the standard one and
 * Safari's. A browser may fire both for one change, so a listener handles a change once.
 */
export const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

type WebkitElement = Element & { webkitRequestFullscreen?: () => void | Promise<void> };
type WebkitDocument = Document & { webkitExitFullscreen?: () => void | Promise<void> };

/** Runs one of the browser's full screen calls: true when it was taken, false when it threw or was rejected. */
async function attempt(call: (() => void | Promise<void>) | undefined): Promise<boolean> {
  if (!call) {
    return false;
  }
  try {
    await call();
    return true;
  } catch {
    return false;
  }
}

/** Asks for `element` in full screen through the standard call, or Safari's older one where it is missing. */
export function requestFullscreenOn(element: Element): Promise<boolean> {
  const webkit = element as WebkitElement;
  const call =
    typeof element.requestFullscreen === 'function' ? element.requestFullscreen : webkit.webkitRequestFullscreen;
  return attempt(call?.bind(element));
}

/** Leaves one level of full screen through the standard call, or Safari's older one where it is missing. */
export function exitFullscreenOf(doc: Document): Promise<boolean> {
  const webkit = doc as WebkitDocument;
  const call = typeof doc.exitFullscreen === 'function' ? doc.exitFullscreen : webkit.webkitExitFullscreen;
  return attempt(call?.bind(doc));
}

/**
 * Puts the panel on top of the top layer: out of it and back in, so it is drawn above the element that
 * entered full screen after it. Does nothing in a browser without popovers.
 */
export function raiseToTopLayer(element: HTMLElement | null): void {
  if (!element || typeof element.showPopover !== 'function') {
    return;
  }
  try {
    element.hidePopover();
  } catch {
    // Not shown yet, or no longer connected: showing it below is all that is needed.
  }
  try {
    element.showPopover();
  } catch {
    // Disconnected by a render under way: the next render's raise shows it.
  }
}
