import { Link } from 'react-router';

import { useAppContext } from '@/app/AppProvider';
import { SwarmIdPageNotice } from '@/features/chat/swarmId/SwarmIdParts';
import { Connect } from '@/features/connect/Connect';
import { FailureBars } from '@/features/connect/FailureBars';

import './MainLayout.scss';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { chat, themeContent } = useAppContext();

  return (
    <div className="main-layout">
      <header className="main-layout-header">
        <Link to="/" className="main-layout-logo-link" aria-label="All streams">
          <img src={themeContent.logoUrl} alt={themeContent.logoAlt} className="main-layout-logo" />
        </Link>
        <div className="main-layout-actions">
          <Connect />
        </div>
      </header>
      <FailureBars />
      {chat && <SwarmIdPageNotice />}
      <main className="main-layout-content">{children}</main>
    </div>
  );
}
