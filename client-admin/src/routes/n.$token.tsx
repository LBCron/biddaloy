/** [53.6.01] The public notice page `/n/<token>`: no login, no session. The body and its rules live in `-public-notice.tsx`. */
import { AuthLayout } from '@biddaloy/ui/components';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../route-loaders';

import { PublicNotice } from './-public-notice';

export const Route = createFileRoute('/n/$token')({
  loader: () => loadRouteNamespaces('notices', 'common'),
  component: PublicNoticePage,
});

function PublicNoticePage() {
  const { token } = Route.useParams();
  return (
    <AuthLayout>
      <PublicNotice token={token} />
    </AuthLayout>
  );
}
