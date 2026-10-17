import { bareHex } from './hex.ts';

/** Bee's header for a stamp made outside the node, which a stamped upload carries whole and which spends its batch. */
const POSTAGE_STAMP_HEADER = 'swarm-postage-stamp';
/**
 * Bee's header naming a batch for the node to stamp with. The viewer sends a placeholder one to the event's gateway,
 * which puts its own batch in its place, so only a batch of the person's own spends their drive.
 */
const POSTAGE_BATCH_HEADER = 'swarm-postage-batch-id';

interface ConnectionUpdate {
  type?: string;
  identity?: { id?: string };
  chatBinding?: { message?: string };
  postageBatchId?: string;
}

/** A HAR entry as Playwright records it: the page it belongs to and what kind of resource it fetched. */
interface HarEntry {
  pageref?: string;
  _resourceType?: string;
  request?: { method?: string; url?: string; headers?: { name: string; value?: string }[] };
}

interface Har {
  log?: { entries?: HarEntry[] };
}

/** What the viewer's pages sent with a stamp, and how many viewer pages the recording held to look in. */
interface ViewerStampedRequests {
  viewerPages: number;
  stamped: string[];
}

/**
 * The stamp each of Swarm ID's connection updates named to the viewer, oldest first, `null` for none. Read from what
 * the viewer's window was sent, one message a line, so it is what Swarm ID's frame told the site and not what the
 * viewer's page made of it. An update without an identity is not a session and is left out.
 */
export function stampsNamedToViewer(received: string): (string | null)[] {
  const named: (string | null)[] = [];
  for (const line of received.split('\n')) {
    let message: ConnectionUpdate;
    try {
      message = JSON.parse(line) as ConnectionUpdate;
    } catch {
      continue;
    }
    if (message?.type === 'connectionInfoChanged' && message.identity) named.push(message.postageBatchId ?? null);
  }
  return named;
}

/** The account and the site's chat address Swarm ID's frame reported to a site, bare and lower case. */
interface FrameIdentity {
  account: string;
  /** From the chat binding's `Chat address:` line, null when the update carried no binding. */
  chatAddress: string | null;
}

const CHAT_ADDRESS_LINE = /^Chat address: (0x[0-9a-fA-F]{40})$/m;

/**
 * Who Swarm ID's last connection update with an identity told the site the person is: the account id, and the chat
 * address the account bound to the site, read from what the site's window was sent, one message a line.
 */
export function frameIdentity(received: string): FrameIdentity | null {
  let last: ConnectionUpdate | undefined;
  for (const line of received.split('\n')) {
    try {
      const message = JSON.parse(line) as ConnectionUpdate;
      if (message?.type === 'connectionInfoChanged' && message.identity) last = message;
    } catch {
      continue;
    }
  }
  if (!last?.identity?.id) return null;
  const chat = last.chatBinding?.message?.match(CHAT_ADDRESS_LINE)?.[1];
  return { account: bareHex(last.identity.id), chatAddress: chat ? bareHex(chat) : null };
}

/** What Swarm ID's last connection update with an identity told the viewer of the actor's wallet. */
export type WalletLinkSeen = 'no update' | 'update carried wallet' | 'update carried no wallet';

/**
 * Whether the last connection update with an identity the viewer's window was sent carries `wallet`, read the way
 * `stampsNamedToViewer` reads the stamps, from one message a line.
 */
export function walletLinkSeen(received: string, wallet: string): WalletLinkSeen {
  const bare = wallet.toLowerCase().replace(/^0x/, '');
  let last: string | undefined;
  for (const line of received.split('\n')) {
    let message: ConnectionUpdate;
    try {
      message = JSON.parse(line) as ConnectionUpdate;
    } catch {
      continue;
    }
    if (message?.type === 'connectionInfoChanged' && message.identity) last = line;
  }
  if (last === undefined) return 'no update';
  return last.toLowerCase().includes(bare) ? 'update carried wallet' : 'update carried no wallet';
}

function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every request a viewer page sent with a postage stamp, or naming one of `drives` for Bee to stamp with, as
 * `<method> <url>`, from a HAR of the actor's whole browser.
 * A viewer page is a page that loaded a document from the viewer's origin, and its requests include those of the
 * Swarm ID frames embedded in it, which act for the viewer's site. Swarm ID's own windows are left out: there the
 * identity app stamps the account's own state and backups with the account's drive, which is the account's
 * housekeeping and not a site spending the drive.
 */
