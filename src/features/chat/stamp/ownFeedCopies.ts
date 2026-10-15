/** How many times one copy is tried, the first try included, before it is given up. */
export const OWN_COPY_ATTEMPTS = 3;
/** The wait between two tries of one copy. */
export const OWN_COPY_RETRY_MS = 3_000;

export const COPIED = 'copied';
export const NOT_COPIED = 'not-copied';

export type CopyOutcome = typeof COPIED | typeof NOT_COPIED;

interface OwnFeedPlaces {
  /** The index after the feed's newest entry, 0 for an empty feed. Rejects when the feed could not be looked up. */
  readonly nextIndex: () => Promise<number>;
  /** Writes one copy at one index of the feed. */
  readonly writeAt: (index: number, payload: Uint8Array) => Promise<void>;
}

interface OwnFeedCopies {
  /** The copy beside a message being sent: tried once per message, however often the chat sends it again. */
  copyBeside(id: string, payload: Uint8Array): Promise<CopyOutcome>;
  /** A copy the viewer asked for, tried again even when it was given up before. */
  copy(id: string, payload: Uint8Array): Promise<CopyOutcome>;
}

interface PlacedCopy {
  readonly id: string;
  readonly payload: Uint8Array;
  index: number | null;
}

/**
 * The copies in the sender's own feed, one entry per message at indices 0, 1, 2 and on, written one at a time, each
 * tried {@link OWN_COPY_ATTEMPTS} times {@link OWN_COPY_RETRY_MS} apart. The newest index is looked up once and counted
 * on from there. Never resolves to anything but an outcome, so a copy cannot fail the message beside it.
 *
 * A copy given an index keeps it until it is written there. Its write may have landed although it reported a failure,
 * so no other copy is ever written at that index, and the next copy writes it again there first. The feed then never
 * holds two different copies at one index, and never a gap that a later lookup of its newest entry would stop at.
 * Another tab or device writing the same feed at once can still take the same index, which one device at a time avoids.
 */
export function ownFeedCopies(places: OwnFeedPlaces): OwnFeedCopies {
  const copied = new Set<string>();
  const besides = new Map<string, Promise<CopyOutcome>>();
  let next: number | null = null;
  let unconfirmed: PlacedCopy | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function tryWriting(copy: PlacedCopy): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        if (copy.index === null) {
          copy.index = next ?? (await places.nextIndex());
          unconfirmed = copy;
        }
        await places.writeAt(copy.index, copy.payload);
        copied.add(copy.id);
        next = copy.index + 1;
        unconfirmed = null;
        return true;
      } catch {
        if (attempt >= OWN_COPY_ATTEMPTS) {
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, OWN_COPY_RETRY_MS));
      }
    }
  }

  async function copyNow(id: string, payload: Uint8Array): Promise<CopyOutcome> {
    if (copied.has(id)) {
      return COPIED;
    }
    if (unconfirmed !== null && unconfirmed.id !== id && !(await tryWriting(unconfirmed))) {
      return NOT_COPIED;
    }
    const copy = unconfirmed?.id === id ? unconfirmed : { id, payload, index: null };
    return (await tryWriting(copy)) ? COPIED : NOT_COPIED;
  }

  function copy(id: string, payload: Uint8Array): Promise<CopyOutcome> {
    const outcome = queue.then(() => copyNow(id, payload));
    queue = outcome;
    return outcome;
  }

  return {
    copyBeside(id, payload) {
      const tried = besides.get(id) ?? copy(id, payload);
      besides.set(id, tried);
      return tried;
    },
    copy,
  };
}
