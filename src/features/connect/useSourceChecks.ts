import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { onlyGateway } from '@/features/gateway/gatewayProbe';
import { runSourceChecks, type StepState } from '@/features/gateway/sourceChecks';
import type { SwarmClient } from '@/swarm/client';
import { createSwarmClient } from '@/swarm/createSwarmClient';
import { chatHistorySettingOf, gatewaySettingOf, type Source } from '@/swarm/sources';

/** A source as the checks take it, one not added yet among them. */
type CheckedSource = Pick<Source, 'id' | 'type' | 'url' | 'offered'>;

/** A client whose every part reads from one source, its chat history where that source serves the chat. */
export function useCheckClient(): (source: CheckedSource) => SwarmClient {
  const { swarmSettings, chat } = useAppContext();
  return useCallback(
    (source: CheckedSource) =>
      createSwarmClient(onlyGateway(gatewaySettingOf(source)), {
        routes: { chat: chatHistorySettingOf(source, swarmSettings.defaultId, chat?.readUrl ?? null) },
      }),
    [swarmSettings, chat],
  );
}

interface SourceChecks {
  /** The checks of the last run, filling in as it goes, or null before one is asked for. */
  readonly results: readonly StepState[] | null;
  /** Runs the checks of a source through a client made for it, stopping a run still going. Answers the end state. */
  readonly run: (source: CheckedSource, client?: SwarmClient) => Promise<readonly StepState[]>;
  /** Forgets the last run and stops it if it is still going, as a change of address does. */
  readonly reset: () => void;
}

/** The checks one view runs, stopped when the view goes away so a late answer lands nowhere. */
export function useSourceChecks(): SourceChecks {
  const { catalogFeed, streamList, swarm } = useAppContext();
  const clientFor = useCheckClient();
  const [results, setResults] = useState<readonly StepState[] | null>(null);
  const running = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    running.current?.abort();
    running.current = null;
    setResults(null);
  }, []);

  const run = useCallback(
    async (source: CheckedSource, client?: SwarmClient) => {
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      const finished = await runSourceChecks(
        source,
        {
          client: client ?? clientFor(source),
          catalog: catalogFeed,
          knownStreams: streamList,
          clockOffsetMs: swarm.clockOffsetMs(),
          signal: controller.signal,
        },
        (progress) => {
          if (!controller.signal.aborted) {
            setResults(progress);
          }
        },
      );
      return finished;
    },
    [catalogFeed, clientFor, streamList, swarm],
  );

  useEffect(() => () => running.current?.abort(), []);

  return { results, run, reset };
}
