import { useEffect, useId, useRef, useState } from 'react';

import { useThemeChoice } from '@/app/ThemeChoiceProvider';
import { ShortAddress } from '@/shared/components/Address/ShortAddress';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { Spinner } from '@/shared/components/Spinner/Spinner';
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
const SLOW_TEXT = 'Swarm ID is taking longer than usual.';
/** How long the button may wait for Swarm ID before the page says, in words anyone sees, that it is slow. */
const SLOW_AFTER_MS = 30_000;
const WINDOW_BLOCKED = 'blocked';
const SWARM_ID_NAME = 'Swarm ID';
const PUBLIC_ADDRESS_LABEL = 'public address';
const ACCOUNT_LABEL = 'Swarm ID account';

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
  /** Whether the mounted frame said it shows its button, until which the placeholder stands over it. */
  const [isShown, setIsShown] = useState(false);
  /** Raised by Try again, which mounts a new button in place of one Swarm ID refused or that never answered. */
  const [attempt, setAttempt] = useState(0);
  const startingId = useId();
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
    button.ready.then(
      () => {
        if (isCurrent) {
          setIsShown(true);
        }
      },
      () => {
        if (isCurrent) {
          setIsRefused(true);
        }
      },
    );
    return () => {
      isCurrent = false;
      mounted.current = null;
      button.unmount();
      setIsRefused(false);
      setIsShown(false);
    };
  }, [canMount, mountSwarmIdButton, attempt]);

  useEffect(() => {
    const options = { action, config: configOf(text, variant, size) };
    const key = JSON.stringify(options);
    if (mounted.current && key !== handed.current) {
      handed.current = key;
      mounted.current.update(options);
    }
  }, [action, text, variant, size, look]);

  const isUnavailable = swarmId?.status === SWARM_ID_UNAVAILABLE;
  const isWaiting = !isShown && !isRefused && !isUnavailable;
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isWaiting) {
      return;
    }
    const timer = setTimeout(() => setIsSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setIsSlow(false);
    };
  }, [isWaiting]);

  // The slot stays while the hints show, so the button's place does not jump while Swarm ID starts, and a refused
  // frame is taken away by its own unmount rather than with a container React removed under it. Until the frame
  // shows its button, a placeholder in the page's own look of that button stands over it. An unseen copy of the label
  // keeps the slot at least as wide as the label, since the frame and the placeholder over it give the slot no width.
  return (
    <span className="swarm-id-button">
      <span className={`swarm-id-button-slot ${size}`} hidden={isUnavailable || isRefused}>
        <span className={`button ${variant} swarm-id-button-sizer`} aria-hidden="true">
          {text}
        </span>
        <span ref={container} className="swarm-id-button-frame" aria-hidden={canMount ? undefined : true} />
        {isWaiting && (
          <span className={`button ${variant} swarm-id-button-placeholder`} role="img" aria-labelledby={startingId}>
            <Spinner />
            {text}
          </span>
        )}
      </span>
      <span className={isSlow ? 'swarm-id-status slow' : 'swarm-id-status'} role="status">
        {isWaiting && (
          <span id={startingId} className="swarm-id-spoken">
            {STARTING_TEXT}
          </span>
        )}
        {isSlow && <span className="swarm-id-hint">{SLOW_TEXT}</span>}
      </span>
      {(isUnavailable || isRefused) && <span className="swarm-id-hint">{UNAVAILABLE_TEXT}</span>}
      {isRefused && (
        <Button
          variant={ButtonVariant.SECONDARY}
          className="swarm-id-small"
          onClick={() => setAttempt((count) => count + 1)}
        >
          Try again
        </Button>
      )}
      {windowState === WINDOW_BLOCKED && <SwarmIdWindowBlocked />}
    </span>
  );
}

/** The label is also the accessible name, so each frame's button is named by what it does here. */
function configOf(text: string, variant: ButtonVariant, size: SwarmIdButtonSize) {
  return { text, ariaLabel: text, ...swarmIdButtonLook(variant, size) };
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
    const { username, accountName, address, account } = swarmIdSession;
    return (
      <div className="swarm-id-you">
        <div className="swarm-id-row">
          <span className="swarm-id-who">
            <b className="swarm-id-name linked">{username}</b>
            <SwarmIdBadgeIcon />
            <span className="swarm-id-muted">
              {accountName && accountName !== username ? `${SWARM_ID_NAME} · ${accountName}` : SWARM_ID_NAME}
            </span>
          </span>
          <Button variant={ButtonVariant.SECONDARY} className="swarm-id-small" onClick={signOutOfSwarmId}>
            Sign out
          </Button>
        </div>
        <dl className="swarm-id-addresses">
          <dt>Public address</dt>
          <dd>
            <ShortAddress value={address} label={PUBLIC_ADDRESS_LABEL} />
          </dd>
          <dt>Swarm ID account</dt>
          <dd>
            <ShortAddress value={account} label={ACCOUNT_LABEL} />
          </dd>
        </dl>
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
