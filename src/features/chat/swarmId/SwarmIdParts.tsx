import { useEffect, useRef, useState } from 'react';

import { useThemeChoice } from '@/app/ThemeChoiceProvider';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { GuestBadgeIcon } from '@/shared/components/Icons/GuestBadgeIcon';
import { SwarmIdBadgeIcon } from '@/shared/components/Icons/SwarmIdBadgeIcon';

import { useChatUser } from '../User';

import {
  SWARM_ID_BUTTON_COMPACT,
  SWARM_ID_BUTTON_FULL,
  type SwarmIdButtonSize,
  swarmIdButtonLook,
} from './swarmIdButtonLook';
import type { SwarmIdButtonAction, SwarmIdMountedButton, SwarmIdWindowState } from './swarmIdClient';
import { SWARM_ID_SIGNED_OUT, SWARM_ID_STARTING, SWARM_ID_UNAVAILABLE } from './swarmIdSignIn';

import './SwarmIdParts.scss';

const SIGN_IN_LABEL = 'Sign in with Swarm ID';
const UNAVAILABLE_TEXT = 'Swarm ID cannot be reached right now.';
const STARTING_TEXT = 'Connecting to Swarm ID';
const WINDOW_BLOCKED = 'blocked';

interface SwarmIdButtonProps {
  readonly action: SwarmIdButtonAction;
  /** The label, in the design's words. Swarm ID's frame shows it and reads it out. */
  readonly text: string;
  /** Which of the page's own buttons it is drawn as, where the page drew one of its own before. */
  readonly variant?: ButtonVariant;
  readonly size?: SwarmIdButtonSize;
}

/**
 * Swarm ID's own button, a small frame of the Swarm ID site in this page. Its click opens the Swarm ID window, which a
 * site on another site than Swarm ID can open no other way, since a window the page opened could not hand the session
 * to Swarm ID's frame. It wears the page's button of that variant in the theme the page wears now, in the page's own
 * typeface, and is mounted once for as long as it is shown: a new label, action, variant or theme changes it in place. Taking it away keeps the session.
 */
export function SwarmIdButton({
  action,
  text,
  variant = ButtonVariant.PRIMARY,
  size = SWARM_ID_BUTTON_FULL,
}: SwarmIdButtonProps) {
  const { swarmId, mountSwarmIdButton } = useChatUser();
  const { look } = useThemeChoice();
  const container = useRef<HTMLSpanElement>(null);
  const mounted = useRef<SwarmIdMountedButton | null>(null);
  const [windowState, setWindowState] = useState<SwarmIdWindowState | null>(null);
  const [isRefused, setIsRefused] = useState(false);
  const isStarting = swarmId?.status === SWARM_ID_STARTING;
  const canMount = swarmId !== null && !isStarting && swarmId.status !== SWARM_ID_UNAVAILABLE;

  const wanted = useRef({ action, text, variant, size });
  wanted.current = { action, text, variant, size };
  /** What the frame was handed last, so a render that changes nothing it shows hands it nothing. */
  const handed = useRef('');

  useEffect(() => {
    const element = container.current;
    if (!canMount || !element) {
      return;
    }
    const { action: wantedAction, text: wantedText, variant: wantedVariant, size: wantedSize } = wanted.current;
    const options = { action: wantedAction, config: configOf(wantedText, wantedVariant, wantedSize) };
    const button = mountSwarmIdButton(element, { ...options, onWindowChange: setWindowState });
    if (!button) {
      return;
    }
    mounted.current = button;
    handed.current = JSON.stringify(options);
    let isCurrent = true;
    button.ready.catch(() => {
      if (isCurrent) {
        setIsRefused(true);
      }
    });
    return () => {
      isCurrent = false;
      mounted.current = null;
      button.unmount();
    };
  }, [canMount, mountSwarmIdButton]);

  useEffect(() => {
    const options = { action, config: configOf(text, variant, size) };
    const key = JSON.stringify(options);
    if (mounted.current && key !== handed.current) {
      handed.current = key;
      mounted.current.update(options);
    }
  }, [action, text, variant, size, look]);

  if (swarmId?.status === SWARM_ID_UNAVAILABLE || isRefused) {
    return <p className="swarm-id-hint">{UNAVAILABLE_TEXT}</p>;
  }
  return (
    <span className="swarm-id-button">
      <span ref={container} className={`swarm-id-button-frame ${size}`} hidden={!canMount} />
      {isStarting && <span className="swarm-id-hint">{STARTING_TEXT}</span>}
      {windowState === WINDOW_BLOCKED && <SwarmIdWindowBlocked />}
    </span>
  );
}

