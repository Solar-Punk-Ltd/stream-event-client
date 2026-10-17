import type { BeeReading, StampReading } from './preflight.ts';

/** bee-compose's chain mines a block every five seconds. */
const BLOCK_SECONDS = 5;
/** How long a stamp the kit buys lasts, far longer than any run. */
const STAMP_DAYS = 7;

export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | false>,
  { timeoutMs = 300_000, intervalMs = 2000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${lastError ? `: ${String(lastError)}` : ''}`);
}

export async function json<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} answered ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

/** A node's readiness and its connected peers, or not ready when it does not answer. */
export async function readBee(name: string, url: string): Promise<BeeReading> {
  try {
    const ready = (await fetch(`${url}/readiness`, { signal: AbortSignal.timeout(5000) })).ok;
    const { peers } = await json<{ peers: unknown[] }>(`${url}/peers`, { timeoutMs: 5000 });
    return { name, ready, peers: peers.length };
  } catch {
    return { name, ready: false, peers: 0 };
  }
}

export async function overlayOf(url: string): Promise<string> {
  return (await json<{ overlay: string }>(`${url}/addresses`)).overlay;
}

/** The libp2p peer id in a node's underlay addresses, which bee-compose's workers dial the queen by. */
export async function peerIdOf(url: string): Promise<string | null> {
  const { underlay = [] } = await json<{ underlay?: string[] }>(`${url}/addresses`, { timeoutMs: 5000 });
  for (const address of underlay) {
    const match = address.match(/\/p2p\/([A-Za-z0-9]+)$/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Buys a mutable batch on the node, priced from the chain to last a week, and resolves once the node can stamp with
 * it. Mutable, because the chat inbox is one address re-stamped in its slot, which fills an immutable batch's bucket.
 */
export async function buyStamp(url: string, depth: number): Promise<string> {
  // A node reads the price from the chain some blocks after it is ready, and answers 0 until then.
  const currentPrice = await waitFor(
    'the node to read the storage price',
    async () => {
      const { currentPrice: price } = await json<{ currentPrice: string }>(`${url}/chainstate`);
      return BigInt(price) > 0n && price;
    },
    { timeoutMs: 180_000 },
  );
  const amount = BigInt(currentPrice) * BigInt((STAMP_DAYS * 86_400) / BLOCK_SECONDS) + 1n;
  const { batchID } = await json<{ batchID: string }>(`${url}/stamps/${amount}/${depth}`, {
    method: 'POST',
    headers: { immutable: 'false' },
    timeoutMs: 180_000,
  });
  await waitFor('the stamp to become usable', async () => (await readStamp('new', url, batchID)).usable, {
    timeoutMs: 300_000,
  });
  return batchID;
}

/** How full a batch is: its fullest bucket over the bucket's size, which is what runs out first. */
export async function readStamp(name: string, url: string, batchID: string): Promise<StampReading> {
  try {
    const stamp = await json<{ usable: boolean; utilization: number; depth: number; bucketDepth: number }>(
      `${url}/stamps/${batchID}`,
      { timeoutMs: 5000 },
    );
    return { name, usable: stamp.usable, usedFraction: stamp.utilization / 2 ** (stamp.depth - stamp.bucketDepth) };
  } catch {
    return { name, usable: false, usedFraction: 0 };
  }
}

/** Whether the node has seen the batch on chain, which it must before it takes a chunk stamped with it. */
export async function knowsBatch(url: string, batchID: string): Promise<boolean> {
  const { batches = [] } = await json<{ batches?: { batchID: string }[] }>(`${url}/batches`);
  return batches.some((batch) => batch.batchID.toLowerCase() === batchID.toLowerCase());
}

export async function chainId(url: string): Promise<string | null> {
  try {
    const answer = await json<{ result?: string }>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      timeoutMs: 5000,
    });
    return answer.result ?? null;
  } catch {
    return null;
  }
}

export async function metricsText(url: string): Promise<string> {
  const response = await fetch(`${url}/metrics`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url}/metrics answered ${response.status}`);
  return response.text();
}

/** Whether the chat server's `/health` body says a heartbeat of its own came back through the inbox. */
export function heartbeatBack(body: unknown): boolean {
  const seconds = (body as { secondsSinceHeartbeatReceived?: number | null } | null)?.secondsSinceHeartbeatReceived;
  return typeof seconds === 'number';
}

export async function healthStatus(url: string): Promise<{ status: number | null; body: unknown }> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON, kept as text
    }
    return { status: response.status, body };
  } catch {
    return { status: null, body: null };
  }
}
