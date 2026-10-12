import { describe, expect, it } from 'vitest';

import { pickerPlace, pickerSize } from '../../src/features/chat/Chat/EmojiPicker/pickerPlacement';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 700 };

function button(top: number, left: number) {
  return { top, bottom: top + 32, left, right: left + 32 };
}

describe('the emoji picker beside a message', () => {
  it('takes the Swarm site size on a desktop and a smaller one on a phone', () => {
    expect(pickerSize(DESKTOP)).toEqual({ width: 300, height: 350 });
    expect(pickerSize(PHONE)).toEqual({ width: 280, height: 300 });
  });

  it('opens below the button, reaching left for someone else message and right for the viewer own', () => {
    const size = pickerSize(DESKTOP);
    expect(pickerPlace(button(100, 1300), size, DESKTOP, false)).toEqual({ top: 136, left: 1032 });
    expect(pickerPlace(button(100, 1000), size, DESKTOP, true)).toEqual({ top: 136, left: 1000 });
  });

  it('turns above the button when the window has no room below', () => {
    const size = pickerSize(DESKTOP);
    expect(pickerPlace(button(800, 1300), size, DESKTOP, false).top).toBe(800 - 350 - 4);
  });

  it('stays inside the window on a phone', () => {
    const size = pickerSize(PHONE);
    const place = pickerPlace(button(600, 340), size, PHONE, true);
    expect(place.left + size.width).toBeLessThanOrEqual(PHONE.width - 16);
    expect(place.top).toBeGreaterThanOrEqual(16);
  });
});
