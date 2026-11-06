import { RoutePending } from '@biddaloy/ui/components';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { SchoolSettingsPage } from '../../pages/SchoolSettingsPage';
import { SETTINGS_CATEGORY_IDS } from '../../pages/settings/settings-categories';
import { loadRouteNamespaces } from '../../route-loaders';

/** [14.11.2] `?backup=<jobId>` — a deep link into `BackupSection` (e.g.
 * from the "your backup is ready" email). Same `z.object` + `.catch`
 * style as `invoices/index.tsx`'s search schema: an unparsable value
 * silently drops rather than 500ing the route. */
const settingsSearchSchema = z.object({
  backup: z.string().optional().catch(undefined),
  /** D30: the selected settings category. */
  section: z.enum(SETTINGS_CATEGORY_IDS).optional().catch(undefined),
  /** 49.10: `?section=billing&buy=1` opens the Buy seats dialog (palette action). */
  buy: z.literal(1).optional().catch(undefined),
  /** 49 W4: bKash sends the admin back with `?section=billing&order=<id>`; the section shows its status. */
  order: z.string().uuid().optional().catch(undefined),
  /** 76.5: `?section=academics&devices=new` opens the Add attendance machine dialog (palette action). */
  devices: z.literal('new').optional().catch(undefined),
  /** How the bKash return went; `error` = the server could not confirm it (generic). */
  payment: z.enum(['success', 'cancel', 'failure', 'error']).optional().catch(undefined),
});

/**
 * `/settings` — [8.7.13]'s settings page. Its own inline permission gate
 * (`useHasPermission(SETTINGS_MANAGE)`, an early-return `<h1>`) is gone
 * as of [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses this
 * route in place before this component ever mounts, using the same
 * `STAFF_ROUTE_PERMISSIONS['/_staff/settings']` = `SETTINGS_MANAGE`
 * entry this file used to check itself. See `route-permissions.ts`.
 */
export const Route = createFileRoute('/_staff/settings')({
  validateSearch: settingsSearchSchema,
  // [8.14.5]: i18n-only — see the plan's "plan correction 5". This
  // route's data comes from `useSchoolSettings(schoolId)`, but `schoolId`
  // is picked client-side from `useSchools()` (a SUPER_ADMIN's school
  // picker), not a route param, so there's nothing this `loader` can
  // `ensureQueryData` ahead of time. `backup` is added here for
  // `BackupSection`'s own header copy and job-status labels.
  // `feeStructures`: the late-fee table names fees from its `feeTypes.*` labels.
  // [613]: `bulkImport` too — `RestoreWizard` mounts the shared
  // `BulkUploadPreview`, whose own copy (file picker, expiry countdown,
  // confirm/upload-another buttons) lives in that namespace.
  // `curriculumPreset`: Academics' `PresetLinkCard`; without it opening
  // that category suspends the whole page.
  loader: () =>
    loadRouteNamespaces(
      'settings',
      'backup',
      'bulkImport',
      'evaluations',
      'feeStructures',
      'curriculumPreset',
      'attention',
      'billing',
    ),
  pendingComponent: SettingsPending,
  component: SettingsRoute,
});

function SettingsRoute() {
  const regionConfig = useTenantRegionConfig();
  const { backup } = Route.useSearch();

  return (
    <RegionConfigProvider value={regionConfig}>
      <SchoolSettingsPage {...(backup !== undefined ? { backupJobId: backup } : {})} />
    </RegionConfigProvider>
  );
}

function SettingsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
