import { DashboardWidgetKey } from '@biddaloy/shared';

import { LatestNoticesCard } from '../../../features/notices/read/latest-notices-card';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.LATEST_NOTICES;

// The grid already picks the variant per breakpoint; a tile (not offered in the catalogue) falls back to compact.
export default function LatestNoticesWidget({ variant }: WidgetProps) {
  return <LatestNoticesCard variant={variant === 'full' ? 'full' : 'compact'} />;
}
