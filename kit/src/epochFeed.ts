/**
 * Reading Swarm ID's epoch feeds from Swarm with nothing but the feed's topic and owner, as anyone who finds a feed's
 * address can. The fork writes its device-state feed as an epoch feed, the format of its `proxy/feeds/epochs`: each
 * update is a single-owner chunk whose identifier hashes the topic with the epoch, and whose payload is a timestamp and
 * a reference to the data. The walk is the fork's `AsyncEpochFinder`.
 */
import { keccak256 } from 'viem';

export const MAX_LEVEL = 32;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** One epoch: a time span of 2^level seconds starting at `start`. */
export class EpochIndex {
  readonly start: bigint;
  readonly level: number;

  constructor(start: bigint, level: number) {
    this.start = start;
    this.level = level;
  }

  /** The 32 bytes the epoch contributes to an update's identifier: keccak256 of the start, big-endian, and the level. */
  hash(): Uint8Array {
    const buffer = new Uint8Array(9);
    new DataView(buffer.buffer).setBigUint64(0, this.start, false);
    buffer[8] = this.level;
    return keccak256(buffer, 'bytes');
  }

  length(): bigint {
    return 1n << BigInt(this.level);
  }

  left(): EpochIndex {
    return new EpochIndex(this.start - this.length(), this.level);
  }

  childAt(at: bigint): EpochIndex {
    const level = this.level - 1;
    const length = 1n << BigInt(level);
    return new EpochIndex((at & length) > 0n ? this.start | length : this.start, level);
  }

  isLeft(): boolean {
    return (this.start & this.length()) === 0n;
  }

  toString(): string {
    return `${this.start}/${this.level}`;
  }
}

/** The identifier of a feed update at `epoch`: keccak256 of the topic and the epoch's hash. */
export function epochIdentifier(topic: Uint8Array, epoch: EpochIndex): Uint8Array {
  return keccak256(new Uint8Array([...topic, ...epoch.hash()]), 'bytes');
}

/** The address of the single-owner chunk holding an update: keccak256 of the identifier and the owner. */
export function epochChunkAddress(identifier: Uint8Array, owner: Uint8Array): string {
  return toHex(keccak256(new Uint8Array([...identifier, ...owner]), 'bytes'));
}

/**
 * What an update points at: the data's address, and the key that opens it when the reference is an encrypted one. An
 * encrypted reference is 64 bytes, the address then the key, so a pointer that carries a key hands it to every reader.
 */
export interface EpochPointer {
  timestamp: bigint;
  address: string;
  key: string | null;
}

/** The payload lengths an update may have: a timestamp and a plain or encrypted reference, each with or without a span. */
const PLAIN = 40;
const ENCRYPTED = 72;
const SPAN = 8;

/** Reads an update's payload, or null for one of no known length. */
export function epochPointer(payload: Uint8Array): EpochPointer | null {
  const body = payload.length === PLAIN + SPAN || payload.length === ENCRYPTED + SPAN ? payload.slice(SPAN) : payload;
  if (body.length !== PLAIN && body.length !== ENCRYPTED) return null;
  const timestamp = new DataView(body.buffer, body.byteOffset, 8).getBigUint64(0, false);
  const reference = body.slice(8);
  return {
    timestamp,
    address: toHex(reference.slice(0, 32)),
    key: reference.length === 64 ? toHex(reference.slice(32)) : null,
  };
}

/** Reads the update at one epoch, or undefined when there is none at or before the time asked. */
type EpochFetch<T> = (epoch: EpochIndex) => Promise<T | undefined>;

async function walk<T>(
  at: bigint,
  epoch: EpochIndex,
  best: T | undefined,
  fetch: EpochFetch<T>,
): Promise<T | undefined> {
  const found = await fetch(epoch).catch(() => undefined);
  if (found === undefined) {
    return epoch.isLeft() || epoch.level >= MAX_LEVEL ? best : walk(epoch.start - 1n, epoch.left(), best, fetch);
  }
  return epoch.level === 0 ? found : walk(at, epoch.childAt(at), found, fetch);
}

/**
 * The newest update at or before `at`: the leaf at `at` itself when there is one, otherwise the walk from the root
 * epoch down through each epoch that holds an update.
 */
export async function findLatestPointer<T>(at: bigint, fetch: EpochFetch<T>): Promise<T | undefined> {
  const exact = await fetch(new EpochIndex(at, 0)).catch(() => undefined);
  return exact ?? walk(at, new EpochIndex(0n, MAX_LEVEL), undefined, fetch);
}
