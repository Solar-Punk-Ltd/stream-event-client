import { Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { PROOF_CATALOG, PROOF_STREAM_TITLE, proofBootnodes, proofGatewayAnswer } from '../e2e/proofStreamList';
import { CatalogFeedReader } from '@/features/catalog/catalogFeed';
import { viewerCatalogSchema } from '@/shared/catalog';
import { BeeHttpProvider } from '@/swarm/providers/bee-http/beeHttpProvider';

const STREAM = { owner: '2'.repeat(40), topic: 'a-finished-stream' };

const GATEWAY_ORIGIN = 'http://gateway.example.com';
const GATEWAY_PATH = '/bee';

/** The app's own reader and provider, asking the proof's stub, so the stub answers what the app really asks. */
function readProofList() {
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const { status, headers, body } = proofGatewayAnswer(GATEWAY_PATH, url.pathname, STREAM);
    return new Response(status === 404 ? null : body, { status, headers });
  }) as typeof fetch;
  const provider = new BeeHttpProvider({ baseUrl: `${GATEWAY_ORIGIN}${GATEWAY_PATH}`, fetcher });
  const reader = new CatalogFeedReader(PROOF_CATALOG.owner, Topic.fromString(PROOF_CATALOG.topic));
  return reader.read(provider);
}

describe('the live proof stream list', () => {
  it('answers the head read the app makes, so the list reaches the page', async () => {
    const snapshot = await readProofList();

    expect(snapshot).not.toBeNull();
    expect(snapshot?.slot).toBe(0n);
  });

  it('holds an entry the app accepts, marked as a recording, so the player starts at its beginning', async () => {
    const snapshot = await readProofList();
    const parsed: unknown = JSON.parse(snapshot?.body ?? 'null');

    expect(viewerCatalogSchema.safeParse(parsed).success).toBe(true);
    expect(parsed).toEqual([expect.objectContaining({ ...STREAM, title: PROOF_STREAM_TITLE, state: 'vod' })]);
  });
});

describe('the peers the live proof names', () => {
  const ONE = '/dns4/one.example.org/tcp/443/tls/ws/p2p/QmOne';
  const TWO = '/dns4/two.example.org/tcp/443/wss/p2p/QmTwo';

  it('reach the config as a list, so the proof can run while the package list is down', () => {
    expect(proofBootnodes(`${ONE},${TWO}`)).toEqual({ weeb3: { bootnodes: [ONE, TWO] } });
  });

  it('leave the node on its package list when none are named', () => {
    expect(proofBootnodes(undefined)).toEqual({});
    expect(proofBootnodes('')).toEqual({});
  });
});
