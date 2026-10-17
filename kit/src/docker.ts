import { spawnSync } from 'node:child_process';

import { docker, DockerError, type DockerResult } from '../../e2e/record/docker.ts';
import { COMPOSE_FILE } from './paths.ts';

export { docker, DockerError, type DockerResult };
export { ownContainerId } from '../../e2e/record/docker.ts';

/** The compose project every kit command works on, as `compose.yml` names it. */
export const PROJECT = 'flow-kit';
/** The network compose makes for the project, which a kit running inside a container joins. */
export const NETWORK = `${PROJECT}_default`;
/** bee-compose keeps its worker nodes behind this profile, so a command on all services names it. */
const WORKERS = ['--profile', 'workers'];

/**
 * `docker compose` on the kit's file, with both streams kept and the environment the file reads. A failure throws
 * with both streams, unless `allowFailure`.
 */
export function compose(
  args: string[],
  env: Record<string, string>,
  { allowFailure = false, inherit = false } = {},
): DockerResult {
  const full = ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...WORKERS, ...args];
  const result = spawnSync('docker', full, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
    stdio: inherit ? ['ignore', 'inherit', 'inherit'] : 'pipe',
  });
  if (result.error) throw result.error;
  const out = { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
  if (result.status !== 0 && !allowFailure) throw new DockerError(full, result.status, out.stdout, out.stderr);
  return out;
}

/** One container of the project, as `docker compose ps --format json` describes it. */
interface ServiceState {
  Service: string;
  Name: string;
  State: string;
  Health: string;
  ExitCode: number;
}

export function services(env: Record<string, string>): ServiceState[] {
  const { stdout } = compose(['ps', '--all', '--format', 'json'], env, { allowFailure: true });
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as ServiceState);
}
