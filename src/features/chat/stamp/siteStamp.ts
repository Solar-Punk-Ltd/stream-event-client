import type { SwarmIdPostageBatch } from '../swarmId/swarmIdClient';

export const SITE_STAMP_OK = 'ok';
export const SITE_STAMP_RAN_OUT = 'ran-out';
export const SITE_STAMP_NOT_USABLE = 'not-usable';

type SiteStampState = typeof SITE_STAMP_OK | typeof SITE_STAMP_RAN_OUT | typeof SITE_STAMP_NOT_USABLE;

/** The stamp Swarm ID gives this site, in the terms the viewer shows it. */
export interface SiteStamp {
  /** Its name in Swarm ID, or null when it has none. */
  readonly label: string | null;
  /** 0 to 100. 100 only once it is full. */
  readonly percentUsed: number;
  /** Whole days, or null when Swarm ID could not tell. */
  readonly daysLeft: number | null;
  readonly state: SiteStampState;
}

const SECONDS_PER_DAY = 24 * 60 * 60;
const PERCENT = 100;

/** Rounded as Swarm ID's own screens round it, so 99.8% used reads 99% until the stamp is really full. */
function percentUsedOf(utilization: number): number {
  const percent = Math.min(PERCENT, Math.max(0, Math.round(utilization * PERCENT)));
  return percent === PERCENT && utilization < 1 ? PERCENT - 1 : percent;
}

function stateOf(batch: SwarmIdPostageBatch): SiteStampState {
  if (!batch.exists || batch.utilization >= 1 || (batch.batchTTL !== undefined && batch.batchTTL <= 0)) {
    return SITE_STAMP_RAN_OUT;
  }
  if (!batch.usable) {
    return SITE_STAMP_NOT_USABLE;
  }
  return SITE_STAMP_OK;
}

export function siteStampOf(batch: SwarmIdPostageBatch): SiteStamp {
  const percentUsed = percentUsedOf(batch.utilization);
  const daysLeft = batch.batchTTL === undefined ? null : Math.max(0, Math.floor(batch.batchTTL / SECONDS_PER_DAY));
  return { label: batch.label.trim() || null, percentUsed, daysLeft, state: stateOf(batch) };
}

/** A line above the chat's message field, and whether a message on this stamp can be sent at all. */
export interface StampWarning {
  readonly title: string;
  readonly detail: string;
  readonly blocksSending: boolean;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What `daysLeft` days left reads as, such as "6 days left". */
export function daysLeftText(daysLeft: number): string {
  return `${plural(daysLeft, 'day')} left`;
}

/** What the viewer is warned of, for the site's stamp or for none at all, or null while it is fine. */
export function stampWarning(stamp: SiteStamp | null): StampWarning | null {
  if (stamp === null) {
    return {
      title: 'No stamp for this site.',
      detail: 'Choose one and confirm it in the Swarm ID window, or let the gateway pay.',
      blocksSending: true,
    };
  }
  switch (stamp.state) {
    case SITE_STAMP_OK:
      return null;
    case SITE_STAMP_RAN_OUT:
      return {
        title: 'Your stamp ran out.',
        detail: 'Change it in Swarm ID, or let the gateway pay.',
        blocksSending: true,
      };
    case SITE_STAMP_NOT_USABLE:
      return {
        title: 'Your stamp is not usable yet.',
        detail: 'A new stamp takes a minute or two. Wait, or let the gateway pay.',
        blocksSending: true,
      };
  }
}
