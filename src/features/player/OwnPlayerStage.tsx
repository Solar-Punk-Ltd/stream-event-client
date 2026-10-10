import { useEffect, useRef, useState } from 'react';

import { healthyPeersNote, useNodeStatus, weeb3StatusWords } from '@/shared/nodeInTabStatus';
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
 * of quality, and none of the app's overlays. One quiet line under it says how far the node has got,
 * then keeps counting its peers while it plays. A viewer who picked this source watches through it
 * alone, so a player that cannot play says so and nothing takes its place.
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
    let player: OwnPlayer | null = null;
    setFailed(false);
    load()
      .then((loaded) => {
        if (!current) {
          loaded.detach();
          return;
        }
        player = loaded;
        return loaded.attach(video, owner, topic, from);
      })
      .catch((error: unknown) => {
        console.warn("The source's own player could not play the stream:", error);
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
      video.pause();
      player?.detach();
    };
  }, [load, owner, topic, from]);

  const note = failed ? null : healthyPeersNote(node);
  return (
    <div className="own-player-stage">
      <div className="own-player">
        <video ref={videoRef} controls autoPlay muted playsInline />
      </div>
      <p className="own-player-status" role="status">
        <span className="own-player-words">{failed ? PLAY_FAILED : weeb3StatusWords(node)}</span>
        {note !== null && <span className="own-player-hint">{note}</span>}
      </p>
    </div>
  );
}
