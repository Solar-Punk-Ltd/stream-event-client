import { type KeyboardEvent, useId, useState } from 'react';

import { useThemeChoice } from '@/app/ThemeChoiceProvider';
import { SwarmIdOffer, SwarmIdYou } from '@/features/chat/swarmId/SwarmIdParts';
import { useChatUser } from '@/features/chat/User';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';

import { ThemeOptions } from './ThemeOptions';

const KEY_ENTER = 'Enter';

const GUEST_ADVICE = 'For the smoothest experience, go with the defaults and a simple name.';

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
        <BetaIntro />
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
  const adviceId = useId();
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
          aria-describedby={`${hintId} ${adviceId} ${problemId}`}
          aria-invalid={problem !== null}
          autoComplete="nickname"
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
        />
        <Button variant={ButtonVariant.SECONDARY} onClick={join}>
          Chat as guest
        </Button>
      </div>
      <p className="connect-hint" id={adviceId}>
        {GUEST_ADVICE}
      </p>
      <p className="connect-problem" id={problemId} role="alert">
        {problem}
      </p>
    </div>
  );
}

/** Above Swarm ID and the sources: the settings below it are a beta test, and a guest with the defaults needs none of them. */
function BetaIntro() {
  return (
    <div className="connect-beta">
      <p className="connect-beta-title">Beta: Swarm ID and your own way into Swarm</p>
      <p className="connect-hint">
        Want to help us test Swarm ID and choosing how you reach the Swarm network? The settings below are for you.
      </p>
      <p className="connect-hint">
        This part is an experiment. You sign in with an identity you hold yourself, and you pick where the stream and
        the chat come from: the event&apos;s gateway, your own Bee node, or Weeb3, a Swarm node running in this tab.
        Some of it may be slow, and some of it may break. Every try helps build apps that run fully on Swarm and give
        you back control of your identity and your access. Thank you for being part of it.
      </p>
    </div>
  );
}