function configOf(text: string, variant: ButtonVariant, size: SwarmIdButtonSize) {
  return { text, ...swarmIdButtonLook(variant, size) };
}

/**
 * The browser refused the window Swarm ID's button opened, which happens only where pop-ups are blocked outright, since
 * the click was the frame's own. The page has no window of its own to offer, so it says what to allow.
 */
function SwarmIdWindowBlocked() {
  return (
    <span className="swarm-id-blocked" role="status">
      <strong>Your browser blocked the Swarm ID window.</strong>
      <span className="swarm-id-muted">Allow pop-ups for this site, then press the button again.</span>
    </span>
  );
}

/** Why the last sign-in did not get there, when it did not. */
function SignInProblem() {
  const { swarmId } = useChatUser();
  const problem = swarmId?.status === SWARM_ID_SIGNED_OUT ? swarmId.problem : null;
  return problem ? (
    <p className="swarm-id-problem" role="alert">
      {problem}
    </p>
  ) : null;
}

/** The second way into the chat, in Connect: sign in with a Swarm ID account. */
export function SwarmIdOffer() {
  const { swarmId } = useChatUser();
  if (!swarmId) {
    return null;
  }
  if (swarmId.status === SWARM_ID_UNAVAILABLE) {
    return <p className="swarm-id-hint">{UNAVAILABLE_TEXT}</p>;
  }
  return (
    <div className="swarm-id-offer">
      <p className="swarm-id-hint">
        Or sign in with your Swarm ID. Your messages carry its confirmed badge on every device, and you can send them
        with your own stamp.
      </p>
      <SwarmIdButton action="sign-in" text={SIGN_IN_LABEL} />
      <SignInProblem />
    </div>
  );
}

/**
 * Who the viewer is, in Connect: signed in with Swarm ID and able to sign out, or a guest who can leave and can show it
 * is really them by signing in.
 */
export function SwarmIdYou({ onLeave }: { onLeave: () => void }) {
  const { swarmId, swarmIdSession, guestSession, signOutOfSwarmId } = useChatUser();
  if (swarmIdSession) {
    return (
      <div className="swarm-id-you">
        <div className="swarm-id-row">
          <span className="swarm-id-who">
            <b className="swarm-id-name linked">{swarmIdSession.username}</b>
            <SwarmIdBadgeIcon />
            <span className="swarm-id-muted">Swarm ID · {swarmIdSession.accountName}</span>
          </span>
          <Button variant={ButtonVariant.SECONDARY} className="swarm-id-small" onClick={signOutOfSwarmId}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  if (!guestSession) {
    return null;
  }
  const canSignIn = swarmId !== null && swarmId.status !== SWARM_ID_UNAVAILABLE;
  return (
    <div className="swarm-id-you">
      <div className="swarm-id-row">
        <span className="swarm-id-who">
          <b className="swarm-id-name">{guestSession.username}</b>
          <GuestBadgeIcon />
          <span className="swarm-id-muted">Guest</span>
        </span>
        <Button variant={ButtonVariant.SECONDARY} className="swarm-id-small" onClick={onLeave}>
          Leave
        </Button>
      </div>
      {canSignIn && (
        <div className="swarm-id-row">
          <span className="swarm-id-hint">Show it&apos;s really you</span>
          <SwarmIdButton
            action="sign-in"
            text={SIGN_IN_LABEL}
            variant={ButtonVariant.SECONDARY}
            size={SWARM_ID_BUTTON_COMPACT}
          />
        </div>
      )}
      {canSignIn && <SignInProblem />}
    </div>
  );
}
