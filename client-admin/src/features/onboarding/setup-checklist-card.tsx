/** [13.5.1] Dashboard "Finish setting up your school" card. ADMIN only; hidden once dismissed or all done. */
import { UserRole, type OnboardingItemId, type OnboardingStatus } from '@biddaloy/shared';
import { Button, Card, HelpHint, ProgressBar } from '@biddaloy/ui/components';
import {
  onboardingStatusQueryOptions,
  useActiveRole,
  useUpdateOnboarding,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, CircleCheckIcon, CircleIcon, ClockIcon } from 'lucide-react';
import { useId } from 'react';

const TARGETS: Record<OnboardingItemId, { to: string; search?: Record<string, string | number> }> =
  {
    profile: { to: '/settings', search: { section: 'school' } },
    structure: { to: '/classes' },
    sections: { to: '/classes' },
    students: { to: '/students' },
    staff: { to: '/staff' },
    feeStructures: { to: '/fee-structures' },
    guardianInvites: { to: '/guardians', search: { invite: 1 } },
    messageSettings: { to: '/settings', search: { section: 'communication' } },
  };

/** Shows until dismissed or every item is done. Existing schools are dismissed by migration
 * `1791400000100-DismissChecklistForExistingSchools`, so they never see it. */
function showChecklist(status: OnboardingStatus | undefined): status is OnboardingStatus {
  return !!status && !status.dismissed_at && status.items.some((i) => !i.done);
}

export function SetupChecklistCard() {
  const { t } = useTranslation('setupChecklist');
  useTranslation('signal'); // [#3592] separate binding: check-i18n-keys reads the first single-quoted call
  const role = useActiveRole();
  const update = useUpdateOnboarding();
  const headingId = useId(); // the grid renders desktop + phone copies; ids must not collide
  const { data } = useQuery({
    ...onboardingStatusQueryOptions(),
    enabled: role === UserRole.ADMIN,
  });
  if (role !== UserRole.ADMIN || !showChecklist(data)) return null;
  const done = data.items.filter((i) => i.done).length;
  return (
    <Card padded asChild className="border-s-[3px] border-s-signal-warn-fg">
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <h2 id={headingId} className="text-h3">
                {t('title')}
              </h2>
              {/* [#3599] Setup is unfinished = "watch": icon + sr-only text, colour never alone (D8).
                  After the heading so it is read title-first; `order-first` keeps the icon on the left. */}
              <span data-signal="warn" className="order-first inline-flex shrink-0 items-center">
                <ClockIcon aria-hidden="true" className="size-4 text-signal-warn-fg" />
                <span className="sr-only">{t('watch', { ns: 'signal' })}</span>
              </span>
              <HelpHint helpId="admin.setupOrder.action.continueSetup" />
            </div>
            <p className="text-text-secondary">
              {t('progress', { done, total: data.items.length })}
            </p>
          </div>
          <Button
            variant="ghost"
            className="min-h-11 md:min-h-8"
            disabled={update.isPending}
            onClick={() => update.mutate({ dismissed: true })}
          >
            {t('hide')}
          </Button>
        </div>
        <ProgressBar done={done} total={data.items.length} label={t('title')} />
        <ul className="divide-y divide-border-subtle">
          {data.items.map((item) => {
            const target = TARGETS[item.id];
            const Icon = item.done ? CircleCheckIcon : CircleIcon;
            return (
              <li key={item.id}>
                <Link
                  {...(target as { to: never })}
                  className="flex min-h-11 items-center gap-3 px-1 hover:bg-muted md:min-h-10"
                >
                  <Icon
                    aria-hidden="true"
                    className={`size-5 shrink-0 ${item.done ? 'text-status-paid-fg' : ''}`}
                  />
                  <span
                    className={`flex-1 ${item.done ? 'text-text-secondary' : 'text-text-primary'}`}
                  >
                    {t(`items.${item.id}`)}
                  </span>
                  <span className="text-caption text-text-secondary">
                    {item.done ? t('done') : t('todo')}
                  </span>
                  <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
