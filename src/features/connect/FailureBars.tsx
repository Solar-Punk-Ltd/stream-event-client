import { useEffect, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';
import type { FeatureFailure, SwarmClient } from '@/swarm/client';
import { sourceName } from '@/swarm/sources';

import { useConnect } from './ConnectContext';
import { failureReason, failureTitle } from './connectWords';

import './FailureBars.scss';

/** How often the bars read the client's failures again, often enough that a bar follows its part. */
const FAILURE_READ_MS = 2_000;

/** What a bar shows of a failure, which is all a change has to differ in to draw the bars again. */
const shownOf = (failures: readonly FeatureFailure[]) =>
  JSON.stringify(failures.map(({ feature, provider, cause }) => [feature, provider, cause]));

const sameFailures = (one: readonly FeatureFailure[], other: readonly FeatureFailure[]) =>
  shownOf(one) === shownOf(other);

function useFailures(swarm: SwarmClient): readonly FeatureFailure[] {
  const [failures, setFailures] = useState<readonly FeatureFailure[]>(() => swarm.failures());
  useEffect(() => {
    const read = () => {
      const next = swarm.failures();
      setFailures((current) => (sameFailures(current, next) ? current : next));
    };
    read();
    const timer = setInterval(read, FAILURE_READ_MS);
    return () => clearInterval(timer);
  }, [swarm]);
  return failures;
}

/**
 * A bar for each part whose source keeps failing, naming the part, the source and why, with one button that opens
 * Connect. The viewer picks another source there, because the page never switches by itself.
 */
export function FailureBars() {
  const { swarm, sources } = useAppContext();
  const { open } = useConnect();
  const failures = useFailures(swarm);

  return failures.map((failure) => (
    <div key={failure.feature} className="failure-bar" data-failing-part={failure.feature}>
      <strong role="status">{failureTitle(failure.feature, sourceName(sources, failure.provider))}</strong>
      <span className="failure-bar-reason">{failureReason(failure)}</span>
      <Button variant={ButtonVariant.SECONDARY} className="failure-bar-button" onClick={open}>
        Choose another source
      </Button>
    </div>
  ));
}
