/**
 * Whether an error is Swarm ID refusing `origin` because its allow list does not serve it, in the fork's own words: a
 * site address that is not a plain https one, which only a listed development origin may be, or one the list does not
 * name. A list that could not be read is a different refusal, which says nothing about the site.
 */
export function isAllowListRefusal(error: string | undefined, origin: string): boolean {
  if (!error) return false;
  return (
    error === `${origin} is not a plain https site address, and Swarm ID serves only the sites on its allow list.` ||
    error === `${origin} is not on Swarm ID's allow list of sites.`
  );
}

/**
 * Whether an error is Swarm ID's frame refusing to stamp for a site because the site has no drive of its own. A
 * timeout or any other failure is not a refusal, since it says nothing about whether the frame would have stamped.
 */
export function isNoDriveRefusal(error: string | undefined): boolean {
  return error?.startsWith('This site has no drive in Swarm ID.') ?? false;
}
