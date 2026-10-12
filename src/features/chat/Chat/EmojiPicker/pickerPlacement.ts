/** Below this window width the picker takes a phone's smaller size. */
const PHONE_MAX_WIDTH = 640;
/** The least room kept between the picker and the top, left and right edges of the window. */
const EDGE_GAP = 16;
/** The room between the picker and the button that opened it. */
const BUTTON_GAP = 4;

export interface PickerSize {
  width: number;
  height: number;
}

interface PickerPlace {
  top: number;
  left: number;
}

interface WindowSize {
  width: number;
  height: number;
}

/** The picker's size in a window of this size, the Swarm site's 300 by 350, smaller on a phone. */
export function pickerSize(window: WindowSize): PickerSize {
  if (window.width < PHONE_MAX_WIDTH) {
    return { width: Math.min(window.width - 2 * EDGE_GAP, 280), height: Math.min(window.height - 100, 300) };
  }
  return { width: 300, height: 350 };
}

/**
 * Where the picker opens beside the button that opened it: below the button, turned above it when the
 * window has no room below, and reaching towards the message's side of the chat, so it covers the
 * message rather than spilling out of the chat column. Kept at least the edge gap from the top, left and
 * right of the window.
 */
export function pickerPlace(
  button: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  size: PickerSize,
  window: WindowSize,
  ownMessage: boolean,
): PickerPlace {
  let top = button.bottom + BUTTON_GAP;
  if (top + size.height > window.height) {
    top = button.top - size.height - BUTTON_GAP;
  }

  let left = ownMessage ? button.left : button.right - size.width;
  if (left < EDGE_GAP) {
    left = button.left;
  }
  if (left + size.width > window.width) {
    left = window.width - size.width - EDGE_GAP;
  }

  return { top: Math.max(EDGE_GAP, top), left: Math.max(EDGE_GAP, left) };
}
