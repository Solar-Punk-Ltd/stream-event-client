import { useAppContext } from '@/app/AppProvider';
import { Footer } from '@/app/layout/Footer/Footer';
import { CATALOG_POLL_INTERVAL_MS } from '@/features/catalog/catalogPoll';
import { StreamList } from '@/features/catalog/StreamList/StreamList';
import { useCatalogPoll } from '@/features/catalog/useCatalogPoll';
import { SocialLinks } from '@/shared/components/SocialLinks/SocialLinks';
import { Spinner } from '@/shared/components/Spinner/Spinner';

import { CATALOG_VIEW_MESSAGE, catalogViewFrom } from './catalogView';

import './StreamBrowser.scss';

export function StreamBrowser() {
  const { streamList, isStreamListFromCurrentGateway, theme } = useAppContext();
  const { error, isLoading } = useCatalogPoll(CATALOG_POLL_INTERVAL_MS);

  const view = catalogViewFrom({
    isLoading,
    hasError: Boolean(error),
    streamCount: streamList.length,
    isFromCurrentGateway: isStreamListFromCurrentGateway,
  });

  return (
    <div className="stream-browser-page">
      <div className={theme.heroImageUrl ? 'stream-browser-hero stream-browser-hero--image' : 'stream-browser-hero'}>
        {theme.heroImageUrl && (
          <>
            <img className="stream-browser-hero-image" src={theme.heroImageUrl} alt="" />
            <div className="stream-browser-hero-overlay" aria-hidden="true" />
          </>
        )}
        <div className="stream-browser-hero-content">
          {theme.heroEyebrow && <p className="stream-browser-eyebrow">{theme.heroEyebrow}</p>}
          <h1 className="stream-browser-title">
            {theme.heroTitleImageUrl ? (
              <img className="stream-browser-title-image" src={theme.heroTitleImageUrl} alt={theme.heroTitle} />
            ) : (
              theme.heroTitle
            )}
          </h1>
          <p className="stream-browser-subtitle">{theme.heroSubtitle}</p>
          {theme.heroDate && <p className="stream-browser-date">{theme.heroDate}</p>}
          {theme.heroSocial && theme.footer.social && <SocialLinks links={theme.footer.social.links} variant="tiles" />}
          {theme.heroCta && (
            <a className="stream-browser-cta" href={theme.heroCta.href} target="_blank" rel="noreferrer">
              {theme.heroCta.label} <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </div>
      {(theme.heroTagline || theme.heroBody) && (
        <section className="stream-browser-intro">
          {theme.heroTagline && <h2 className="stream-browser-tagline">{theme.heroTagline}</h2>}
          {theme.heroBody && <p className="stream-browser-body">{theme.heroBody}</p>}
        </section>
      )}
      <div className="stream-browser">
        {view === 'streams' ? (
          <StreamList />
        ) : (
          <div className={`stream-browser-notice ${view}`} role={view === 'unreachable' ? 'alert' : 'status'}>
            {view === 'loading' && <Spinner />}
            <p>{CATALOG_VIEW_MESSAGE[view]}</p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
