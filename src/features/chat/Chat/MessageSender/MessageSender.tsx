import { useRef, useState } from 'react';

import { refusalProblem } from '../../draftCheck';

import { ReactionToolbar } from './ReactionToolbar/ReactionToolbar';
import { useFieldStaysInView } from './useFieldStaysInView';

import './MessageSender.scss';

const KEY_ENTER = 'Enter';

interface MessageSenderProps {
  onSend: (text: string) => Promise<void>;
  /** Names the field for a screen reader: what is being written, a message or a reply. */
  label: string;
  placeholder: string;
  /** Why the chat would refuse this text, or null, so a draft it would refuse is never sent. */
  checkDraft?: (text: string) => string | null;
  /** Nothing can be sent now, as when the viewer's own stamp ran out. What is typed stays in the field. */
  isHeld?: boolean;
}

export function MessageSender({ onSend, label, placeholder, checkDraft, isHeld = false }: MessageSenderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useFieldStaysInView(inputRef);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const draft = input.trim();
  const draftRefusal = draft ? (checkDraft?.(draft) ?? null) : null;

  const send = async () => {
    const text = draft;
    if (!text || sending || draftRefusal || isHeld) {
      return;
    }
    setSending(true);
    setProblem(null);
    try {
      await onSend(text);
      setInput('');
    } catch (error) {
      setProblem(refusalProblem(error) ?? 'The message could not be sent. Try again.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === KEY_ENTER && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="message-sender-wrapper">
      <ReactionToolbar onEmojiSelect={(emoji) => setInput((previous) => previous + emoji)} />
      <div className="message-sender">
        <input
          ref={inputRef}
          type="text"
          name="message"
          value={input}
          aria-label={label}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          className="message-sender-input"
        />
        <button
          type="button"
          className="message-sender-send-button"
          aria-label="Send"
          disabled={sending || !draft || draftRefusal !== null || isHeld}
          onClick={() => void send()}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M.344.245A1 1 0 0 1 1.446.105l18 9a1 1 0 0 1 0 1.79l-18 9A1 1 0 0 1 .05 18.684L2.612 11H8a1 1 0 1 0 0-2H2.612L.05 1.316A1 1 0 0 1 .344.245Z"
            />
          </svg>
        </button>
      </div>
      {draftRefusal && (
        <p className="message-sender-problem" role="status">
          {draftRefusal}
        </p>
      )}
      {problem && !draftRefusal && (
        <p className="message-sender-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
