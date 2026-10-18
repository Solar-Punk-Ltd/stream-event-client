import { useEffect, useRef, useState } from 'react';

import { healthyPeersNote, useNodeStatus, weeb3StatusLine, weeb3StatusWords } from '@/shared/nodeInTabStatus';
import type { OwnPlayer, PlaybackStart, ProviderStatus } from '@/swarm/provider';

import { followPlace, moveToPlace, type StreamPlace } from './placeAcrossSwap';

import './OwnPlayerStage.scss';

/** What a viewer reads when the source's own player cannot play the stream. */
export const PLAY_FAILED = 'The Swarm node in this browser could not play this stream.';

interface OwnPlayerStageProps {
  readonly load: () => Promise<OwnPlayer>;
  /** Where the source's node is, which the stage shows until it is ready. */
  readonly status: () => ProviderStatus;
  readonly owner: string;
  readonly topic: string;
  /** Where the stream starts, read once when the stage mounts: a live stream that ends while it plays keeps playing. */
  readonly from: PlaybackStart;
  /**
   * Where the viewer was in a recording, which a stage started from the beginning picks up at and records as it is
   * taken down. Absent for a live stream.
   */
  readonly place?: StreamPlace;
}

/**
 * A source's own player, bare: a video element it plays into with the browser's controls, and none of
 * the app's overlays. One quiet line under it says how far the node has got until it is ready, and
 * again when it is lost. A viewer who picked this source watches through it alone, so a player that
 * cannot play says so and nothing takes its place.
 */
export function OwnPlayerStage({ load, status, owner, topic, from, place }: OwnPlayerStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [startFrom] = useState(from);
  const node = useNodeStatus(status);
  const placeRef = useRef(place);
  placeRef.current = place;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let current = true;
    let player: OwnPlayer | null = null;
    // A live start has the live stream's timeline, which a recording's place does not fit.
    const isRecording = startFrom === 'beginning';
    // Read once for the stream this run plays, as the app's player does.
    const streamPlace = placeRef.current;
    const resume = isRecording ? (streamPlace?.recorded() ?? null) : null;
    let stopMoving = (): void => undefined;
    const followed = followPlace(video);
    if (resume?.paused) {
      video.autoplay = false;
    }
    setFailed(false);
    load()
      .then(async (loaded) => {
        if (!current) {
          loaded.detach();
          return;
        }
        player = loaded;
        await loaded.attach(video, owner, topic, startFrom);
        if (current && resume) {
          stopMoving = moveToPlace(video, resume);
        }
      })
      .catch((error: unknown) => {
        console.warn("The source's own player could not play the stream:", error);
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
      stopMoving();
      followed.detach();
      if (isRecording) {
        streamPlace?.record(followed.place());
      }
      video.pause();
      player?.detach();
    };
  }, [load, owner, topic, startFrom]);

  const playing = !failed && node.state === 'ready';
  const note = failed ? null : healthyPeersNote(node);
  // A ready node whose player would not attach could not play this stream. Any other failure is the node's own.
  const words =
    !failed || node.state === 'lost'
      ? weeb3StatusLine(node)
      : node.state === 'ready'
        ? PLAY_FAILED
        : weeb3StatusWords({ state: 'failed' });
  return (
    <div className="own-player-stage">
      <div className="own-player">
        <video ref={videoRef} controls autoPlay muted playsInline />
      </div>
      {!playing && (
        <p className="own-player-status" role="status">
          <span className="own-player-words">{words}</span>
          {note !== null && <span className="own-player-hint">{note}</span>}
        </p>
      )}
    </div>
  );
}
