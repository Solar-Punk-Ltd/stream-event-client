/**
 * Live mode's view of a real deployment: the target file that names it, and what the viewer's own public
 * `config.json` says about the rest. The target file lives outside the repository, since a deployment's names stay out
 * of it, and `targets/example.json` shows its shape with placeholders.
 */
import { readFileSync } from 'node:fs';

import { PrivateKey } from '@ethersphere/bee-js';
import { z } from 'zod';

import { parseRuntimeConfig } from '../../src/config/runtimeConfig.ts';
import { mediaTypeSchema } from '../../src/shared/contracts/mediaType.ts';
import { isLocalDevHost } from './addresses.ts';
import type { Deployment, SiteAddresses } from './deployment.ts';

/**
 * Where live mode serves the hostile site: this machine's IPv6 loopback, a site apart from the viewer and Swarm ID, on
 * a port beside the local stack's 4999 so both can be up at once.
 */
export const LIVE_EVIL_ORIGIN = 'http://[::1]:4998';

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;
const ETH_ADDRESS = /^(0x)?[0-9a-fA-F]{40}$/;

const ACTOR = /^[a-z]+$/;

/** The local end of an SSH tunnel the operator opens: an origin on this machine, with no path. */
const tunnelEnd = (example: string) =>
  z
    .string()
    .regex(ORIGIN, { message: `must be an origin such as ${example}, with no path` })
    .refine((origin) => isLocalDevHost(new URL(origin).hostname), {
      message: 'must be on this machine, the local end of a tunnel',
    });

const targetSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/, { message: 'must be lower case letters, digits and hyphens' }),
  viewer: z.string().regex(ORIGIN, { message: 'must be an origin such as https://viewer.example.com, with no path' }),
  stream: z.strictObject({
    mediaType: mediaTypeSchema,
    owner: z.string().regex(ETH_ADDRESS, { message: 'must be an Ethereum address' }),
    topic: z.string().min(1),
    title: z.string().min(1),
  }),
  /**
   * Outside origins a part of the deployment reads on its own, which neither the target nor the config names, such as
   * the Swarm gateway the real Swarm ID site reads its accounts through. Each says why, and the verdict carries it.
   */
  alsoAllowed: z
    .array(
      z.strictObject({
        origin: z.string().regex(ORIGIN, { message: 'must be an origin, with no path' }),
        why: z.string().min(1),
      }),
    )
    .default([]),
  /**
   * The local end of the operator's SSH tunnel to the chat server's `/health`, which answers only on the deployment's
   * own machine. The scenarios that read the server's counts refuse to start without it.
   */
  chatHealth: tunnelEnd('http://127.0.0.1:4997').optional(),
  /**
   * The local end of the operator's SSH tunnel to a Bee node of the deployment's that stands in for an actor's own
   * node, by actor. A message on a person's own stamp goes out only through their own node or Weeb3, so the scenarios
   * that read and send through the own node refuse to start without it.
   */
  ownNodes: z
    .record(
      z.string().regex(ACTOR, { message: 'must be an actor name such as alice' }),
      tunnelEnd('http://127.0.0.1:4996'),
    )
    .default({}),
  /**
   * The actor whose account a scenario makes with a wallet that owns a real ENS name, that wallet's address, and the
   * name, which must resolve to the address and back. The wallet's key never comes from this file: live mode reads it
   * from the environment.
   */
  ens: z
    .strictObject({
      actor: z.string().regex(ACTOR, { message: 'must be an actor name such as alice' }),
      address: z.string().regex(ETH_ADDRESS, { message: 'must be an Ethereum address' }),
      name: z
        .string()
        .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, { message: 'must be an ENS name such as alice.example.eth' }),
    })
    .optional(),
  /**
   * The standing Swarm ID accounts of the actors a scenario gives a drive: the account's address, and its drives in the
   * order the scenario's drive steps use them. The account's recovery phrase and password never come from this file:
   * live mode reads them from the environment.
   */
  standing: z
    .array(
      z.strictObject({
        actor: z.string().regex(ACTOR, { message: 'must be an actor name such as alice' }),
        address: z.string().regex(ETH_ADDRESS, { message: 'must be an Ethereum address' }),
        drives: z
          .array(z.string().regex(/^[0-9a-f]{64}$/, { message: 'must be a whole batch id, 64 hex digits' }))
          .min(1, { message: 'must name at least one drive' }),
      }),
    )
    .default([]),
});

