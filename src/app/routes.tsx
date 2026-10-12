import { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { MainLayout } from './layout/MainLayout';
import { StreamBrowser } from '@/features/catalog/StreamBrowser/StreamBrowser';
import { StreamWatcher } from '@/features/player/StreamWatcher/StreamWatcher';
import { NotAStreamPage } from '@/features/player/StreamWatcher/NotAStreamPage';

export enum ROUTES {
  STREAM_BROWSER = '/',
  STREAM_WATCH = '/watch/:mediatype/:owner/:topic',
}

const BaseRouter = (): ReactElement => {
  return (
    <MainLayout>
      <Routes>
        <Route path={ROUTES.STREAM_BROWSER} element={<StreamBrowser />} />
        <Route path={ROUTES.STREAM_WATCH} element={<StreamWatcher />} />
        <Route path="*" element={<NotAStreamPage />} />
      </Routes>
    </MainLayout>
  );
};

export default BaseRouter;
