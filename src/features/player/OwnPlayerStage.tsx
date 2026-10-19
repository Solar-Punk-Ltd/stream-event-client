import { useEffect, useId, useRef, useState } from 'react';

import {
  healthyPeersNote,
  peerCountWords,
  useNodeStatus,
  weeb3StatusLine,
  weeb3StatusWords,
} from '@/shared/nodeInTabStatus';
import type { OwnPlayer, PlaybackStart, PlayerQuality, ProviderStatus } from '@/swarm/provider';

import { followPlace, moveToPlace, type StreamPlace } from './placeAcrossSwap';
import { BY_PEERS, type QualityChoice, qualitySteps } from './qualityByPeers';
import { useOwnPlayerQuality } from './useOwnPlayerQuality';

import './OwnPlayerStage.scss';

/** What a viewer reads when the source's own player cannot play the stream. */
export const PLAY_FAILED = 'The Swarm node in this browser could not play this stream.';

/** What a viewer reads while a recording's video is held still until it can go to where they were. */
export const MOVING_TO_PLACE = 'Going to where you were in the recording';

/** The quality picker's first choice, which follows the node's peer count. */
export const BY_PEERS_LABEL = 'By peers';

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
 * again when it is lost. While it plays, the line says the node's peers and the height playing, with a
 * quality picker where the player offers one. A viewer who picked this source watches through it alone, so a player that
 * cannot play says so and nothing takes its place.
 */
export function OwnPlayerStage({ load, status, owner, topic, from, place }: OwnPlayerStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [startFrom] = useState(from);
  const [isMovingToPlace, setIsMovingToPlace] = useState(false);
  const [attached, setAttached] = useState<OwnPlayer | null>(null);
  const node = useNodeStatus(status);
  const { quality, choice, pick } = useOwnPlayerQuality(attached, videoRef.current, node.peers ?? 0);
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
    const streamPlace = placeRef.current;
    const resume = isRecording ? (streamPlace?.recorded() ?? null) : null;
    const followed = followPlace(video);
    // Until the video reaches the place, where it is says nothing about where the viewer was.
    let isAtPlace = resume === null;
    setIsMovingToPlace(!isAtPlace);
    const stopMoving = resume
      ? moveToPlace(video, resume, () => {
          isAtPlace = true;
          if (current) {
            setIsMovingToPlace(false);
          }
        })
      : () => undefined;
    setFailed(false);
    setAttached(null);
    load()
      .then(async (loaded) => {
        if (!current) {
          loaded.detach();
          return;
        }
        player = loaded;
        await loaded.attach(video, owner, topic, startFrom);
        if (current) {
          setAttached(loaded);
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
      if (isRecording && isAtPlace) {
        streamPlace?.record(followed.place());
      }
      video.pause();
      player?.detach();
    };
  }, [load, owner, topic, startFrom]);

  const isReady = !failed && node.state === 'ready';
  const playing = isReady && !isMovingToPlace;
  const note = failed ? null : healthyPeersNote(node);
  // A ready node whose player would not attach could not play this stream. Any other failure is the node's own.
  const words = isReady
    ? MOVING_TO_PLACE
    : !failed || node.state === 'lost'
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
      {playing && quality !== null && (
        <QualityLine quality={quality} peers={node.peers ?? 0} choice={choice} onPick={pick} />
      )}
    </div>
  );
}

interface QualityLineProps {
  readonly quality: PlayerQuality;
  readonly peers: number;
  readonly choice: QualityChoice;
  readonly onPick: (choice: QualityChoice) => void;
}

const heightWords = (height: number) => `${height}p`;

/** The node's peers and the height playing, such as "88 peers · 720p", and the picker: By peers, or a height held. */
function QualityLine({ quality, peers, choice, onPick }: QualityLineProps) {
  const pickerId = useId();
  const steps = qualitySteps(quality.levels);
  const playing = quality.levels.find(({ level }) => level === quality.currentLevel);
  const shown = [peerCountWords(peers), playing ? heightWords(playing.height) : null].filter(Boolean).join(' · ');
  return (
    <div className="own-player-quality">
      <span className="own-player-playing">{shown}</span>
      <label className="own-player-picker" htmlFor={pickerId}>
        Quality
        <select
          id={pickerId}
          value={String(choice)}
          onChange={(event) => onPick(event.target.value === BY_PEERS ? BY_PEERS : Number(event.target.value))}
        >
          <option value={BY_PEERS}>{BY_PEERS_LABEL}</option>
          {steps.map(({ height }) => (
            <option key={height} value={String(height)}>
              {heightWords(height)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
