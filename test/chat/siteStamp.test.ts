import { describe, expect, it } from 'vitest';

import {
  SITE_STAMP_LOW,
  SITE_STAMP_NOT_USABLE,
  SITE_STAMP_OK,
  SITE_STAMP_RAN_OUT,
  siteStampOf,
  stampWarning,
} from '../../src/features/chat/stamp/siteStamp';
import type { SwarmIdPostageBatch } from '../../src/features/chat/swarmId/swarmIdClient';

const DAY_S = 24 * 60 * 60;

function batch(extra: Partial<SwarmIdPostageBatch> = {}): SwarmIdPostageBatch {
  return { label: '', utilization: 0.2, usable: true, exists: true, batchTTL: 40 * DAY_S, ...extra };
}

describe('the stamp Swarm ID gives this site, as the viewer shows it', () => {
  it('says how full it is in whole percent and how many whole days it has left', () => {
    expect(siteStampOf(batch({ utilization: 0.234, batchTTL: 12.9 * DAY_S }))).toEqual({
      label: null,
      percentUsed: 23,
      daysLeft: 12,
      state: SITE_STAMP_OK,
    });
  });

  it('keeps its name when Swarm ID gives one', () => {
    expect(siteStampOf(batch({ label: '  Event chat ' })).label).toBe('Event chat');
  });

  it('never says 100% used until it is full', () => {
    expect(siteStampOf(batch({ utilization: 0.998 })).percentUsed).toBe(99);
  });

  it('runs low at 80% used, or at three days left', () => {
    expect(siteStampOf(batch({ utilization: 0.79 })).state).toBe(SITE_STAMP_OK);
    expect(siteStampOf(batch({ utilization: 0.8 })).state).toBe(SITE_STAMP_LOW);
    expect(siteStampOf(batch({ batchTTL: 4 * DAY_S })).state).toBe(SITE_STAMP_OK);
    expect(siteStampOf(batch({ batchTTL: 3 * DAY_S })).state).toBe(SITE_STAMP_LOW);
  });

  it('has run out when it is full, has no time left, or is gone from the chain', () => {
    expect(siteStampOf(batch({ utilization: 1 })).state).toBe(SITE_STAMP_RAN_OUT);
    expect(siteStampOf(batch({ batchTTL: 0 })).state).toBe(SITE_STAMP_RAN_OUT);
    expect(siteStampOf(batch({ exists: false })).state).toBe(SITE_STAMP_RAN_OUT);
  });

  it('is not usable yet while the chain has not confirmed it', () => {
    expect(siteStampOf(batch({ usable: false })).state).toBe(SITE_STAMP_NOT_USABLE);
  });

  it('leaves the days out when Swarm ID could not tell them', () => {
    const stamp = siteStampOf(batch({ batchTTL: undefined, utilization: 0.9 }));
    expect(stamp.daysLeft).toBeNull();
    expect(stamp.state).toBe(SITE_STAMP_LOW);
  });
});

describe('the warning a stamp gives', () => {
  it('says nothing while it is fine', () => {
    expect(stampWarning(siteStampOf(batch()))).toBeNull();
  });

  it('says how much is used and when it runs out, when it runs low', () => {
    expect(stampWarning(siteStampOf(batch({ utilization: 0.85, batchTTL: 6 * DAY_S })))).toEqual({
      title: '85% of your stamp is used.',
      detail: 'It runs out in about 6 days.',
      blocksSending: false,
    });
    expect(stampWarning(siteStampOf(batch({ utilization: 0.1, batchTTL: 1.5 * DAY_S })))?.detail).toBe(
      'It runs out in about 1 day.',
    );
  });

  it('stops sending once it ran out, or before it is usable', () => {
    expect(stampWarning(siteStampOf(batch({ utilization: 1 })))).toMatchObject({
      title: 'Your stamp ran out.',
      blocksSending: true,
    });
    expect(stampWarning(siteStampOf(batch({ usable: false })))).toMatchObject({
      title: 'Your stamp is not usable yet.',
      blocksSending: true,
    });
  });

  it('stops sending when Swarm ID has given this site no stamp', () => {
    expect(stampWarning(null)).toEqual({
      title: 'No stamp for this site.',
      detail: 'Choose one and confirm it in the Swarm ID window, or let the gateway pay.',
      blocksSending: true,
    });
  });
});
