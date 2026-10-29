import { Link } from 'react-router';

import { ROUTES } from '@/app/routes';

import { WatchLayout } from './WatchLayout';
import { NotAStreamLink } from './WatchPlaceholder';

/** Any address no route matches, a watch link cut off when it was copied among them. */
export function NotAStreamPage() {
  return (
    <WatchLayout
      back={
        <Link className="watch-back" to={ROUTES.STREAM_BROWSER}>
          <span aria-hidden="true">←</span> Back
        </Link>
      }
      stage={<NotAStreamLink />}
    />
  );
}
