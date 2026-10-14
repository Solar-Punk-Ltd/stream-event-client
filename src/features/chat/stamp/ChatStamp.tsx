import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { useConnect } from '@/features/connect/ConnectContext';

import { useChatUser } from '../User';
import type { OwnStampSetup } from '../useSwarmChat';

import { type ChatSending, GATEWAY_SENDING } from './chatSending';
import { type ChatStampChoice, GATEWAY_PAYS, loadChatStampChoice, saveChatStampChoice } from './chatStampChoice';
import { type OwnStampRoute, ownStampRoute } from './ownStampRoute';
import { type SiteStamp, siteStampOf, stampWarning, type StampWarning } from './siteStamp';

export const SITE_STAMP_READING = 'reading';
export const SITE_STAMP_NONE = 'none';
export const SITE_STAMP_UNREADABLE = 'unreadable';
export const SITE_STAMP_READ = 'read';

/** What the viewer knows of the stamp Swarm ID gives this site. */
type SiteStampRead =
  | { readonly status: typeof SITE_STAMP_READING }
  /** Swarm ID gives this site no stamp. */
  | { readonly status: typeof SITE_STAMP_NONE }
  /** Swarm ID did not answer, which says nothing about the stamp. */
  | { readonly status: typeof SITE_STAMP_UNREADABLE }
  | { readonly status: typeof SITE_STAMP_READ; readonly stamp: SiteStamp };

interface ChatStampValue {
  /** Whether the viewer is signed in with Swarm ID, without which only the gateway pays. */
  readonly canUseOwnStamp: boolean;
  /** Who pays, as the viewer picked. Always the gateway for a viewer who is not signed in with Swarm ID. */
  readonly choice: ChatStampChoice;
  readonly choosePayWith: (payWith: MessageVia) => void;
  readonly chooseOwnFeed: (ownFeed: boolean) => void;
  /** Where a message on the viewer's own stamp goes out, or why the chat's source cannot send one. */
  readonly route: OwnStampRoute;
  readonly siteStamp: SiteStampRead;
  /** The warning above the message field while the viewer's own stamp pays, or null. */
  readonly warning: StampWarning | null;
  /** Opens Swarm ID's Apps screen in a window of its own, where this site's stamp is chosen and managed. */
  readonly openStampInSwarmId: (() => void) | null;
  /** How the chat sends, for the chat's settings. */
  readonly sending: ChatSending;
  /** What the chat needs to send on the viewer's own stamp, or null while the gateway pays. */
  readonly ownStamp: OwnStampSetup | null;
}

const GATEWAY_ONLY: ChatStampValue = {
  canUseOwnStamp: false,
  choice: GATEWAY_PAYS,
  choosePayWith: () => {},
  chooseOwnFeed: () => {},
  route: { ok: false, reason: '', hint: '' },
  siteStamp: { status: SITE_STAMP_NONE },
  warning: null,
  openStampInSwarmId: null,
  sending: GATEWAY_SENDING,
  ownStamp: null,
};

const ChatStampContext = createContext<ChatStampValue>(GATEWAY_ONLY);

/** Who pays for the viewer's chat messages. Outside a provider, as in a page with no chat, the gateway always pays. */
export function useChatStamp(): ChatStampValue {
  return useContext(ChatStampContext);
}

/** This site's row on Swarm ID's Apps screen, where the stamp it gives the site is chosen, topped up and made bigger. */
export function swarmIdAppsUrl(swarmIdUrl: string, siteOrigin: string): string {
  return `${swarmIdUrl.replace(/\/+$/, '')}/#apps/${encodeURIComponent(siteOrigin)}`;
}

const APPS_WINDOW_NAME = 'swarm-id-apps';
const APPS_WINDOW_FEATURES = 'popup,width=480,height=760';
/** How often the page looks whether the Swarm ID window it opened has closed. */
const WINDOW_CLOSED_POLL_MS = 1_000;
/** The stamp is read again after a send at most this often, since each message changes it by one chunk. */
const READ_AFTER_SEND_MS = 15_000;

/**
 * Who pays for the viewer's chat messages: the event's gateway, as for everyone by default, or the stamp Swarm ID
 * gives this site, once the viewer is signed in with Swarm ID and picks it. The viewer never buys, tops up or holds a
 * stamp. It only reads how the site's stamp stands, again whenever Connect opens, the page comes back into focus, and
 * after messages it sent, and asks Swarm ID to stamp each message. Nothing here switches who pays by itself.
 */
