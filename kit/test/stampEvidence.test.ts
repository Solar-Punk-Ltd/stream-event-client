import { describe, expect, it } from 'vitest';

import {
  frameIdentity,
  paidAsSentProblems,
  stampedRequests,
  stampsNamedToViewer,
  walletLinkSeen,
} from '../src/stampEvidence.ts';

const DRIVE = 'd1'.repeat(32);

describe('stampsNamedToViewer', () => {
  it("reads the stamp each of Swarm ID's connection updates named, none as null", () => {
    const received = [
      JSON.stringify({ type: 'connectionInfoChanged', identity: { id: 'aa' } }),
      JSON.stringify({ type: 'somethingElse', postageBatchId: 'ff'.repeat(32) }),
      JSON.stringify({ type: 'connectionInfoChanged', identity: { id: 'aa' }, postageBatchId: DRIVE }),
      'not json at all',
    ].join('\n');
    expect(stampsNamedToViewer(received)).toEqual([null, DRIVE]);
  });

  it('leaves out an update with no identity, which is no session', () => {
    const received = JSON.stringify({ type: 'connectionInfoChanged', postageBatchId: DRIVE });
    expect(stampsNamedToViewer(received)).toEqual([]);
  });
});

describe('stampedRequests', () => {
  const VIEWER = 'http://127.0.0.1:4180';
  const STAMP = { name: 'Swarm-Postage-Stamp', value: 'ab' };
  const entry = (
    pageref: string,
    frameref: string,
    method: string,
    url: string,
    headers = [STAMP],
    document = false,
  ) => ({
    pageref,
    _frameref: frameref,
    _resourceType: document ? 'document' : 'fetch',
    request: { method, url, headers },
  });
  const har = (entries: unknown[]) => JSON.stringify({ log: { entries } });
  const viewerPage = [
    entry('page@viewer', 'frame@top', 'GET', `${VIEWER}/`, [], true),
    entry('page@viewer', 'frame@proxy', 'GET', 'http://localhost:5500/proxy', [], true),
    entry('page@viewer', 'frame@top', 'GET', 'http://localhost:16332/feeds/x', []),
  ];

  it('names every request of the viewer page that carried a postage stamp, in any case of the header', () => {
    const recorded = har([...viewerPage, entry('page@viewer', 'frame@top', 'POST', 'http://localhost:16332/soc/y')]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE])).toEqual({
      viewerPages: 1,
      stamped: ['POST http://localhost:16332/soc/y'],
    });
  });

  it("names a stamped write from a Swarm ID frame embedded in the viewer's page", () => {
    const recorded = har([...viewerPage, entry('page@viewer', 'frame@proxy', 'POST', 'http://localhost:1633/chunks')]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE]).stamped).toEqual(['POST http://localhost:1633/chunks']);
  });

  it('names a request that asks Bee to stamp it with the drive, by batch id', () => {
    const recorded = har([
      ...viewerPage,
      entry('page@viewer', 'frame@top', 'POST', 'http://localhost:16332/soc/z', [
        { name: 'Swarm-Postage-Batch-Id', value: DRIVE },
      ]),
    ]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE]).stamped).toEqual(['POST http://localhost:16332/soc/z']);
  });

  it("leaves out a batch id that is not the person's drive, such as the placeholder the gateway replaces", () => {
    const recorded = har([
      ...viewerPage,
      entry('page@viewer', 'frame@top', 'POST', 'http://localhost:8080/soc/z', [
        { name: 'swarm-postage-batch-id', value: '0123456789abcdef'.repeat(4) },
      ]),
    ]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE]).stamped).toEqual([]);
  });

  it("leaves out Swarm ID's own window, which stamps the account's own state with its own drive", () => {
    const recorded = har([
      ...viewerPage,
      entry('page@swarm-id', 'frame@dev', 'GET', 'http://localhost:5500/dev', [], true),
      entry('page@swarm-id', 'frame@dev', 'POST', 'http://localhost:1633/soc/owner/id'),
    ]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE])).toEqual({ viewerPages: 1, stamped: [] });
  });

  it('names nothing when no request carried one', () => {
    const recorded = har([
      ...viewerPage,
      entry('page@viewer', 'frame@top', 'POST', 'http://localhost:16332/soc/y', [
        { name: 'content-type', value: 'application/octet-stream' },
      ]),
    ]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE]).stamped).toEqual([]);
  });

  it('counts no viewer page when the recording never loaded the viewer, so its silence can be refused', () => {
    const recorded = har([entry('page@swarm-id', 'frame@dev', 'GET', 'http://localhost:5500/dev', [], true)]);
    expect(stampedRequests(recorded, VIEWER, [DRIVE])).toEqual({ viewerPages: 0, stamped: [] });
  });
});

