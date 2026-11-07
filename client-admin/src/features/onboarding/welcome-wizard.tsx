/**
 * [13.6.1] The welcome wizard frame: setup -> people -> done, in the URL
 * (`?step=`, and `&path=guided|excel` inside setup). It owns the three-door
 * choice, "Do it later", and the status writes; the step bodies come in as
 * slots from the guided / Excel / people / summary tickets.
 */
import { StepIndicator } from '@biddaloy/ui/components';
import { onboardingStatusQueryOptions, useUpdateOnboarding } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { SetupDoors, type SetupDoor } from './setup-doors';
import { ONBOARDING_STEPS, useOnboardingStep } from './use-onboarding-step';

export interface WelcomeWizardProps {
  /** Setup step, `path=guided`. */
  guided: React.ReactNode;
  /** Setup step, `path=excel`. */
  excel: React.ReactNode;
  /** People step. */
  people: React.ReactNode;
  /** Done step. */
  summary: React.ReactNode;
}

export function WelcomeWizard({ guided, excel, people, summary }: WelcomeWizardProps) {
  const { t } = useTranslation('onboardingSetup');
  const navigate = useNavigate();
  const { step, path, setStep, setPath } = useOnboardingStep();
  const status = useQuery(onboardingStatusQueryOptions());
  const update = useUpdateOnboarding();
  const [door, setDoor] = React.useState<SetupDoor | null>(null);
  const [wantsWebsiteChoice, setWantsWebsite] = React.useState<boolean | null>(null);
  const [failed, setFailed] = React.useState(false);

  // Once per mount (the ref also guards StrictMode's double effect).
  const markedSeen = React.useRef(false);
  React.useEffect(() => {
    if (markedSeen.current) return;
    markedSeen.current = true;
    update.mutate({ seen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // A door chosen earlier (before a reload) is preselected; guided is the default.
  const chosen: SetupDoor = door ?? status.data?.setup_path ?? 'guided';
  // The status lists a `website` item only after a yes, so a reload keeps the answer.
  const wantsWebsite =
    wantsWebsiteChoice ?? status.data?.items.some((i) => i.id === 'website') ?? false;

  async function save(input: Parameters<typeof update.mutateAsync>[0]): Promise<boolean> {
    setFailed(false);
    try {
      await update.mutateAsync(input);
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }

  async function doLater() {
    if (await save({ dismissed: true })) void navigate({ to: '/' });
  }

  async function nextFromDoors() {
    // The website question lives under the guided door; any other door means no.
    if (!(await save({ setup_path: chosen, wants_website: chosen === 'guided' && wantsWebsite })))
      return;
    if (chosen === 'later') setStep('people');
    else setPath(chosen);
  }

  // The guided path carries its own Back / Next per question, so the frame
  // shows no footer there (two Next buttons would compete). Excel uses the frame's.
  const footer =
    step === 'setup' && !path
      ? { primary: { label: t('footer.next'), onClick: () => void nextFromDoors() } }
      : step === 'setup' && path === 'guided'
        ? null
        : step === 'setup'
          ? {
              primary: { label: t('footer.next'), onClick: () => setStep('people') },
              secondary: { label: t('footer.back'), onClick: () => setPath(null) },
            }
          : step === 'people'
            ? {
                primary: { label: t('footer.next'), onClick: () => setStep('done') },
                secondary: { label: t('footer.back'), onClick: () => setStep('setup') },
              }
            : {
                primary: { label: t('footer.finish'), onClick: () => void navigate({ to: '/' }) },
                secondary: { label: t('footer.back'), onClick: () => setStep('people') },
              };

  const steps = [
    { id: 'setup', label: t('steps.setup') },
    { id: 'people', label: t('steps.people') },
    { id: 'done', label: t('steps.done') },
  ];

  return (
    <FullPageShell
      title={t('title')}
      closeLabel={t('footer.later')}
      onClose={() => void doLater()}
      {...(footer
        ? {
            primary: {
              ...footer.primary,
              busy: update.isPending && !update.variables?.seen && step === 'setup' && !path,
            },
          }
        : {})}
      {...(footer?.secondary ? { secondary: footer.secondary } : {})}
    >
      <StepIndicator
        steps={steps}
        current={step}
        progressLabel={t('progress', {
          current: ONBOARDING_STEPS.indexOf(step) + 1,
          total: ONBOARDING_STEPS.length,
        })}
      />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('saveError')}
        </p>
      )}
      {step === 'setup' &&
        (path === 'guided' ? (
          guided
        ) : path === 'excel' ? (
          excel
        ) : (
          <SetupDoors
            value={chosen}
            onChange={setDoor}
            onEnter={() => void nextFromDoors()}
            wantsWebsite={wantsWebsite}
            onWantsWebsiteChange={setWantsWebsite}
            supportUrl={status.data?.support_url ?? null}
          />
        ))}
      {step === 'people' && people}
      {step === 'done' && summary}
    </FullPageShell>
  );
}
