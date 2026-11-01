import type { MaskedMessagingBlock } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { ProviderConfigForm } from './ProviderConfigForm';

interface MessengerSectionProps {
  schoolId: string;
  messenger: MaskedMessagingBlock | undefined;
}

/** The MESSENGER card: a thin wrapper, the fields come from the server's company schema. */
export function MessengerSection({ schoolId, messenger }: MessengerSectionProps) {
  const { t } = useTranslation('settings');
  return (
    <ProviderConfigForm
      medium="MESSENGER"
      schoolId={schoolId}
      saved={messenger}
      sectionId="messenger-section"
      title={t('messenger.legend')}
      description={t('messenger.description')}
    />
  );
}
