import { type KeyboardEvent, useId, useState } from 'react';

import { useThemeChoice } from '@/app/ThemeChoiceProvider';
import { SwarmIdOffer, SwarmIdYou } from '@/features/chat/swarmId/SwarmIdParts';
import { useChatUser } from '@/features/chat/User';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';

import { ThemeOptions } from './ThemeOptions';

const KEY_ENTER = 'Enter';

interface IdSectionProps {
  /** Asks the viewer to confirm before a guest leaves, which forgets the name. */
  readonly onLeave: () => void;
}

/**
 * Who the viewer is in the chat. Not chatting: a guest name, and signing in with Swarm ID where the deployment offers
 * it. Chatting: the name with its badge, signing out or leaving, and the theme switcher where the deployment allows it.
 */
export function IdSection({ onLeave }: IdSectionProps) {
  const { session } = useChatUser();
  const { canSwitch } = useThemeChoice();

  if (session === null) {
    return (
      <>
        <GuestForm />
        <SwarmIdOffer />
      </>
    );
  }
  return (
    <>
      <SwarmIdYou onLeave={onLeave} />
      {canSwitch && <ThemeOptions />}
    </>
  );
}

/** Chat as a guest with just a name, which this browser keeps with a key of its own. */
function GuestForm() {
  const { loginAsUser } = useChatUser();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const hintId = useId();
  const problemId = useId();

  const join = () => {
    const result = loginAsUser(name);
    setProblem(result.ok ? null : result.problem);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === KEY_ENTER && !event.nativeEvent.isComposing) {
      event.preventDefault();
      join();
    }
  };

  return (
    <div className="connect-parts">
      <p className="connect-hint" id={hintId}>
        Chat as a guest with just a name.
      </p>
      <div className="connect-inline connect-guest">
        <input
          className="connect-input"
          type="text"
          value={name}
          placeholder="Your name"
          aria-label="Your name"
          aria-describedby={`${hintId} ${problemId}`}
          aria-invalid={problem !== null}
          autoComplete="nickname"
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
        />
        <Button variant={ButtonVariant.SECONDARY} className="connect-small" onClick={join}>
          Chat as guest
        </Button>
      </div>
      <p className="connect-problem" id={problemId} role="alert">
        {problem}
      </p>
    </div>
  );
}
