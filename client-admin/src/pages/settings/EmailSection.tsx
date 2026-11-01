import type { MaskedMessagingBlock } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { ProviderConfigForm } from './ProviderConfigForm';

interface EmailSectionProps {
  schoolId: string;
  email: MaskedMessagingBlock | undefined;
}

/** The EMAIL card: a thin wrapper, the fields come from the server's company schema. */
export function EmailSection({ schoolId, email }: EmailSectionProps) {
  const { t } = useTranslation('settings');
  return (
    <ProviderConfigForm
      medium="EMAIL"
      schoolId={schoolId}
      saved={email}
      sectionId="email-section"
      title={t('email.legend')}
      description={t('email.description')}
    />
  );
}
