import { PrivateKey } from '@ethersphere/bee-js';

import type { Addresses } from './addresses.ts';
import type { MediaType } from '../../src/shared/contracts/mediaType.ts';
import type { KitState } from './state.ts';

/** The addresses a scenario's browser side uses in both modes: the local stack's, or a real deployment's. */
export interface SiteAddresses {
  viewer: string;
  swarmId: string;
  /** The hostile site, which both modes serve from this machine. */
  evil: string;
  gateway: string;
  /** Every address the run uses, by its name, which the gate checks. */
  all(): Record<string, string>;
}

/** What the scenarios read of the deployment under test, the same in both modes. */
export interface Deployment {
  stream: { mediaType: MediaType; owner: string; topic: string; title: string };
  /** The chat feed's topic, `chat-<stream topic>` as the viewer names it. */
  chatTopic: string;
  /** The address the chat server writes every chat feed under, bare and lower case. */
  feedOwner: string;
  /** The address that owns the chat's inbox, bare and lower case, the first part of every inbox write's path. */
  inboxOwner: string;
  /** Where the viewer sends a message the gateway pays for. */
  chatWrite: string;
}

/** The stack `kit up` started: its addresses, and the values it generated. */
export interface LocalStack {
  addresses: Addresses;
  state: KitState;
}

/** The scenarios' view of the local stack. */
export function localDeployment(stack: LocalStack): Deployment {
  const { addresses, state } = stack;
  return {
    stream: { mediaType: 'video', owner: state.stream.owner, topic: state.stream.topic, title: state.stream.title },
    chatTopic: state.chatTopic,
    feedOwner: state.feedOwner.toLowerCase().replace(/^0x/, ''),
    inboxOwner: new PrivateKey(state.gsocKey).publicKey().address().toHex().toLowerCase(),
    chatWrite: addresses.gateway,
  };
}

/** The local stack a verb needs, or a refusal naming the verb when the run is against a real deployment. */
export function localStack(run: { local: LocalStack | null }, what: string): LocalStack {
  if (!run.local) throw new Error(`${what} needs the local stack, and live mode runs against a real deployment`);
  return run.local;
}

/**
 * The viewer's own Bee node for an actor: the local stack's worker-2 for everyone locally, and live the tunnel the
 * target names for that actor, or a refusal naming the field when it names none.
 */
export function ownNodeOf(
  run: { local: LocalStack | null; live: { ownNodes: Record<string, string> } | null },
  actor: string,
): string {
  if (run.local) return run.local.addresses.worker2;
  const node = run.live?.ownNodes[actor];
  if (!node) throw new Error(`${actor} needs an own Bee node, and the target names none for ${actor} in ownNodes`);
  return node;
}
