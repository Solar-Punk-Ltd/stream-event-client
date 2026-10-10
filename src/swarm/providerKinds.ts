// Imported by its file name from the runtime config, which Node reads without the bundler, so this file imports nothing.

/** The kinds a deployment may offer as a gateway in its config, and a viewer may add one of their own of. */
export const GATEWAY_KINDS = ['bee-http'] as const;

/**
 * Every kind of provider this build carries. weeb-3 runs a node in the viewer's own browser, so a
 * deployment switches it on with `weeb3.enabled` and never offers one as a gateway.
 */
export const PROVIDER_KINDS = [...GATEWAY_KINDS, 'weeb-3'] as const;

export type ProviderKindName = (typeof PROVIDER_KINDS)[number];
