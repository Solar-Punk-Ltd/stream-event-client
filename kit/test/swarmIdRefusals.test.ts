import { describe, expect, it } from 'vitest';

import { isAllowListRefusal, isNoDriveRefusal } from '../src/swarmIdRefusals.ts';

const ORIGIN = 'http://[::1]:4999';

describe('isAllowListRefusal', () => {
  it("takes Swarm ID's refusal of a site its allow list does not serve, for that site", () => {
    expect(
      isAllowListRefusal(
        `${ORIGIN} is not a plain https site address, and Swarm ID serves only the sites on its allow list.`,
        ORIGIN,
      ),
    ).toBe(true);
    expect(isAllowListRefusal(`${ORIGIN} is not on Swarm ID's allow list of sites.`, ORIGIN)).toBe(true);
  });

  it('refuses any other failure, a list that could not be read, and a refusal of another site', () => {
    expect(isAllowListRefusal('Timed out waiting for the proxy', ORIGIN)).toBe(false);
    expect(isAllowListRefusal(undefined, ORIGIN)).toBe(false);
    expect(
      isAllowListRefusal(
        `Swarm ID could not read its allow list of sites, so it refused ${ORIGIN}. It serves no site until the list can be read.`,
        ORIGIN,
      ),
    ).toBe(false);
    expect(isAllowListRefusal("http://localhost:1 is not on Swarm ID's allow list of sites.", ORIGIN)).toBe(false);
  });
});

describe('isNoDriveRefusal', () => {
  it("takes Swarm ID's refusal to stamp for a site that has no drive, and no other failure", () => {
    expect(
      isNoDriveRefusal(
        'This site has no drive in Swarm ID. Connect to it again and confirm a drive in the sign-in window, adding one first if the account has none, before uploading.',
      ),
    ).toBe(true);
    expect(isNoDriveRefusal('Request timeout after 30000ms')).toBe(false);
    expect(isNoDriveRefusal(undefined)).toBe(false);
  });
});
