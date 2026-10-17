import { afterEach, describe, expect, it } from 'vitest';

import { coTenants, machine } from '../src/evidence.ts';

const PATH = process.env.PATH;

describe('machine', () => {
  afterEach(() => {
    process.env.PATH = PATH;
  });

  // A live run executes inside a browser image that has no docker program at all, which spawnSync reports as an
  // error rather than as a failed status, so the machine's Docker bounds are left out instead of stopping the run.
  it('answers without Docker bounds where no docker program exists', () => {
    process.env.PATH = '/nonexistent';

    const answer = machine();

    expect(answer.dockerCpus).toBeNull();
    expect(answer.dockerMemoryBytes).toBeNull();
    expect(answer.cpus).toBeGreaterThan(0);
  });

  it('says the co-tenants are unknown, not none, where no docker program exists', () => {
    process.env.PATH = '/nonexistent';

    expect(coTenants()).toBeNull();
  });
});
