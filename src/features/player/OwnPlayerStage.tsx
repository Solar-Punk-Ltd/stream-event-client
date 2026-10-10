import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { OwnPlayer, PlaybackStart } from '@/swarm/provider';

import './OwnPlayerStage.scss';

/**
 * How long a source's own player may take to show a first picture before the app's player takes over.
 * weeb-3 in headless Chrome took about 4 s to its first peer and about 11 s to a first frame, so this
 * is twice its whole cold start.
 */
export const FIRST_PICTURE_DEADLINE_MS = 30_000;

type Phase = 'starting' | 'playing' | 'replaced';

interface OwnPlayerStageProps {
  readonly load: () => Promise<OwnPlayer>;
  readonly owner: string;
  readonly topic: string;
  readonly from: PlaybackStart;
  /** What a viewer reads while the player starts and nothing shows yet. */
  readonly startingNotice: string;
  /** The app's own player, shown instead when this one shows no picture in time or cannot start. */
  readonly fallback: ReactNode;
}

/** Whether a video is showing a picture: it holds enough to play on, or its playback has moved. */
function showsPicture(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || video.currentTime > 0;
}

const PICTURE_EVENTS = ['playing', 'timeupdate', 'canplay'] as const;

/**
 * A source's own player, bare: a video element it plays into with its own controls and its own choice
 * of quality, and none of the app's overlays. While it starts a plain line says so. If no picture
 * comes within {@link FIRST_PICTURE_DEADLINE_MS}, or the player cannot load or attach, the app's player
 * takes its place for good on this page.
 */
export function OwnPlayerStage({ load, owner, topic, from, startingNotice, fallback }: OwnPlayerStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let settled = false;
    const replace = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      stopListening();
      video.pause();
      video.removeAttribute('src');
      setPhase('replaced');
    };
    const notePicture = () => {
      if (settled || !showsPicture(video)) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      stopListening();
      setPhase('playing');
    };
    const stopListening = () => PICTURE_EVENTS.forEach((name) => video.removeEventListener(name, notePicture));

    PICTURE_EVENTS.forEach((name) => video.addEventListener(name, notePicture));
    const deadline = setTimeout(replace, FIRST_PICTURE_DEADLINE_MS);
    load()
      .then((player) => player.attach(video, owner, topic, from))
      .catch((error: unknown) => {
        console.warn("The source's own player could not start, so the app's player takes over:", error);
        replace();
      });

    return () => {
      settled = true;
      clearTimeout(deadline);
      stopListening();
    };
  }, [load, owner, topic, from]);

  if (phase === 'replaced') {
    return <>{fallback}</>;
  }
  return (
    <div className="own-player">
      <video ref={videoRef} controls autoPlay muted playsInline />
      {phase === 'starting' && (
        <p className="own-player-status" role="status">
          {startingNotice}
        </p>
      )}
    </div>
  );
}
