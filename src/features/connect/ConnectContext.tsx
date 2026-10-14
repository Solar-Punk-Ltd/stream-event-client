import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

interface ConnectState {
  readonly isOpen: boolean;
  /** Opens Connect, where the viewer joins the chat and picks where each part reads from. */
  readonly open: () => void;
  readonly close: () => void;
}

const ConnectContext = createContext<ConnectState | undefined>(undefined);

export function useConnect(): ConnectState {
  const context = useContext(ConnectContext);
  if (!context) {
    throw new Error('useConnect must be used within ConnectProvider');
  }
  return context;
}

/** Whether Connect is open, for everything on the page that opens it: the header, the chat and a failing part. */
export function ConnectProvider({ children }: { readonly children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <ConnectContext.Provider value={value}>{children}</ConnectContext.Provider>;
}
