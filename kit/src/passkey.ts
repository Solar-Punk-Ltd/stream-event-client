import type { BrowserContext, Page } from '@playwright/test';

/**
 * A Chrome virtual authenticator on `page`, as the Swarm ID fork's `passkey-access.test.ts` installs it: a resident
 * key, user-verifying platform authenticator with the PRF extension, which Swarm ID derives the account's encryption
 * key from, answering every ceremony by itself.
 *
 * A virtual authenticator belongs to one tab, and the credential it makes stays in it. Copied into another tab's
 * authenticator, a credential loses its PRF secret (the copy answers no PRF output), so a passkey
 * account is made in the tab that will use it, Swarm ID's sign-in window.
 */
export async function installVirtualAuthenticator(context: BrowserContext, page: Page): Promise<void> {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  });
}
