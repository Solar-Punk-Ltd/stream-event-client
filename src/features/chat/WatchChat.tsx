import { lazy, Suspense } from 'react';

import { useAppContext } from '@/app/AppProvider';
import type { ChatConfig } from '@/config/runtimeConfig';

import './WatchChat.scss';

/**
 * The chat, the chat library and its own Bee client are a file of their own, fetched as the watch page
 * opens, beside the player rather than after it. The file is small next to the video's first segments,
 * and a viewer who came for the chat does not wait for the first frame to see it.
 */
const Chat = lazy(() => import('./Chat/Chat'));

interface WatchChatProps {
  chat: ChatConfig;
  topic: string;
}

function ChatPlaceholder() {
  return (
    <div className="watch-chat-placeholder" role="status">
      <p className="watch-chat-placeholder-detail">Loading the chat…</p>
    </div>
  );
}

export function WatchChat({ chat, topic }: WatchChatProps) {
  const { chatReads } = useAppContext();
  return (
    <Suspense fallback={<ChatPlaceholder />}>
      <Chat chat={chat} topic={topic} reads={chatReads} />
    </Suspense>
  );
}
