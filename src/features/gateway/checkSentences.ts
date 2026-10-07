/**
 * What the control panel's Test tells a viewer about each check, one plain sentence each, with the fix
 * they can make when a check fails. Kept apart from the checks so every sentence has a test of its own
 * and a new way of failing cannot ship without its words.
 */
import type { SwarmAnswer } from '@/swarm/answers';
import type { BeeNodeAccess } from '@/swarm/beeNodeAccess';
import type { ProbeResult } from '@/swarm/provider';

/** Every way a read can end that is not the content it asked for. */
export type FailedAnswer = Exclude<SwarmAnswer, { kind: 'content' }>;

const PICK_ANOTHER = 'Test again in a minute, or pick another gateway.';

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/**
 * A browser reports a closed port, a wrong address, a node that refuses this site's origin and an address
 * this site's content security policy leaves out the same way, so the sentence names all of them in the
 * order a viewer can check them.
 */
export const COULD_NOT_REACH =
  "Could not reach this gateway. Check that the address is right and the node is running. If it is, this node does not allow this site: its cors-allowed-origins setting has to include it. Or this site's own policy does not allow the address, which only whoever runs the site can change.";

export const NOT_A_SWARM_GATEWAY =
  'This address is not a Swarm gateway: something answered, but not with Swarm content. Check the address and the port.';

export const MIXED_CONTENT =
  'This site is served over https, and a browser refuses to load anything over plain http from it. Give the node an https address, or open this site over http.';

/** Why a read failed and what the viewer can do about it. `what` names the content, such as "the stream list". */
export function failedReadSentence(what: string, answer: FailedAnswer): string {
  switch (answer.kind) {
    case 'not-found':
      return `This gateway answered that ${what} is not there. It may not have found it on the network yet. ${PICK_ANOTHER}`;
    case 'rate-limited':
      return 'This gateway asked to be asked less often. Wait a minute, then test again.';
    case 'unsupported':
      return `This kind of gateway cannot read ${what}. Pick another gateway for it.`;
    case 'aborted':
      return 'The test was stopped before it finished.';
    case 'unavailable':
      switch (answer.cause.kind) {
        case 'timeout':
          return `The gateway did not answer in ${seconds(answer.cause.timeoutMs)}. It may be busy or still starting. ${PICK_ANOTHER}`;
        case 'status':
          return `The gateway answered with an error (HTTP ${answer.cause.status}). ${PICK_ANOTHER}`;
        case 'network':
          return COULD_NOT_REACH;
      }
  }
}

/**
 * The connection of a gateway the deployment offers, which answered the Test's reads. Such a gateway serves
 * the event's content and nothing else, so it is not asked for a node's health, which it would refuse.
 */
export const CONNECTED_BY_CONTENT =
  "The gateway answered. It serves only the event's content, so the Test reads that content rather than asking for the node's health.";

/** What asking the gateway whether it is there found, success included. */
export function probeSentence(result: ProbeResult, timeoutMs: number): string {
  switch (result.kind) {
    case 'ok':
      return `The gateway answered in ${result.elapsedMs} ms.`;
    case 'not-swarm':
      return NOT_A_SWARM_GATEWAY;
    case 'rejected':
      return `Something answered at this address with an error (HTTP ${result.status}). Check the address and the port.`;
    case 'timed-out':
      return `The gateway did not answer in ${seconds(timeoutMs)}. It may be busy or still starting. ${PICK_ANOTHER}`;
    case 'unreachable':
      return COULD_NOT_REACH;
  }
}

/** Why a check was not run, which is never the gateway's fault. */
export const SKIPPED = {
  noStreams: 'Not tested: the stream list has no stream to test with.',
  noPlayable: 'Not tested: no stream in the list has video yet.',
  noPicture: 'Not tested: no stream in the list has a picture.',
  noChat: 'Not tested: this site has no chat.',
  chatElsewhere:
    "Not tested: the chat reads from the event's chat address, whichever gateway is in use, so only your own node is checked for it.",
} as const;

