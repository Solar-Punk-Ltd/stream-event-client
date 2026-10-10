import { z } from 'zod';

// Imported by its file name, so Node reads this schema without the bundler, as the deployment's own tests do.
import { DEFAULT_THEME, THEME_NAMES, type ThemeName } from '../design/themeNames.ts';
import { BEE_NODE_ACCESS_LEVELS } from '../swarm/beeNodeAccess.ts';
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
  /** The one endpoint of before, refused by name so a config written for it says what replaced it. */
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

const gatewayKindSchema = z.enum(GATEWAY_KINDS, { message: `must be one of ${GATEWAY_KINDS.join(', ')}` });

/** A Bee node's HTTP API, the way the event gateway has always been read. */
const beeHttpGatewaySchema = z.object({
  /** What the default, the fallback and a viewer's saved choice name it by. */
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
    /**
     * The gateways asked when the one in use fails, one or an ordered list, with the default gateway
     * always asked last. Absent means the default gateway alone, so a viewer who picked another always
     * has the event's own behind them, and false means none.
     */
    fallback: z
      .union([notEmpty, z.array(notEmpty).min(1), z.literal(false)], {
        message: 'must name one of the gateways, list them, or be false',
      })
      .optional(),
    /** The kinds of gateway a viewer may add one of their own of. Absent means every kind a gateway may be. */
    kinds: z.array(gatewayKindSchema).min(1, { message: 'must offer at least one kind' }).optional(),
    /** How far a Bee node of the viewer's own may be. Absent means this computer only. */
    beeNodes: z
      .enum(BEE_NODE_ACCESS_LEVELS, { message: `must be one of ${BEE_NODE_ACCESS_LEVELS.join(', ')}` })
      .optional(),
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
    const named = providers.fallback === false || providers.fallback === undefined ? [] : [providers.fallback].flat();
    if (named.some((id) => !ids.has(id))) {
      context.addIssue({ code: 'custom', path: ['fallback'], message: 'must name one of the gateways' });
    } else if (named.includes(providers.default)) {
      context.addIssue({
        code: 'custom',
        path: ['fallback'],
        message: 'must name gateways other than the default, which is always asked last',
      });
    } else if (new Set(named).size !== named.length) {
      context.addIssue({ code: 'custom', path: ['fallback'], message: 'names a gateway twice' });
    }
  });

export type ProvidersConfig = z.infer<typeof providersSchema>;

/**
 * Whether a viewer may run a Swarm node in their own browser, weeb-3, and read and watch through it.
 * Off unless set, because the page's security policy must also allow it, which the image does when its
 * WEEB3 setting is on.
 */
const weeb3Schema = z.object({ enabled: z.boolean({ message: 'must be true or false' }) });

const runtimeConfigSchema = z
  .object({
    /** Which of this build's themes the page wears. Absent means the default. */
    theme: z.enum(THEME_NAMES, { message: `must be one of ${THEME_NAMES.join(', ')}` }).optional(),
    /** The one Bee gateway of before `providers`, still read as the only gateway and the default. */
    gatewayUrl: gatewayUrlSchema.optional(),
    providers: providersSchema.optional(),
    catalog: catalogSchema,
    chat: chatSchema.optional(),
    weeb3: weeb3Schema.optional(),
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

/** The chat's settings when chat is on, and null when it is off or not configured. */
export function enabledChat(config: RuntimeConfig): ChatConfig | null {
  return config.chat?.enabled ? config.chat : null;
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
