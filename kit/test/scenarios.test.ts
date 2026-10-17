import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCENARIO_DIR } from '../src/paths.ts';
import { parseScenario, unknownVerbs } from '../src/scenario.ts';
import { CHECKS, VERBS } from '../src/verbs.ts';

const files = readdirSync(SCENARIO_DIR).filter((file) => file.endsWith('.json'));

describe('every scenario in kit/scenarios', () => {
  it.each(files)('%s parses and names only verbs and checks the kit has', (file) => {
    const scenario = parseScenario(JSON.parse(readFileSync(join(SCENARIO_DIR, file), 'utf8')));
    expect(`${scenario.name}.json`).toBe(file);
    expect(unknownVerbs(scenario, new Set(VERBS.keys()), new Set(CHECKS.keys()))).toEqual([]);
  });
});