/**
 * Why the chat was not passed when the gateway found no feed for it. The stream list does not say which
 * streams have a chat, so a feed that is not there may be a chat nobody wrote in or one this gateway has
 * not found, and neither proves the gateway can read the chat.
 */
export const CHAT_FEED_NOT_FOUND = (title: string) =>
  `Not tested: this gateway found no chat feed for ${titled(title)}. Nobody may have written in it yet, or the gateway has not found it on the network. Test again once the chat has messages.`;

/** The quoted title a sentence names a stream by. */
export const titled = (title: string) => `“${title}”`;

export const PASSED = {
  streamList: (streams: number, index: number | null) =>
    `The stream list loaded: ${streams === 1 ? '1 stream' : `${streams} streams`}${index === null ? '' : `, entry ${index}`}.`,
  playerByMarker: (title: string) =>
    `The video loaded: the time marker of ${titled(title)}, a playlist and one segment.`,
  playerByEntry: (title: string) => `The video loaded: a playlist of ${titled(title)} and one segment.`,
  previews: (title: string) => `Previews loaded: the preview playlist of ${titled(title)}.`,
  picture: (title: string) => `Pictures loaded: the picture of ${titled(title)}.`,
  chat: (title: string) => `The chat loaded: the newest message of ${titled(title)}.`,
} as const;

/** A playlist that names no segment proves the gateway answered and nothing about whether video loads. */
export const NO_SEGMENT = (title: string) =>
  `The playlist of ${titled(title)} names no segment, so no video could be loaded from it. Test again in a minute.`;

/** The address the picker suggests for a node on this computer, as Swarm Desktop runs it. */
const THIS_COMPUTER_EXAMPLE = 'http://localhost:1633';

const THIS_COMPUTER_HOSTS = 'localhost or 127.0.0.1';

/** What the picker says a node of the viewer's own may be, for each level the deployment may set. */
export const OWN_NODE_DESCRIPTION: Readonly<Record<BeeNodeAccess, string>> = {
  off: 'A Bee node on this computer, for example Swarm Desktop. Change the port if yours is not 1633.',
  https:
    'A Bee node on this computer, for example Swarm Desktop, or one on another machine at an https address. Change the port if yours is not 1633.',
  'https-and-local-http':
    'A Bee node on this computer, for example Swarm Desktop, one on another machine at an https address, or one on your local network over plain http in Chrome or Edge. Change the port if yours is not 1633.',
};

/** Why the picker will not use what a viewer typed, each with what to type instead. */
export const ADDRESS_REFUSED = {
  notHttp: 'The address has to start with http:// or https://.',
  empty: `Enter the address of your Bee node, for example ${THIS_COMPUTER_EXAMPLE}.`,
  notAnAddress: `That is not an address. Enter one such as ${THIS_COMPUTER_EXAMPLE}.`,
  notJustTheOrigin: `Enter only the scheme, host and port, such as ${THIS_COMPUTER_EXAMPLE}.`,
  thisComputerOnly: `Only a Bee node on this computer can be used here, at ${THIS_COMPUTER_HOSTS}.`,
  ipv6Loopback: `This site cannot use the address [::1]. Use localhost or 127.0.0.1 with your node's port instead, such as ${THIS_COMPUTER_EXAMPLE}.`,
  otherLoopbackHost: `A node on this computer has to be named ${THIS_COMPUTER_HOSTS}, because this site allows only those. Use ${THIS_COMPUTER_EXAMPLE} with your node's port.`,
  localHttpNotAllowed: `This site does not allow plain http to a node on your local network. Enter the node's https address instead, or run the node on this computer and use ${THIS_COMPUTER_EXAMPLE}.`,
  plainHttpInternet:
    "A browser blocks plain http to a node on the internet from a site served over https. Enter the node's address starting with https:// instead.",
} as const;