export function ChatStampProvider({ children }: { readonly children: ReactNode }) {
  const { sources, parts, swarmSettings } = useAppContext();
  const { swarmIdSession, swarmIdUrl, getSiteStamp, stampChunk } = useChatUser();
  const { isOpen } = useConnect();
  const [picked, setPicked] = useState<ChatStampChoice>(() => loadChatStampChoice());
  const [siteStamp, setSiteStamp] = useState<SiteStampRead>({ status: SITE_STAMP_READING });
  const accountId = swarmIdSession?.address ?? null;
  const canUseOwnStamp = accountId !== null;
  const choice = canUseOwnStamp ? picked : GATEWAY_PAYS;
  const ownStampPays = choice.payWith === MessageVia.OWN_STAMP;

  const pick = useCallback((next: ChatStampChoice) => {
    saveChatStampChoice(next);
    setPicked(next);
  }, []);
  const choosePayWith = useCallback((payWith: MessageVia) => pick({ ...picked, payWith }), [pick, picked]);
  const chooseOwnFeed = useCallback((ownFeed: boolean) => pick({ ...picked, ownFeed }), [pick, picked]);

  const chatSource = sources.find(({ id }) => id === parts.chat) ?? null;
  const route: OwnStampRoute = useMemo(
    () =>
      chatSource
        ? ownStampRoute(chatSource, swarmSettings.defaultId)
        : { ok: false, reason: 'The chat has no source.', hint: '' },
    [chatSource, swarmSettings.defaultId],
  );

  const readGeneration = useRef(0);
  const lastReadAt = useRef(0);
  const readSiteStamp = useCallback(() => {
    if (!canUseOwnStamp) {
      return;
    }
    readGeneration.current += 1;
    const asked = readGeneration.current;
    lastReadAt.current = Date.now();
    getSiteStamp().then(
      (batch) => {
        if (asked === readGeneration.current) {
          setSiteStamp(batch ? { status: SITE_STAMP_READ, stamp: siteStampOf(batch) } : { status: SITE_STAMP_NONE });
        }
      },
      () => {
        if (asked === readGeneration.current) {
          setSiteStamp({ status: SITE_STAMP_UNREADABLE });
        }
      },
    );
  }, [canUseOwnStamp, getSiteStamp]);

  useEffect(() => {
    readGeneration.current += 1;
    setSiteStamp({ status: SITE_STAMP_READING });
    readSiteStamp();
  }, [accountId, readSiteStamp]);

  useEffect(() => {
    if (isOpen) {
      readSiteStamp();
    }
  }, [isOpen, readSiteStamp]);

  // Back from Swarm ID's window, where the site's stamp may have changed.
  useEffect(() => {
    if (!canUseOwnStamp || typeof window === 'undefined') {
      return;
    }
    window.addEventListener('focus', readSiteStamp);
    return () => window.removeEventListener('focus', readSiteStamp);
  }, [canUseOwnStamp, readSiteStamp]);

  const readAfterSend = useCallback(() => {
    if (Date.now() - lastReadAt.current >= READ_AFTER_SEND_MS) {
      readSiteStamp();
    }
  }, [readSiteStamp]);

  const warning: StampWarning | null = useMemo(() => {
    if (!ownStampPays) {
      return null;
    }
    if (!route.ok) {
      return { title: route.reason, detail: `${route.hint} Or let the gateway pay.`, blocksSending: true };
    }
    switch (siteStamp.status) {
      case SITE_STAMP_NONE:
        return stampWarning(null);
      case SITE_STAMP_READ:
        return stampWarning(siteStamp.stamp);
      default:
        return null;
    }
  }, [ownStampPays, route, siteStamp]);

  const warningRef = useRef(warning);
  warningRef.current = warning;
  const stampChunkRef = useRef(stampChunk);
  stampChunkRef.current = stampChunk;
  const signedInRef = useRef(canUseOwnStamp);
  signedInRef.current = canUseOwnStamp;

  const sending: ChatSending = useMemo(
    () =>
      ownStampPays
        ? { via: MessageVia.OWN_STAMP, url: route.ok ? route.url : null, ownFeed: choice.ownFeed }
        : GATEWAY_SENDING,
    [ownStampPays, route, choice.ownFeed],
  );

  const ownStamp: OwnStampSetup | null = useMemo(
    () =>
      ownStampPays
        ? {
            stamper: () => (signedInRef.current ? { stampChunk: (chunk) => stampChunkRef.current(chunk) } : null),
            ownFeed: choice.ownFeed,
            refusal: () => {
              const current = warningRef.current;
              return current?.blocksSending ? current.title : null;
            },
            onSent: readAfterSend,
          }
        : null,
    [ownStampPays, choice.ownFeed, readAfterSend],
  );

  const openStampInSwarmId = useMemo(
    () =>
      swarmIdUrl
        ? () => {
            const opened = window.open(
              swarmIdAppsUrl(swarmIdUrl, window.location.origin),
              APPS_WINDOW_NAME,
              APPS_WINDOW_FEATURES,
            );
            if (!opened) {
              return;
            }
            // Kept as a handle only, to see it close: the Swarm ID site gets no way back into this page. A window of
            // this name already showing the Swarm ID site may refuse the assignment, and is watched all the same.
            try {
              opened.opener = null;
            } catch {
              // Its opener stays, as it was for the window that was already open.
            }
            const watch = window.setInterval(() => {
              if (opened.closed) {
                window.clearInterval(watch);
                readSiteStamp();
              }
            }, WINDOW_CLOSED_POLL_MS);
          }
        : null,
    [swarmIdUrl, readSiteStamp],
  );

  const value = useMemo(
    () => ({
      canUseOwnStamp,
      choice,
      choosePayWith,
      chooseOwnFeed,
      route,
      siteStamp,
      warning,
      openStampInSwarmId,
      sending,
      ownStamp,
    }),
    [
      canUseOwnStamp,
      choice,
      choosePayWith,
      chooseOwnFeed,
      route,
      siteStamp,
      warning,
      openStampInSwarmId,
      sending,
      ownStamp,
    ],
  );

  return <ChatStampContext.Provider value={value}>{children}</ChatStampContext.Provider>;
}