export function stampedRequests(har: string, viewerOrigin: string, drives: string[]): ViewerStampedRequests {
  const ownBatches = new Set(drives.map((drive) => drive.toLowerCase().replace(/^0x/, '')));
  const spends = (header: { name: string; value?: string }) => {
    const name = header.name.toLowerCase();
    if (name === POSTAGE_STAMP_HEADER) return true;
    return name === POSTAGE_BATCH_HEADER && ownBatches.has((header.value ?? '').toLowerCase().replace(/^0x/, ''));
  };
  const entries = (JSON.parse(har) as Har).log?.entries ?? [];
  const viewer = originOf(viewerOrigin);
  const pages = new Set(
    entries
      .filter((entry) => entry._resourceType === 'document' && originOf(entry.request?.url) === viewer)
      .map((entry) => entry.pageref),
  );
  pages.delete(undefined);
  const stamped = entries
    .filter((entry) => pages.has(entry.pageref))
    .map((entry) => entry.request)
    .filter((request) => request?.headers?.some(spends))
    .map((request) => `${request?.method} ${request?.url}`);
  return { viewerPages: pages.size, stamped };
}

/** Where a viewer's chat writes go, and the address that owns the chat's inbox. */
interface WritePlaces {
  viewer: string;
  /** The chat's write address on the event's gateway, which may serve the inbox at a path, such as `/chat`. */
  gateway: string;
  /** The viewer's own Bee node, which a live run against a real deployment has none of. */
  ownNode: string | null;
  /** The inbox's owner address, 40 hex digits, the first part of every inbox write's `/soc/` path. */
  inboxOwner: string;
}

/** How an actor's messages were sent: the gateway sends, and the own-stamp sends by the drive each was to spend. */
interface Sends {
  gateway: number;
  ownStamp: Record<string, number>;
}

/** A stamp made outside Bee starts with the 32-byte batch id it spends, as hex. */
const BATCH_ID_HEX_LENGTH = 64;

/**
 * What the recorded network says against how an actor's messages were paid: every gateway send needs an inbox write
 * to the event's gateway, and every own-stamp send one to the actor's own node carrying a stamp of the drive that send
 * was to spend, from the viewer's pages. Each drive is counted apart, and an inbox write on a drive no send was to
 * spend is named. A drive may carry more writes than sends, since the chat writes a message again while it is not read
 * back. The bodies are not recorded, so writes are counted rather than matched to their texts.
 */
export function paidAsSentProblems(har: string, places: WritePlaces, sends: Sends): string[] {
  const entries = (JSON.parse(har) as Har).log?.entries ?? [];
  const viewer = originOf(places.viewer);
  const pages = new Set(
    entries
      .filter((entry) => entry._resourceType === 'document' && originOf(entry.request?.url) === viewer)
      .map((entry) => entry.pageref),
  );
  const inboxPath = (place: string) => `${place.replace(/\/+$/, '')}/soc/${places.inboxOwner}/`.toLowerCase();
  const writesUnder = (place: string) =>
    entries
      .filter((entry) => pages.has(entry.pageref) && entry.request?.method === 'POST')
      .map((entry) => entry.request!)
      .filter((request) => request.url?.toLowerCase().startsWith(inboxPath(place)));
  const toGateway = writesUnder(places.gateway).length;
  const onDrives = new Map<string, number>();
  for (const request of places.ownNode === null ? [] : writesUnder(places.ownNode)) {
    const stamp = request.headers?.find((header) => header.name.toLowerCase() === POSTAGE_STAMP_HEADER)?.value;
    if (!stamp) continue;
    const drive = stamp.toLowerCase().slice(0, BATCH_ID_HEX_LENGTH);
    onDrives.set(drive, (onDrives.get(drive) ?? 0) + 1);
  }
  const expected = new Map(Object.entries(sends.ownStamp).map(([drive, count]) => [drive.toLowerCase(), count]));
  const problems: string[] = [];
  if (toGateway < sends.gateway)
    problems.push(`${sends.gateway} gateway sends, ${toGateway} inbox writes to the gateway`);
  for (const [drive, count] of expected) {
    const written = onDrives.get(drive) ?? 0;
    if (written < count) {
      problems.push(
        `${count} own-stamp sends on drive ${drive}, ${written} inbox writes to the own node stamped with it`,
      );
    }
  }
  for (const [drive, written] of onDrives) {
    if (!expected.has(drive)) {
      problems.push(`${written} inbox writes to the own node stamped with drive ${drive}, which no send was to spend`);
    }
  }
  return problems;
}
