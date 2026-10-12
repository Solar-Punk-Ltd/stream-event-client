import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';

import type { PickerSize } from './pickerPlacement';

import './EmojiPicker.scss';

interface EmojiPickerPanelProps {
  onPick: (emoji: string) => void;
  /** Opens on the library's bar of common emoji, whose last button shows every emoji in place. */
  startsAsReactionBar?: boolean;
  size?: PickerSize;
  focusesSearch?: boolean;
}

/** The emoji picker library, in a file of its own so it downloads only when a picker is first drawn. */
export default function EmojiPickerPanel({
  onPick,
  startsAsReactionBar = false,
  size,
  focusesSearch = false,
}: EmojiPickerPanelProps) {
  return (
    <EmojiPicker
      theme={Theme.DARK}
      emojiStyle={EmojiStyle.NATIVE}
      previewConfig={{ showPreview: false }}
      lazyLoadEmojis
      skinTonesDisabled
      autoFocusSearch={focusesSearch}
      reactionsDefaultOpen={startsAsReactionBar}
      width={size?.width}
      height={size?.height}
      onEmojiClick={(data) => onPick(data.emoji)}
    />
  );
}
