import { Bytes, ChunkBuilder, EthAddress, type Identifier, type PrivateKey } from '@ethersphere/bee-js';

import type { FreedomSwarm } from '../../src/swarm/providers/freedom/freedomSwarm';
import { singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';

/** A single-owner chunk as Freedom's node holds it, the wrapped chunk's span apart from its payload. */
interface FreedomSoc {
  readonly owner: string;
  readonly identifier: string;
  readonly signature: string;
  readonly span: bigint;
  readonly payload: Uint8Array;
  readonly address: string;
}

/** A single-owner chunk signed by `key`, wrapping a chunk of `payload` whose span is `span`, its length by default. */
export function signedSoc(
  key: PrivateKey,
  identifier: Identifier,
  payload: Uint8Array,
  span: bigint = BigInt(payload.length),
): FreedomSoc {
  const wrapped = new ChunkBuilder(span);
  wrapped.writer.buffer.set(payload);
  const signature = key.sign(Bytes.concat(identifier.toUint8Array(), wrapped.hash().toUint8Array()));
  const owner = key.publicKey().address().toHex();
  return {
    owner,
    identifier: identifier.toHex(),
    signature: signature.toHex(),
    span,
    payload,
    address: singleOwnerChunkAddress(identifier, owner),
  };
}

/** What a fake Freedom node holds. Owners and topics as lower-case hex without `0x`. */
export interface FreedomWorld {
  /** Each feed's entries by index, keyed `owner/topic`. */
  readonly feeds?: Readonly<Record<string, readonly Uint8Array[]>>;
  readonly socs?: readonly FreedomSoc[];
  /** Content-addressed chunks by address, as their payload, whose span is its length. */
  readonly chunks?: Readonly<Record<string, Uint8Array>>;
  /** Whole blobs by reference, as `swarm_readData` joins them. */
  readonly data?: Readonly<Record<string, Uint8Array>>;
}

/**
 * How the fake answers. `served` answers from its world, `silent` never answers a read, `faulty` fails every read as a
 * Bee error passed through, `rate-limited` refuses every read for the budget, `switched-off` fails every call as
 * Freedom does with Identity & Wallet off, and `node-stopped` fails every read as with its node not running.
 */
type FreedomBehaviour = 'served' | 'silent' | 'faulty' | 'rate-limited' | 'switched-off' | 'node-stopped';

/** Freedom's read budget for a site, in requests, over a fixed window that starts at the window's first read. */
interface FakeBudget {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly now: () => number;
}

export interface FakeFreedomOptions {
  readonly behaviour?: FreedomBehaviour;
  readonly connected?: boolean;
  /** Whether the viewer declines the connect prompt. */
  readonly declines?: boolean;
  /** Counted against every read as Freedom counts them. Unlimited when absent. */
  readonly budget?: FakeBudget;
  /** The most bytes `swarm_readData` returns before it refuses a blob as larger than the whole byte budget. */
  readonly maxDataBytes?: number;
}

export interface FakeFreedom extends FreedomSwarm {
  readonly calls: { readonly method: string; readonly params: Readonly<Record<string, unknown>> }[];
  behaviour: FreedomBehaviour;
  connected: boolean;
  /** Reads refused for the budget. */
  readonly refusals: number;
}

const READS = new Set([
  'swarm_readFeedEntry',
  'swarm_readSingleOwnerChunk',
  'swarm_readChunk',
  'swarm_readData',
  'swarm_listFeeds',
]);

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function rejection(code: number, message: string, data?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(data && { data }) });
}

const invalid = (reason: string, extra: Record<string, unknown> = {}) =>
  rejection(-32602, reason, { reason, ...extra });

/** A span as Freedom answers it: a number, or a BigInt past the safe integers. */
const spanOf = (span: bigint) => (span <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(span) : span);

/** A content-addressed chunk's address, for a world's `chunks`. */
export function contentAddressOf(payload: Uint8Array): string {
  const chunk = new ChunkBuilder(BigInt(payload.length));
  chunk.writer.buffer.set(payload);
  return chunk.hash().toHex();
}