export type Target = z.output<typeof targetSchema>;

const describe = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || 'the target'}: ${issue.message}`).join('; ');

export function parseTarget(value: unknown): Target {
  const parsed = targetSchema.safeParse(value);
  if (!parsed.success) throw new Error(`the target file is refused: ${describe(parsed.error)}`);
  return parsed.data;
}

export function readTarget(file: string): Target {
  return parseTarget(JSON.parse(readFileSync(file, 'utf8')));
}

/** Everything live mode takes from the target and the viewer's config, every address resolved. */
export interface LiveDeployment {
  target: Target;
  viewer: string;
  /** The gateway the viewer reads streams and the stream list through. */
  gateway: string;
  chatRead: string;
  chatWrite: string;
  swarmId: string;
  ensRpc: string;
  /** The local end of the tunnel to the chat server's `/health`, null when the target names none. */
  chatHealth: string | null;
  /** The local end of the tunnel to each actor's own Bee node, by actor. */
  ownNodes: Record<string, string>;
  /** The chat inbox's key and identifier, public in the config, which every sender signs its inbox writes with. */
  inbox: { key: string; identifier: string };
  catalog: { owner: string; topic: string };
  deployment: Deployment;
  addresses: SiteAddresses;
}

/** An address of the config as the viewer resolves it: a path on the viewer's own origin, or an address as written. */
function resolve(viewer: string, address: string): string {
  return new URL(address, `${viewer}/`).toString().replace(/\/+$/, '');
}

/**
 * Builds live mode's addresses from the target and the config the viewer serves, after the viewer's own check of that
 * config. Refuses a config without the parts a live run reads: a single gateway, an enabled chat, a Swarm ID site and
 * an ENS endpoint.
 */
export function liveDeployment(target: Target, rawConfig: unknown): LiveDeployment {
  const parsed = parseRuntimeConfig(rawConfig);
  if (!parsed.ok) throw new Error(`the viewer's config.json is refused: ${parsed.problem}`);
  const { config } = parsed;
  const missing = (part: string) => new Error(`the viewer's config.json has no ${part}, which live mode reads`);
  if (!config.gatewayUrl) throw missing('gatewayUrl');
  if (!config.chat?.enabled) throw missing('enabled chat');
  if (!config.swarmId) throw missing('swarmId');
  if (!config.ensRpcUrl) throw missing('ensRpcUrl');
  const chat = config.chat;
  const viewer = target.viewer;
  const parts = {
    viewer,
    swarmId: config.swarmId.url,
    gateway: resolve(viewer, config.gatewayUrl),
    chatRead: resolve(viewer, chat.readUrl),
    chatWrite: resolve(viewer, chat.writeUrl),
    ensRpc: resolve(viewer, config.ensRpcUrl),
    evil: LIVE_EVIL_ORIGIN,
  };
  const bare = (address: string) => address.toLowerCase().replace(/^0x/, '');
  return {
    target,
    viewer,
    gateway: parts.gateway,
    chatRead: parts.chatRead,
    chatWrite: parts.chatWrite,
    swarmId: parts.swarmId,
    ensRpc: parts.ensRpc,
    chatHealth: target.chatHealth ?? null,
    ownNodes: target.ownNodes,
    inbox: { key: bare(chat.gsocResourceId), identifier: chat.gsocTopic },
    catalog: { owner: config.catalog.owner, topic: config.catalog.topic },
    deployment: {
      stream: target.stream,
      chatTopic: `chat-${target.stream.topic}`,
      feedOwner: bare(chat.feedOwner),
      inboxOwner: bare(new PrivateKey(bare(chat.gsocResourceId)).publicKey().address().toHex()),
      chatWrite: parts.chatWrite,
    },
    addresses: {
      viewer: parts.viewer,
      swarmId: parts.swarmId,
      gateway: parts.gateway,
      evil: parts.evil,
      all: () => ({ ...parts }),
    },
  };
}
