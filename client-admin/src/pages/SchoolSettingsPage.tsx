import { Permission } from '@biddaloy/shared';
import {
  ApiError,
  decodeAccessTokenMemberships,
  getActiveRole,
  getActiveTenant,
} from '@biddaloy/ui/api';
import {
  ErrorState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useAccessToken,
  useHasPermission,
  useMessagingProviders,
  useSchoolSettings,
  useSchools,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { Link, useLocation, useSearch } from '@tanstack/react-router';
import { ChevronLeftIcon } from 'lucide-react';
import * as React from 'react';

import { SeatsBillingSection } from '../features/billing/SeatsBillingSection';

import { AcrCriteriaSection } from './settings/AcrCriteriaSection';
import { AlertsSection } from './settings/AlertsSection';
import { ApplicationsSection } from './settings/ApplicationsSection';
import { AttendanceSection } from './settings/AttendanceSection';
import { BackupSection } from './settings/backup-section';
import { CalendarSection } from './settings/CalendarSection';
import { DashboardSection } from './settings/DashboardSection';
import { DocumentsSection } from './settings/DocumentsSection';
import { EmailSection } from './settings/EmailSection';
import { EvaluationsSection } from './settings/EvaluationsSection';
import { FeesSection } from './settings/FeesSection';
import { HomeworkSection } from './settings/HomeworkSection';
import { MessengerSection } from './settings/MessengerSection';
import { OrganisationSection } from './settings/OrganisationSection';
import { PresetLinkCard } from './settings/PresetLinkCard';
import { PrintersSection } from './settings/PrintersSection';
import { RegionalSection } from './settings/RegionalSection';
import { SchoolProfileSection } from './settings/school-profile-section';
import {
  resolveSettingsCategory,
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from './settings/settings-categories';
import { SettingsLayout } from './settings/settings-layout';
import { SignInSection } from './settings/SignInSection';
import { SmsCreditSection } from './settings/SmsCreditSection';
import { SmsSection } from './settings/SmsSection';
import { StudyPlansSection } from './settings/StudyPlansSection';
import { WhatsAppSection } from './settings/WhatsAppSection';

/**
 * #8.7.13's dashboard, grouped into categories (31.4 settings-1a, D30): a
 * side list of categories, the selected one in `?section=`, and only that
 * category's sections on screen. Old `#anchor` and `?backup=` links resolve
 * to their category. To register a section, see `settings/settings-categories.ts`.
 * A SUPER_ADMIN picks a school first (an ADMIN always configures their own);
 * each section saves independently. Reachability (nav item, permission check)
 * is `_staff.tsx`'s job: this page assumes the caller holds `SETTINGS_MANAGE`.
 */
export interface SchoolSettingsPageProps {
  /** [14.11.2] The `id` from `?backup=<jobId>` in the URL, threaded down
   * from `_staff/settings.tsx`'s `Route.useSearch()` to `BackupSection`,
   * which is the only section a deep link ever targets. */
  backupJobId?: string;
}

export function SchoolSettingsPage({ backupJobId }: SchoolSettingsPageProps = {}) {
  const { t } = useTranslation('settings');
  const superAdminRole = getActiveRole() === 'SUPER_ADMIN';
  const ownSchoolId = getActiveTenant();

  const schoolsQuery = useSchools({ enabled: superAdminRole });
  const schools = schoolsQuery.data;
  // GET /schools is platform-only: a tenant-local SUPER_ADMIN gets 403 (or an
  // empty list) and configures their own school like an ADMIN, with no picker.
  const isSuperAdmin =
    superAdminRole &&
    !(schoolsQuery.error instanceof ApiError && schoolsQuery.error.statusCode === 403) &&
    schools?.length !== 0;
  const [pickedSchoolId, setPickedSchoolId] = React.useState<string | undefined>(undefined);

  const schoolId = isSuperAdmin ? pickedSchoolId : (ownSchoolId ?? undefined);
  // An ADMIN's own school never appears in `schools` (that list is
  // SUPER_ADMIN-only), but its name is already in the access token
  // (`JwtMembership.name`, [8.9.5]). `useAccessToken()`, not
  // `getAccessToken()`: this must recompute after a token refresh carries a
  // renamed school's fresh membership name.
  const accessToken = useAccessToken();
  const ownSchoolName = React.useMemo(() => {
    if (!accessToken) return undefined;
    const membership = decodeAccessTokenMemberships(accessToken).find(
      (m) => m.tenantId === ownSchoolId,
    );
    if (!membership) return undefined;
    // A stale token from before `JwtMembership.name` existed can still be
    // valid for its remaining lifetime: fall back rather than show a blank.
    return membership.name ?? t('unnamedSchool');
  }, [accessToken, ownSchoolId, t]);
  const schoolName = isSuperAdmin
    ? schools?.find((school) => school.id === schoolId)?.name
    : ownSchoolName;

  const settingsQuery = useSchoolSettings(schoolId ?? '');
  // D32: "SMS is set up" is the server's word, not a rule rebuilt here. `null` while it loads or
  // if it fails, so the sections show no "not set up" warning for a school that has SMS.
  const providers = useMessagingProviders(schoolId ?? '').data;
  const smsConfigured = providers ? (providers.SMS?.configured ?? false) : null;
  const canEditAcrCriteria = useHasPermission(Permission.ACR_WRITE);
  const canApplyPreset = useHasPermission(Permission.CURRICULUM_PRESET_APPLY);
  const canManagePrinting = useHasPermission(Permission.PRINT_TEMPLATE_MANAGE);
  const canManageBackup = useHasPermission(Permission.BACKUP_MANAGE);

  const { section, buy, order, payment } = useSearch({ from: '/_staff/settings' });
  const hash = useLocation().hash;
  const categories = SETTINGS_CATEGORIES.filter(
    (c) =>
      (c.id !== 'printing' || canManagePrinting) &&
      (c.id !== 'backup' || canManageBackup) &&
      (c.id !== 'billing' || !isSuperAdmin),
  );
  const allowed = new Set<SettingsCategoryId>(categories.map((c) => c.id));
  const active = resolveSettingsCategory({ section, backup: backupJobId, hash }, allowed);

  // Scroll once per hash (a section may only mount once its data loads), never
  // again on a later category switch or refetch.
  const scrolledHash = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!hash) {
      scrolledHash.current = undefined;
      return;
    }
    if (scrolledHash.current === hash) return;
    const target = document.getElementById(hash);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      scrolledHash.current = hash;
    }
  }, [hash, active, settingsQuery.data]);

  /** Today's sections, unchanged inside, one `case` per category. */
  function renderCategory(id: SettingsCategoryId): React.ReactNode {
    // The profile, backup and ACR sections take no `schoolId` (always the
    // caller's own tenant), so they are not behind the SUPER_ADMIN picker.
    const loaded = schoolId && settingsQuery.data ? { schoolId, data: settingsQuery.data } : null;
    switch (id) {
      case 'school':
        return (
          <>
            <SchoolProfileSection />
            {loaded && (
              <>
                <OrganisationSection
                  schoolId={loaded.schoolId}
                  organisation={loaded.data.organisation}
                />
                <RegionalSection schoolId={loaded.schoolId} region={loaded.data.region} />
                <CalendarSection schoolId={loaded.schoolId} region={loaded.data.region} />
              </>
            )}
          </>
        );
      case 'academics':
        return (
          <>
            {loaded && (
              <>
                <AttendanceSection schoolId={loaded.schoolId} attendance={loaded.data.attendance} />
                <EvaluationsSection
                  key={loaded.schoolId}
                  schoolId={loaded.schoolId}
                  evaluations={loaded.data.evaluations}
                  smsConfigured={smsConfigured}
                />
                <DashboardSection
                  key={loaded.schoolId}
                  schoolId={loaded.schoolId}
                  dashboard={loaded.data.dashboard}
                />
                <StudyPlansSection
                  key={loaded.schoolId}
                  schoolId={loaded.schoolId}
                  studyPlans={loaded.data.studyPlans}
                  smsConfigured={smsConfigured}
                />
                <HomeworkSection
                  key={loaded.schoolId}
                  schoolId={loaded.schoolId}
                  homework={loaded.data.homework}
                  smsConfigured={smsConfigured}
                />
                <ApplicationsSection
                  key={loaded.schoolId}
                  schoolId={loaded.schoolId}
                  applications={loaded.data.applications}
                  smsConfigured={smsConfigured}
                />
              </>
            )}
            {canEditAcrCriteria && <AcrCriteriaSection />}
            {canApplyPreset && <PresetLinkCard />}
          </>
        );
      case 'finance':
        return (
          loaded && (
            <FeesSection key={loaded.schoolId} schoolId={loaded.schoolId} fees={loaded.data.fees} />
          )
        );
      case 'billing':
        // Billing is the active school's (X-Tenant-ID), so no SUPER_ADMIN picked-school view.
        return isSuperAdmin ? null : (
          <SeatsBillingSection openBuy={buy === 1} returnOrderId={order} payment={payment} />
        );
      case 'communication':
        return (
          loaded && (
            <>
              <SmsSection schoolId={loaded.schoolId} sms={loaded.data.communications?.sms} />
              <SmsCreditSection
                key={loaded.schoolId}
                schoolId={loaded.schoolId}
                isSuperAdmin={isSuperAdmin}
              />
              <WhatsAppSection
                schoolId={loaded.schoolId}
                whatsapp={loaded.data.communications?.whatsapp}
              />
              <MessengerSection
                schoolId={loaded.schoolId}
                messenger={loaded.data.communications?.messenger}
              />
              <EmailSection schoolId={loaded.schoolId} email={loaded.data.communications?.email} />
            </>
          )
        );
      case 'alerts':
        return (
          loaded &&
          loaded.data.attention && (
            <AlertsSection
              key={loaded.schoolId}
              schoolId={loaded.schoolId}
              attention={loaded.data.attention}
            />
          )
        );
      case 'printing':
        // [32.3.7] Takes no `schoolId`; carries `id="printers-section"` itself.
        return (
          loaded && (
            <>
              <PrintersSection />
              <DocumentsSection schoolId={loaded.schoolId} documents={loaded.data.documents} />
            </>
          )
        );
      case 'security':
        return (
          loaded && (
            <SignInSection
              key={loaded.schoolId}
              schoolId={loaded.schoolId}
              auth={loaded.data.auth}
            />
          )
        );
      case 'backup':
        return <BackupSection {...(backupJobId !== undefined ? { backupJobId } : {})} />;
    }
  }

  const subtitle = schoolId && schoolName ? t('configuringBanner', { schoolName }) : undefined;

  return (
    <PageContainer size="wide">
      {active && (
        <Link
          to="/settings"
          search={{}}
          className="inline-flex h-11 items-center gap-1 font-medium text-primary md:hidden"
        >
          <ChevronLeftIcon aria-hidden="true" />
          {t('title')}
        </Link>
      )}
      {/* PageHeader.title is a string; on phone the title is the category
          name (a drill-down level), so the header markup is inlined (the
          shared request for a node title was refused). */}
      <header className="min-w-0">
        <h1 className="text-h1">
          {active ? (
            <>
              <span className="md:hidden">{t(`categories.${active}`)}</span>
              <span className="hidden md:inline">{t('title')}</span>
            </>
          ) : (
            t('title')
          )}
        </h1>
        {subtitle && <p className="mt-0.5 truncate text-text-secondary">{subtitle}</p>}
      </header>

      {isSuperAdmin && (
        <div className="grid gap-1.5 md:w-80">
          <Label htmlFor="school-picker">{t('schoolPicker.label')}</Label>
          <Select
            value={pickedSchoolId ?? ''}
            onValueChange={(v) => setPickedSchoolId(v || undefined)}
          >
            <SelectTrigger id="school-picker">
              <SelectValue placeholder={t('schoolPicker.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {schools?.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {schoolsQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('schoolPicker.error')}
            </p>
          )}
        </div>
      )}

      {schoolId && settingsQuery.isError && (
        <ErrorState message={t('settingsLoadError')} onRetry={() => void settingsQuery.refetch()} />
      )}

      <SettingsLayout
        categories={categories.map((c) => ({
          id: c.id,
          icon: c.icon,
          label: t(`categories.${c.id}`),
        }))}
        active={active}
        fallback="school"
        renderPanel={(id) => (
          <>
            {/* A SUPER_ADMIN must pick a school before the school-bound cards appear. */}
            {isSuperAdmin && !schoolId && id !== 'backup' && (
              <p className="rounded-md bg-muted px-3 py-2 text-text-secondary">
                {t('schoolPicker.hint')}
              </p>
            )}
            {renderCategory(id)}
          </>
        )}
      />
    </PageContainer>
  );
}
