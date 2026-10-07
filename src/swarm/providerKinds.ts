// Imported by its file name from the runtime config, which Node reads without the bundler, so this file imports nothing.

/** Every kind of provider this build carries. A config naming another kind is refused. */
export const PROVIDER_KINDS = ['bee-http'] as const;

export type ProviderKindName = (typeof PROVIDER_KINDS)[number];
