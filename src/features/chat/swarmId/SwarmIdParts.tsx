import { useId } from 'react';

import { useConnect } from '@/features/connect/ConnectContext';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import { GuestBadgeIcon } from '@/shared/components/Icons/GuestBadgeIcon';
import { SwarmIdBadgeIcon } from '@/shared/components/Icons/SwarmIdBadgeIcon';

import { useChatUser } from '../User';

import { SWARM_ID_BLOCKED, SWARM_ID_SIGNED_OUT, SWARM_ID_STARTING, SWARM_ID_UNAVAILABLE } from './swarmIdSignIn';

import './SwarmIdParts.scss';

const SIGN_IN_LABEL = 'Sign in with Swarm ID';
const UNAVAILABLE_TEXT = 'Swarm ID cannot be reached right now.';
const STARTING_TEXT = 'Connecting to Swarm ID';

/** Sign in with Swarm ID, which waits, and says why, while the library is still starting. */
function SignInButton({ variant, className }: { variant?: ButtonVariant; className?: string }) {
  const { swarmId, signInWithSwarmId } = useChatUser();
  const reasonId = useId();
  const isStarting = swarmId?.status === SWARM_ID_STARTING;
  return (
    <span className="swarm-id-sign-in">
      <Button
        variant={variant}
        className={className}
        disabled={isStarting}
        aria-describedby={isStarting ? reasonId : undefined}
        onClick={signInWithSwarmId}
      >
        {SIGN_IN_LABEL}
      </Button>
      {isStarting && (
        <span id={reasonId} className="swarm-id-hint">
          {STARTING_TEXT}
        </span>
      )}
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

/**
 * The one line shown when the browser blocked the Swarm ID window. Its button is a click of its own, which is what
 * lets the browser open the window this time.
 */
function SwarmIdBlocked() {
  const { swarmId, signInWithSwarmId } = useChatUser();
  if (swarmId?.status !== SWARM_ID_BLOCKED) {
    return null;
  }
  return (
    <div className="swarm-id-blocked" role="status">
      <strong>Your browser blocked the Swarm ID window.</strong>
      <span className="swarm-id-muted">Open it with this button.</span>
      <Button className="swarm-id-small" onClick={signInWithSwarmId}>
        Open Swarm ID
      </Button>
    </div>
  );
}

/** The blocked line under the header, where Connect is not already showing it. */
export function SwarmIdPageNotice() {
  const { isOpen } = useConnect();
  return isOpen ? null : <SwarmIdBlocked />;
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
        Or sign in with your Swarm ID. Your messages carry its confirmed badge on every device.
      </p>
      <SignInButton />
      <SignInProblem />
      <SwarmIdBlocked />
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
          <SignInButton variant={ButtonVariant.SECONDARY} className="swarm-id-small" />
        </div>
      )}
      {canSignIn && <SignInProblem />}
    </div>
  );
}