/** A `window.swarm` as Freedom's shim and main process answer it, over a world a test builds. */
export function fakeFreedom(world: FreedomWorld = {}, options: FakeFreedomOptions = {}): FakeFreedom {
  const { budget, maxDataBytes = Infinity } = options;
  let bucket: { startedAtMs: number; requests: number } | null = null;
  let refusals = 0;

  const overBudget = (): boolean => {
    if (!budget) {
      return false;
    }
    const nowMs = budget.now();
    if (bucket === null || nowMs - bucket.startedAtMs >= budget.windowMs) {
      bucket = { startedAtMs: nowMs, requests: 0 };
    }
    bucket.requests += 1;
    return bucket.requests > budget.maxRequests;
  };

  const socOf = (params: Readonly<Record<string, unknown>>) =>
    world.socs?.find((soc) =>
      params.address !== undefined
        ? soc.address === String(params.address).toLowerCase()
        : soc.owner === new EthAddress(String(params.owner)).toHex() &&
          soc.identifier === String(params.identifier).toLowerCase(),
    );

  const answer = (method: string, params: Readonly<Record<string, unknown>>): unknown => {
    switch (method) {
      case 'swarm_readFeedEntry': {
        const entries = world.feeds?.[`${new EthAddress(String(params.owner)).toHex()}/${String(params.topic)}`] ?? [];
        if (params.index === undefined) {
          if (entries.length === 0) {
            throw invalid('feed_empty');
          }
          const index = entries.length - 1;
          return { data: base64(entries[index]), encoding: 'base64', index, nextIndex: index + 1 };
        }
        const index = Number(params.index);
        const entry = entries[index];
        if (!entry) {
          throw invalid('entry_not_found');
        }
        return { data: base64(entry), encoding: 'base64', index, nextIndex: index + 1 };
      }
      case 'swarm_readSingleOwnerChunk': {
        const soc = socOf(params);
        if (!soc) {
          throw invalid('chunk_not_found');
        }
        return {
          data: base64(soc.payload),
          encoding: 'base64',
          span: spanOf(soc.span),
          reference: soc.address,
          owner: `0x${soc.owner}`,
          identifier: soc.identifier,
          signature: soc.signature,
        };
      }
      case 'swarm_readChunk': {
        const reference = String(params.reference).toLowerCase();
        const payload = world.chunks?.[reference];
        if (payload) {
          return { data: base64(payload), encoding: 'base64', span: payload.length };
        }
        if (world.socs?.some((soc) => soc.address === reference)) {
          throw invalid('chunk_type_mismatch');
        }
        throw invalid('chunk_not_found');
      }
      case 'swarm_readData': {
        const bytes = world.data?.[String(params.reference).toLowerCase()];
        if (!bytes) {
          throw invalid('chunk_not_found');
        }
        if (bytes.length > maxDataBytes) {
          throw invalid('data_too_large', { limit: maxDataBytes, actual: bytes.length });
        }
        return { data: base64(bytes), encoding: 'base64' };
      }
      default:
        throw rejection(4200, `Unknown method: ${method}`);
    }
  };

  const fake: FakeFreedom = {
    isFreedomBrowser: true,
    calls: [],
    behaviour: options.behaviour ?? 'served',
    connected: options.connected ?? false,
    get refusals() {
      return refusals;
    },
    async request({ method, params = {} }) {
      fake.calls.push({ method, params });
      if (fake.behaviour === 'switched-off') {
        throw rejection(4900, 'Swarm provider is not available');
      }
      if (method === 'swarm_getCapabilities') {
        return {
          specVersion: '1.0',
          canPublish: false,
          reason: !fake.connected ? 'not-connected' : fake.behaviour === 'node-stopped' ? 'node-stopped' : null,
        };
      }
      if (method === 'swarm_requestAccess') {
        if (options.declines) {
          throw rejection(4001, 'User rejected the request');
        }
        fake.connected = true;
        return { connected: true, origin: 'https://viewer.example', capabilities: ['publish'] };
      }
      if (!READS.has(method)) {
        return answer(method, params);
      }
      if (fake.behaviour === 'rate-limited' || overBudget()) {
        refusals += 1;
        throw invalid('rate_limited', { windowMs: budget?.windowMs ?? 60_000, maxRequests: 120, maxBytes: 524_288 });
      }
      switch (fake.behaviour) {
        case 'silent':
          return new Promise(() => undefined);
        case 'faulty':
          throw rejection(-32603, 'Request failed with status code 500');
        case 'node-stopped':
          throw rejection(4900, 'Node not available: node-stopped', { reason: 'node-stopped' });
        default:
          return answer(method, params);
      }
    },
  };
  return fake;
}
