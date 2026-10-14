import type { ComponentProps } from 'react';

import { ChatUserProvider } from '@/features/chat/User';

import { useAppContext } from './AppProvider';

/** Who the viewer is in the chat, with Swarm ID reading this site's content through the source picked for the chat history. */
export function AppChatUserProvider(props: Omit<ComponentProps<typeof ChatUserProvider>, 'beeApiUrl'>) {
  const { chatHistoryBeeUrl } = useAppContext();
  return <ChatUserProvider {...props} beeApiUrl={chatHistoryBeeUrl} />;
}
