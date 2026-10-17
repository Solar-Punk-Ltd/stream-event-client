import installBrowser from '../../e2e/installBrowser.ts';
import { probe } from './probe.ts';

const USAGE = `usage: pnpm kit <command>

  up [--fresh]          start the stack, or keep the one that is up, and refuse when the preflight fails
  down [--fresh]        stop the stack, and with --fresh remove its chain, nodes and generated values
  status                what runs, what each check reads, and where each part answers
  libraries             pack the libraries kit.lock.json pins and link them for the kit itself
  bake-ens [--block N]  fork Ethereum mainnet, set the kit's ENS names and record, and dump the snapshot the kit boots
  probe                 measure which addressing scheme gives the viewer and Swarm ID two sites
  run <scenario>        run one scenario against the stack that is up, with its evidence
  test                  up --fresh, run every scenario, down, for one CI job with a Docker daemon
  live run <scenario> --target <file>
                        run one live scenario against the real deployment the target file names
  live test --target <file>
                        run every live scenario against that deployment`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const fresh = rest.includes('--fresh');
  switch (command) {
    case 'probe': {
      installBrowser();
      console.log(JSON.stringify(await probe(), null, 2));
      return 0;
    }
    case 'libraries': {
      const { daemonIsLocal } = await import('./stack.ts');
      if (!daemonIsLocal()) return 1;
      const { prepareLibraries } = await import('./libraries.ts');
      const { readLock } = await import('./lock.ts');
      prepareLibraries(readLock());
      return 0;
    }
    case 'bake-ens': {
      const { daemonIsLocal } = await import('./stack.ts');
      if (!daemonIsLocal()) return 1;
      const { bakeEns } = await import('./ensBake.ts');
      const at = rest.indexOf('--block');
      await bakeEns(at >= 0 ? { block: BigInt(rest[at + 1]) } : {});
      return 0;
    }
    case 'up': {
      const { up } = await import('./stack.ts');
      return up({ fresh });
    }
    case 'down': {
      const { down } = await import('./stack.ts');
      return down({ fresh });
    }
    case 'status': {
      const { status } = await import('./stack.ts');
      return status();
    }
    case 'run': {
      const name = rest.find((arg) => !arg.startsWith('--'));
      if (!name) break;
      const { runScenario } = await import('./runner.ts');
      const { suiteStatus } = await import('./scenario.ts');
      return suiteStatus([await runScenario(name)]);
    }
    case 'test': {
      const { test } = await import('./runner.ts');
      return test();
    }
    case 'live': {
      const [action, ...args] = rest;
      const { liveTest, runLiveScenario, targetFrom } = await import('./liveRun.ts');
      if (action === 'test') return liveTest(targetFrom(args));
      const name = args.find((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--target');
      if (action !== 'run' || !name) break;
      const { suiteStatus } = await import('./scenario.ts');
      return suiteStatus([await runLiveScenario(name, targetFrom(args))]);
    }
  }
  console.error(USAGE);
  return 2;
}

process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  return 1;
});
