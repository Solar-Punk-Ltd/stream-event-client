import { MessageVia } from '@solarpunkltd/swarm-chat-js/message';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { pushStampedSocThroughWeeb3 } from '@/swarm/providers/weeb-3/weeb3Push';
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
  /** Where a message on the viewer's own stamp goes out, or why the chat's source cannot send one. */
  readonly route: OwnStampRoute;
  readonly siteStamp: SiteStampRead;
  /** The warning above the message field while the viewer's own stamp pays, or null. */
  readonly warning: StampWarning | null;
  /** How the chat sends, for the chat's settings. */
  readonly sending: ChatSending;
  /** What the chat needs to send on the viewer's own stamp, or null while the gateway pays. */
  readonly ownStamp: OwnStampSetup | null;
}

const GATEWAY_ONLY: ChatStampValue = {
  canUseOwnStamp: false,
  choice: GATEWAY_PAYS,
  choosePayWith: () => {},
  route: { ok: false, reason: '', hint: '' },
  siteStamp: { status: SITE_STAMP_NONE },
  warning: null,
  sending: GATEWAY_SENDING,
  ownStamp: null,
};

const ChatStampContext = createContext<ChatStampValue>(GATEWAY_ONLY);

/** Who pays for the viewer's chat messages. Outside a provider, as in a page with no chat, the gateway always pays. */
export function useChatStamp(): ChatStampValue {
  return useContext(ChatStampContext);
}

/** The stamp is read again after a send at most this often, since each message changes it by one chunk. */
const READ_AFTER_SEND_MS = 15_000;

/**
 * Who pays for the viewer's chat messages: the event's gateway, as for everyone by default, or the stamp Swarm ID
 * gives this site, once the viewer is signed in with Swarm ID and picks it. The viewer never buys, tops up or holds a
 * stamp. It only reads how the site's stamp stands, again whenever Connect opens, the page comes back into focus, Swarm
 * ID reports another stamp for this site, as it does once one is picked in its window, and after messages it sent, and
 * asks Swarm ID to stamp each message. While Swarm ID names no stamp for this site, it has none, with no read. Nothing
 * here switches who pays by itself.
 */
export function ChatStampProvider({ children }: { readonly children: ReactNode }) {
  const { sources, parts, swarmSettings } = useAppContext();
  const { swarmIdSession, getSiteStamp, getSiteStampId, onSwarmIdConnectionChange, stampChunk } = useChatUser();
  const { isOpen } = useConnect();

  const [siteStamp, setSiteStamp] = useState<SiteStampRead>({ status: SITE_STAMP_READING });
  const accountId = swarmIdSession?.address ?? null;
  const canUseOwnStamp = accountId !== null;
  const [picked, setPicked] = useState<{ readonly accountId: string | null; readonly choice: ChatStampChoice }>(() => ({
    accountId,
    choice: accountId ? loadChatStampChoice(accountId) : GATEWAY_PAYS,
  }));
  if (picked.accountId !== accountId) {
    setPicked({ accountId, choice: accountId ? loadChatStampChoice(accountId) : GATEWAY_PAYS });
  }
  const choice = canUseOwnStamp && picked.accountId === accountId ? picked.choice : GATEWAY_PAYS;
  const ownStampPays = choice.payWith === MessageVia.OWN_STAMP;

  const pick = useCallback(
    (next: ChatStampChoice) => {
      if (!accountId) {
        return;
      }
      saveChatStampChoice(accountId, next);
      setPicked({ accountId, choice: next });
    },
    [accountId],
  );
  const choosePayWith = useCallback((payWith: MessageVia) => pick({ payWith }), [pick]);

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
  /** The stamp the figures shown are for, or null for none. */
  const shownStampId = useRef<string | null>(null);
  const readSiteStamp = useCallback(() => {
    if (!canUseOwnStamp) {
      return;
    }
    readGeneration.current += 1;
    const asked = readGeneration.current;
    const stampId = getSiteStampId();
    shownStampId.current = stampId;
    if (stampId === null) {
      setSiteStamp({ status: SITE_STAMP_NONE });
      return;
    }
    lastReadAt.current = Date.now();
    getSiteStamp().then(
      (batch) => {
        if (asked === readGeneration.current) {
          setSiteStamp(batch ? { status: SITE_STAMP_READ, stamp: siteStampOf(batch) } : { status: SITE_STAMP_NONE });
        }
      },
      () => {
        if (asked === readGeneration.current) {
          shownStampId.current = null;
          setSiteStamp({ status: SITE_STAMP_UNREADABLE });
        }
      },
    );
  }, [canUseOwnStamp, getSiteStamp, getSiteStampId]);

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

  /**
   * A report that names the same stamp again changes none of its figures, so it is read only when the stamp changed or
   * the last read went unanswered.
   */
  const readReportedStamp = useCallback(() => {
    if (getSiteStampId() !== shownStampId.current) {
      readSiteStamp();
    }
  }, [getSiteStampId, readSiteStamp]);

  useEffect(() => onSwarmIdConnectionChange(readReportedStamp), [onSwarmIdConnectionChange, readReportedStamp]);

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
  const routeRef = useRef(route);
  routeRef.current = route;

  const sending: ChatSending = useMemo(
    () =>
      ownStampPays
        ? {
            via: MessageVia.OWN_STAMP,
            url: route.ok && route.through === 'bee-node' ? route.url : null,
          }
        : GATEWAY_SENDING,
    [ownStampPays, route],
  );

  const ownStamp: OwnStampSetup | null = useMemo(
    () =>
      ownStampPays
        ? {
            stamper: () => (signedInRef.current ? { stampChunk: (chunk) => stampChunkRef.current(chunk) } : null),
            refusal: () => {
              const current = warningRef.current;
              return current?.blocksSending ? current.title : null;
            },
            onSent: readAfterSend,
            push: () => {
              const current = routeRef.current;
              return current.ok && current.through === 'weeb-3' ? pushStampedSocThroughWeeb3 : null;
            },
          }
        : null,
    [ownStampPays, readAfterSend],
  );

  const value = useMemo(
    () => ({
      canUseOwnStamp,
      choice,
      choosePayWith,
      route,
      siteStamp,
      warning,
      sending,
      ownStamp,
    }),
    [canUseOwnStamp, choice, choosePayWith, route, siteStamp, warning, sending, ownStamp],
  );

  return <ChatStampContext.Provider value={value}>{children}</ChatStampContext.Provider>;
}
