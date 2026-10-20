import { z } from 'zod';

// Imported by its file name, so Node reads this schema without the bundler, as the deployment's own tests do.
import { DEFAULT_THEME, THEME_NAMES, type ThemeName } from '../design/themeNames.ts';
import { GATEWAY_KINDS } from '../swarm/providerKinds.ts';

/**
 * Served beside the page, so one build serves every deployment and a setting changes without a
 * rebuild. Relative, because the app is built with `base: './'` and may be served under a path.
 */
export const CONFIG_URL = './config.json';

const PLACEHOLDER = /^<.*>$/s;
const ETH_ADDRESS = /^(0x)?[0-9a-fA-F]{40}$/;

/** The example config ships `<...>` values, and a deployment that forgot one must not start on it. */
const filledIn = z.string().refine((value) => !PLACEHOLDER.test(value.trim()), {
  message: 'still holds the example placeholder',
});

const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

const isRootedPathOrHttpUrl = (value: string) =>
  (value.startsWith('/') && !value.startsWith('//')) || /^https?:\/\/[^/]/i.test(value);

const gatewayUrlSchema = filledIn.refine(isRootedPathOrHttpUrl, {
  message: 'must be a path on this site, such as /bee, or an http or https address',
});

const ethAddress = filledIn.refine((value) => ETH_ADDRESS.test(value), { message: 'must be an Ethereum address' });

const notEmpty = filledIn.refine((value) => value.trim().length > 0, { message: 'must not be empty' });

const catalogSchema = z.object({
  owner: ethAddress,
  topic: notEmpty,
});

const chatEndpoint = filledIn.refine(isRootedPathOrHttpUrl, {
  message: 'must be a path on this site or an http or https address',
});

const enabledChatSchema = z.object({
  enabled: z.literal(true),
  /** Where the chat's feed and history files are read, a gateway that serves only reads. */
  readUrl: chatEndpoint,
  /** Where messages are written, a gateway that stamps each write, apart from the one that reads. */
  writeUrl: chatEndpoint,
  /** Not a setting: refused by name so a config that carries it is told to use `readUrl` and `writeUrl`. */
  beeUrl: z.undefined({ message: 'is replaced by chat.readUrl and chat.writeUrl' }).optional(),
  /**
   * A private key every viewer receives, so it is configuration and not a secret: the GSOC address it
   * signs for is where the chat aggregator listens, and every viewer writes there with the same key.
   */
  gsocResourceId: filledIn.refine((value) => PRIVATE_KEY.test(value), {
    message: 'must be 32 bytes written as 64 hex digits',
  }),
  gsocTopic: notEmpty,
  feedOwner: ethAddress,
  pollIntervalMs: z.number().int().positive(),
});

/** Chat switched off is not read any further, so its example placeholders can stay. */
const disabledChatSchema = z.looseObject({ enabled: z.literal(false) });

const chatSchema = z.discriminatedUnion('enabled', [enabledChatSchema, disabledChatSchema]);

/** A Bee node's HTTP API, the way the event gateway is read. */
const beeHttpGatewaySchema = z.object({
  /** What the default and a viewer's saved choice name it by. */
  id: notEmpty,
  kind: z.literal('bee-http'),
  /** What a viewer is shown it as. */
  label: notEmpty.optional(),
  url: gatewayUrlSchema,
});

const gatewaySchema = z.discriminatedUnion('kind', [beeHttpGatewaySchema], {
  message: `must be one of ${GATEWAY_KINDS.join(', ')}`,
});

const providersSchema = z
  .object({
    /** The gateways a viewer is offered. */
    gateways: z.array(gatewaySchema).min(1, { message: 'must offer at least one gateway' }),
    /** The gateway every reader starts on. */
    default: notEmpty,
  })
  .superRefine((providers, context) => {
    const ids = new Set<string>();
    providers.gateways.forEach((gateway, at) => {
      if (ids.has(gateway.id)) {
        context.addIssue({ code: 'custom', path: ['gateways', at, 'id'], message: 'is used by another gateway' });
      }
      ids.add(gateway.id);
    });
    if (!ids.has(providers.default)) {
      context.addIssue({ code: 'custom', path: ['default'], message: 'must name one of the gateways' });
    }
  });

export type ProvidersConfig = z.infer<typeof providersSchema>;

/** A scheme, a host and an optional port, exactly as a browser reports an origin. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;

/**
 * The Swarm ID site a viewer signs in to the chat with. Its library builds the frame's address from this and checks
 * every answer's origin against it, so it is an origin with nothing after it. The page's policy must allow it as a
 * frame, which the image does from its SWARM_ID_URL setting.
 */
const swarmIdSchema = z.object({
  url: filledIn.refine((value) => ORIGIN.test(value), {
    message: 'must be an origin such as https://id.example.com, with no path and no trailing slash',
  }),
});

/** The hosts a development build runs a chain node on, which a page on http may reach without TLS. */
function isLocalDevelopmentHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');
}

