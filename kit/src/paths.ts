import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The kit's own folder, which holds the compose file, the lock and the scenarios. */
export const KIT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
/** The repository the kit lives in, whose viewer image it builds. */
export const REPO_DIR = dirname(KIT_DIR);
/** What one stack keeps between commands: the values generated for it. Git ignores it. */
export const RUN_DIR = join(KIT_DIR, '.run');
export const STATE_FILE = join(RUN_DIR, 'state.json');
export const COMPOSE_FILE = join(KIT_DIR, 'compose.yml');
export const SCENARIO_DIR = join(KIT_DIR, 'scenarios');
/** Every run's evidence, one folder per run, in the folder git already ignores. */
export const EVIDENCE_DIR = join(REPO_DIR, 'test-results', 'kit');
