import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import type { Addressing } from './addresses.ts';
import { OFFLINE_ANVIL_ARGS, readSnapshot } from './ens.ts';
import { LIBRARY_SET_DIR, setId } from './libraries.ts';
import type { KitLock } from './lock.ts';
import { KIT_DIR, RUN_DIR, STATE_FILE } from './paths.ts';
import type { ProbeResult } from './probe.ts';

/**
 * What `kit up` generated for one stack, kept beside it until `kit down --fresh` removes both. The keys here are
 * throwaway values made for this stack's own local chain, worth nothing anywhere else, and the file is readable by
 * its owner alone. No command prints them.
 */
export interface KitState {
  createdAt: string;
  addressing: Addressing;
  /** The multiaddr bee-compose's workers dial the queen by. */
  bootnode: string;
  probe: ProbeResult;
  stamps: {
    /** The gateway's batch on worker-1, which stamps every gateway-paid chat write and the server's heartbeats. */
    gateway: string;
    /** The chat server's batch on worker-2, for its feed entries, history files and slot notes. */
    server: string;
    /** The batch on the queen the stream and the stream list were published with. */
    publish: string;
  };
  /** The key the chat server writes every chat feed under. */
  feedKey: string;
  feedOwner: string;
  /** The inbox key, mined so the inbox address lands beside the queen, public by design. */
  gsocKey: string;
  gsocIdentifier: string;
  stream: { owner: string; topic: string; title: string; catalogTopic: string };
  chatTopic: string;
  /** How long each phase of the bring-up that made this state took, in milliseconds. */
  timings: Record<string, number>;
}

export function readState(): KitState | null {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as KitState) : null;
}

export function writeState(state: KitState): void {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
}

export function forgetState(): void {
  rmSync(RUN_DIR, { recursive: true, force: true });
}

/** The environment `compose.yml` reads: the pins, and once a stack exists, the values generated for it. */
export function composeEnv(lock: KitLock, addresses: Record<string, string>, state: KitState | null) {
  const env: Record<string, string> = {
    BEE_VERSION: lock.bee,
    FOUNDRY_VERSION: lock.foundry,
    BEE_WORKER_1_FULL: 'true',
    BEE_WORKER_2_FULL: 'true',
    KIT_SWARM_ID_REPO: lock.swarmId.repo,
    KIT_SWARM_ID_COMMIT: lock.swarmId.commit,
    KIT_CHAT_SERVER_REPO: lock.chatServer.repo,
    KIT_CHAT_SERVER_COMMIT: lock.chatServer.commit,
    KIT_DIR,
    KIT_LIBRARIES_DIR: LIBRARY_SET_DIR,
    KIT_LIBRARIES_ID: setId(lock.libraries),
    KIT_VIEWER_ORIGIN: addresses.viewer,
    KIT_EVIL_ORIGIN: addresses.evil,
    // The real Swarm ID build lists the viewer and the hostile site, so one account can connect to both and the kit
    // can show per-site keys differ. The strict build (compose) lists the viewer only, for the unlisted check.
    KIT_LISTED_ORIGINS: `${addresses.viewer} ${addresses.evil}`,
    KIT_SWARM_ID_ORIGIN: addresses.swarmId,
    KIT_GATEWAY_ORIGIN: addresses.gateway,
    KIT_ETHEREUM_ORIGIN: addresses.ethereum,
    KIT_ENS_STATE: readSnapshot().stateSha256.slice(0, 12),
    KIT_ETHEREUM_ARGS: OFFLINE_ANVIL_ARGS.join(' '),
  };
  if (state) {
    Object.assign(env, {
      KIT_GATEWAY_STAMP: state.stamps.gateway,
      KIT_SERVER_STAMP: state.stamps.server,
      KIT_FEED_KEY: state.feedKey,
      KIT_GSOC_KEY: state.gsocKey,
      KIT_GSOC_IDENTIFIER: state.gsocIdentifier,
      KIT_CHAT_TOPIC: state.chatTopic,
      QUEEN_BOOTNODE: state.bootnode,
    });
  }
  return env;
}
