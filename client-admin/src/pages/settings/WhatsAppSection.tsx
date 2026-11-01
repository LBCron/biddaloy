import type { MaskedMessagingBlock } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { ProviderConfigForm } from './ProviderConfigForm';

interface WhatsAppSectionProps {
  schoolId: string;
  whatsapp: MaskedMessagingBlock | undefined;
}

/** The WHATSAPP card: a thin wrapper, the fields come from the server's company schema. */
export function WhatsAppSection({ schoolId, whatsapp }: WhatsAppSectionProps) {
  const { t } = useTranslation('settings');
  return (
    <ProviderConfigForm
      medium="WHATSAPP"
      schoolId={schoolId}
      saved={whatsapp}
      sectionId="whatsapp-section"
      title={t('whatsapp.legend')}
      description={t('whatsapp.description')}
    />
  );
}
