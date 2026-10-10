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
  const { streamList, isStreamListFromCurrentGateway, themeContent } = useAppContext();
  const { error, isLoading } = useCatalogPoll(CATALOG_POLL_INTERVAL_MS);

  const view = catalogViewFrom({
    isLoading,
    hasError: Boolean(error),
    streamCount: streamList.length,
    isFromCurrentGateway: isStreamListFromCurrentGateway,
  });

  return (
    <div className="stream-browser-page">
      <div
        className={themeContent.heroImageUrl ? 'stream-browser-hero stream-browser-hero--image' : 'stream-browser-hero'}
      >
        {themeContent.heroImageUrl && (
          <>
            <img className="stream-browser-hero-image" src={themeContent.heroImageUrl} alt="" />
            <div className="stream-browser-hero-overlay" aria-hidden="true" />
          </>
        )}
        <div className="stream-browser-hero-content">
          {themeContent.heroEyebrow && <p className="stream-browser-eyebrow">{themeContent.heroEyebrow}</p>}
          <h1 className="stream-browser-title">
            {themeContent.heroTitleImageUrl ? (
              <img
                className="stream-browser-title-image"
                src={themeContent.heroTitleImageUrl}
                alt={themeContent.heroTitle}
              />
            ) : (
              themeContent.heroTitle
            )}
          </h1>
          <p className="stream-browser-subtitle">{themeContent.heroSubtitle}</p>
          {themeContent.heroDate && <p className="stream-browser-date">{themeContent.heroDate}</p>}
          {themeContent.heroSocial && themeContent.footer.social && (
            <SocialLinks links={themeContent.footer.social.links} variant="tiles" />
          )}
          {themeContent.heroCta && (
            <a className="stream-browser-cta" href={themeContent.heroCta.href} target="_blank" rel="noreferrer">
              {themeContent.heroCta.label} <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </div>
      {(themeContent.heroTagline || themeContent.heroBody) && (
        <section className="stream-browser-intro">
          {themeContent.heroTagline && <h2 className="stream-browser-tagline">{themeContent.heroTagline}</h2>}
          {themeContent.heroBody && <p className="stream-browser-body">{themeContent.heroBody}</p>}
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