describe('paidAsSentProblems', () => {
  const VIEWER = 'http://127.0.0.1:4180';
  const INBOX = 'ab'.repeat(20);
  const PLACES = {
    viewer: VIEWER,
    gateway: 'http://localhost:8080',
    ownNode: 'http://localhost:16332',
    inboxOwner: INBOX,
  };
  const write = (url: string, headers: { name: string; value: string }[]) => ({
    pageref: 'page@viewer',
    _resourceType: 'fetch',
    request: { method: 'POST', url, headers },
  });
  const document = { pageref: 'page@viewer', _resourceType: 'document', request: { method: 'GET', url: `${VIEWER}/` } };
  const har = (entries: unknown[]) => JSON.stringify({ log: { entries: [document, ...entries] } });
  const byGateway = write(`http://localhost:8080/soc/${INBOX}/01`, [
    { name: 'swarm-postage-batch-id', value: '00'.repeat(32) },
  ]);
  const onDrive = write(`http://localhost:16332/soc/${INBOX}/01`, [
    { name: 'swarm-postage-stamp', value: `${DRIVE}${'00'.repeat(81)}` },
  ]);

  const stampedWith = (drive: string) =>
    write(`http://localhost:16332/soc/${INBOX}/01`, [
      { name: 'swarm-postage-stamp', value: `${drive}${'00'.repeat(81)}` },
    ]);
  const OTHER = 'cd'.repeat(32);

  it('passes when each gateway send reached the gateway and each own-stamp send the own node with its drive', () => {
    expect(paidAsSentProblems(har([byGateway, onDrive]), PLACES, { gateway: 1, ownStamp: { [DRIVE]: 1 } })).toEqual([]);
  });

  it('names an own-stamp send that never reached the own node with its drive, and a gateway send that never left', () => {
    expect(paidAsSentProblems(har([stampedWith(OTHER)]), PLACES, { gateway: 1, ownStamp: { [DRIVE]: 1 } })).toEqual([
      '1 gateway sends, 0 inbox writes to the gateway',
      `1 own-stamp sends on drive ${DRIVE}, 0 inbox writes to the own node stamped with it`,
      `1 inbox writes to the own node stamped with drive ${OTHER}, which no send was to spend`,
    ]);
  });

  it('counts each drive apart, so a write on one drive never stands in for a send on another', () => {
    const sends = { gateway: 0, ownStamp: { [DRIVE]: 1, [OTHER]: 1 } };
    expect(paidAsSentProblems(har([onDrive, onDrive]), PLACES, sends)).toEqual([
      `1 own-stamp sends on drive ${OTHER}, 0 inbox writes to the own node stamped with it`,
    ]);
    expect(paidAsSentProblems(har([onDrive, stampedWith(OTHER)]), PLACES, sends)).toEqual([]);
  });

  it('takes more writes than sends on a drive, since the chat writes a message again while it is not read back', () => {
    expect(paidAsSentProblems(har([onDrive, onDrive]), PLACES, { gateway: 0, ownStamp: { [DRIVE]: 1 } })).toEqual([]);
  });

  it('does not count a write to another address, such as the own feed copy', () => {
    const copy = write(`http://localhost:16332/soc/${'cd'.repeat(20)}/02`, [
      { name: 'swarm-postage-stamp', value: `${DRIVE}${'00'.repeat(81)}` },
    ]);
    expect(paidAsSentProblems(har([copy]), PLACES, { gateway: 0, ownStamp: { [DRIVE]: 1 } })).toEqual([
      `1 own-stamp sends on drive ${DRIVE}, 0 inbox writes to the own node stamped with it`,
    ]);
  });
});

describe('walletLinkSeen', () => {
  const WALLET = '0x' + 'Ab'.repeat(20);
  const update = (identity: unknown) => JSON.stringify({ type: 'connectionInfoChanged', identity });

  it('says no update when Swarm ID told the viewer of no identity at all', () => {
    expect(walletLinkSeen('', WALLET)).toBe('no update');
    expect(walletLinkSeen(JSON.stringify({ type: 'connectionInfoChanged' }), WALLET)).toBe('no update');
  });

  it('reads the last update only, and finds the wallet in any case and without 0x', () => {
    const linked = update({ walletLink: { message: `Wallet: 0x${'ab'.repeat(20)}` } });
    expect(walletLinkSeen([update({ id: 'aa' }), linked].join('\n'), WALLET)).toBe('update carried wallet');
    expect(walletLinkSeen([linked, update({ id: 'aa' })].join('\n'), WALLET)).toBe('update carried no wallet');
  });
});

describe('frameIdentity', () => {
  const binding = (chat: string) =>
    [
      'Swarm ID chat binding',
      'Site: http://127.0.0.1:4180',
      `Chat address: ${chat}`,
      'Date: 2026-01-01T00:00:00.000Z',
    ].join('\n');

  it("reads the account and the chat address of Swarm ID's last connection update, bare and lower case", () => {
    const received = [
      JSON.stringify({ type: 'connectionInfoChanged', identity: { id: '0xAA', address: '0xAA' } }),
      JSON.stringify({
        type: 'connectionInfoChanged',
        identity: { id: 'BB'.repeat(20), address: 'BB'.repeat(20) },
        chatBinding: { message: binding(`0x${'CD'.repeat(20)}`), signature: '0x' },
      }),
      'not json',
    ].join('\n');
    expect(frameIdentity(received)).toEqual({ account: 'bb'.repeat(20), chatAddress: 'cd'.repeat(20) });
  });

  it('gives no chat address for an update without a binding, and nothing without an update', () => {
    expect(
      frameIdentity(JSON.stringify({ type: 'connectionInfoChanged', identity: { id: 'aa', address: 'aa' } })),
    ).toEqual({ account: 'aa', chatAddress: null });
    expect(frameIdentity(JSON.stringify({ type: 'connectionInfoChanged' }))).toBeNull();
  });
});
