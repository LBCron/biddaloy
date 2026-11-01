import type { MaskedMessagingBlock } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { ProviderConfigForm } from './ProviderConfigForm';

interface SmsSectionProps {
  schoolId: string;
  sms: MaskedMessagingBlock | undefined;
}

/** The SMS card: a thin wrapper, the fields come from the server's company schema. */
export function SmsSection({ schoolId, sms }: SmsSectionProps) {
  const { t } = useTranslation('settings');
  return (
    <ProviderConfigForm
      medium="SMS"
      schoolId={schoolId}
      saved={sms}
      sectionId="sms-section"
      title={t('sms.legend')}
      description={t('sms.description')}
    />
  );
}