/** An https address, or an http one on a local development host, with a host and no user name or password in it. */
function isEnsEndpoint(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!url.hostname || url.username || url.password) {
    return false;
  }
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalDevelopmentHost(url.hostname));
}

/**
 * The Ethereum mainnet JSON-RPC endpoint a viewer's page reads ENS names through. It decides which name is shown beside
 * a wallet and sees every wallet looked up, from the viewer's own address, so a deployment names one it trusts with
 * both. A page on https reaches any https address, so the image's policy needs nothing more for one.
 */
const ensRpcUrlSchema = filledIn.refine(isEnsEndpoint, {
  message: 'must be an https address such as https://ethereum-rpc.example.org, or http on a local development host',
});

const runtimeConfigSchema = z
  .object({
    /** Which of this build's themes the page wears. Absent means the default. */
    theme: z.enum(THEME_NAMES, { message: `must be one of ${THEME_NAMES.join(', ')}` }).optional(),
    /** Whether a viewer logged in to the chat may switch the look between the build's themes. On unless set. */
    themeSwitcher: z.boolean({ message: 'must be true or false' }).optional(),
    /**
     * Whether a viewer is offered the experimental parts: Swarm ID, and choosing the sources the page reads Swarm
     * through. On unless set. Off, the page reads every part from the default gateway and chats as a guest.
     */
    experimental: z.boolean({ message: 'must be true or false' }).optional(),
    /** One Bee gateway, read as the only gateway offered and the default. `providers` is the other way to name them. */
    gatewayUrl: gatewayUrlSchema.optional(),
    providers: providersSchema.optional(),
    catalog: catalogSchema,
    chat: chatSchema.optional(),
    swarmId: swarmIdSchema.optional(),
    ensRpcUrl: ensRpcUrlSchema.optional(),
  })
  .superRefine((config, context) => {
    if (config.gatewayUrl !== undefined && config.providers !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'replaces gatewayUrl, so set only one of them',
      });
    } else if (config.gatewayUrl === undefined && config.providers === undefined) {
      context.addIssue({ code: 'custom', path: ['gatewayUrl'], message: 'is missing, and so is providers' });
    }
  });

export type ChatConfig = z.infer<typeof enabledChatSchema>;

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export type RuntimeConfigResult = { ok: true; config: RuntimeConfig } | { ok: false; problem: string };

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'the config'}: ${issue.message}`)
    .join('; ');
}

/** The theme this deployment wears. */
export function selectedTheme(config: RuntimeConfig): ThemeName {
  return config.theme ?? DEFAULT_THEME;
}

/** Whether this deployment lets a logged-in viewer switch the look. */
export function themeSwitcherEnabled(config: RuntimeConfig): boolean {
  return config.themeSwitcher ?? true;
}

/** Whether this deployment offers Swarm ID and the viewer's own choice of sources. */
export function experimentalEnabled(config: RuntimeConfig): boolean {
  return config.experimental ?? true;
}

/** The chat's settings when chat is on, and null when it is off or not configured. */
export function enabledChat(config: RuntimeConfig): ChatConfig | null {
  return config.chat?.enabled ? config.chat : null;
}

/**
 * The Swarm ID site to offer sign-in with, or null when there is none, no chat for it to sign in to, or the deployment
 * turned the experimental parts off.
 */
export function swarmIdUrl(config: RuntimeConfig): string | null {
  return enabledChat(config) && config.swarmId && experimentalEnabled(config) ? config.swarmId.url : null;
}

/** The endpoint to read ENS names through, or null when there is none or no chat to show them in. */
export function ensRpcUrl(config: RuntimeConfig): string | null {
  return enabledChat(config) && config.ensRpcUrl ? config.ensRpcUrl : null;
}

export function parseRuntimeConfig(raw: unknown): RuntimeConfigResult {
  const parsed = runtimeConfigSchema.safeParse(raw);
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false, problem: describeIssues(parsed.error) };
}

/** Never rejects: every way the config can be missing or wrong comes back as a problem to show. */
export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfigResult> {
  let response: Response;
  try {
    response = await fetchFn(CONFIG_URL, { cache: 'no-store' });
  } catch (error) {
    return { ok: false, problem: `${CONFIG_URL} could not be read: ${errorText(error)}` };
  }

  if (!response.ok) {
    return { ok: false, problem: `${CONFIG_URL} could not be read: the server answered ${response.status}` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await response.text());
  } catch {
    return { ok: false, problem: `${CONFIG_URL} is not JSON` };
  }

  return parseRuntimeConfig(raw);
}

export interface ConfigProblemText {
  title: string;
  detail: string;
  hint: string;
}

export function configProblemText(result: { ok: false; problem: string }): ConfigProblemText {
  return {
    title: 'This page cannot start',
    detail: `Its settings are missing or wrong. ${result.problem}.`,
    hint: `Whoever runs this site sets them in config.json, served beside the page.`,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
