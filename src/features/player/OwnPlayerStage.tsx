import { useEffect, useRef, useState } from 'react';

import { useNodeStatus, weeb3StatusWords } from '@/shared/nodeInTabStatus';
import type { OwnPlayer, PlaybackStart, ProviderStatus } from '@/swarm/provider';

import './OwnPlayerStage.scss';

/** What a viewer reads when the source's own player cannot play the stream. */
export const PLAY_FAILED = 'The Swarm node in this browser could not play this stream.';

interface OwnPlayerStageProps {
  readonly load: () => Promise<OwnPlayer>;
  /** Where the source's node is, which the stage shows until it is ready. */
  readonly status: () => ProviderStatus;
  readonly owner: string;
  readonly topic: string;
  readonly from: PlaybackStart;
}

/**
 * A source's own player, bare: a video element it plays into with its own controls and its own choice
 * of quality, and none of the app's overlays. Until its node is ready a plain line says how far it
 * has got. A viewer who picked this source watches through it alone, so a player that cannot play
 * says so and nothing takes its place.
 */
export function OwnPlayerStage({ load, status, owner, topic, from }: OwnPlayerStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const node = useNodeStatus(status);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let current = true;
    setFailed(false);
    load()
      .then((player) => player.attach(video, owner, topic, from))
      .catch((error: unknown) => {
        console.warn("The source's own player could not play the stream:", error);
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [load, owner, topic, from]);

  const line = failed ? PLAY_FAILED : node.state === 'ready' ? null : weeb3StatusWords(node);
  return (
    <div className="own-player">
      <video ref={videoRef} controls autoPlay muted playsInline />
      {line !== null && (
        <p className="own-player-status" role="status">
          {line}
        </p>
      )}
    </div>
  );
}
