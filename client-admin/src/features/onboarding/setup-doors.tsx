/**
 * [13.6.1] The setup step's three doors, plus the "talk to us" link.
 * Controlled: the wizard owns the choice because "Next" lives in its footer.
 */
import { RadioGroup, RadioGroupItem } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { isSafeSupportUrl } from '@biddaloy/ui/utils';
import { useId } from 'react';

import { ChoiceCardGroup, type ChoiceOption } from './choice-card-group';

export type SetupDoor = 'guided' | 'excel' | 'later';

export interface SetupDoorsProps {
  value: SetupDoor;
  onChange: (door: SetupDoor) => void;
  onEnter: () => void;
  /** [40.2.05] "Do you want a school website?", asked only under the guided door. */
  wantsWebsite: boolean;
  onWantsWebsiteChange: (wants: boolean) => void;
  /** From the onboarding status; the link is hidden when null or not https:/mailto:. */
  supportUrl: string | null;
}

export function SetupDoors({
  value,
  onChange,
  onEnter,
  wantsWebsite,
  onWantsWebsiteChange,
  supportUrl,
}: SetupDoorsProps) {
  const { t } = useTranslation('onboardingSetup');
  const questionId = useId();
  const options: ChoiceOption<SetupDoor>[] = [
    {
      value: 'guided',
      title: t('doors.guided.title'),
      body: t('doors.guided.body'),
      badge: t('doors.guided.badge'),
    },
    { value: 'excel', title: t('doors.excel.title'), body: t('doors.excel.body') },
    { value: 'later', title: t('doors.later.title'), body: t('doors.later.body') },
  ];
  return (
    <section className="space-y-4">
      <h2 className="text-h2">{t('doors.heading')}</h2>
      <ChoiceCardGroup
        label={t('doors.heading')}
        options={options}
        value={value}
        onChange={onChange}
        onEnter={onEnter}
      />
      {value === 'guided' && (
        <div className="space-y-2">
          <p id={questionId} className="font-medium">
            {t('doors.guided.websiteQuestion')}
          </p>
          <RadioGroup
            aria-labelledby={questionId}
            value={wantsWebsite ? 'yes' : 'no'}
            onValueChange={(v) => onWantsWebsiteChange(v === 'yes')}
            className="flex flex-wrap gap-4"
          >
            {(['yes', 'no'] as const).map((answer) => (
              <label key={answer} className="flex min-h-11 items-center gap-2">
                <RadioGroupItem value={answer} />
                {t(answer === 'yes' ? 'doors.guided.websiteYes' : 'doors.guided.websiteNo')}
              </label>
            ))}
          </RadioGroup>
        </div>
      )}
      {isSafeSupportUrl(supportUrl) && (
        <p className="text-sm">
          <a
            href={supportUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center text-primary underline-offset-2 hover:underline"
          >
            {t('support')}
          </a>
        </p>
      )}
    </section>
  );
}
