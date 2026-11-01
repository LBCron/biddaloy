import { GreenwebProvider } from './sms/greenweb.provider';
import { MimsmsProvider } from './sms/mimsms.provider';
import { OnecodesoftProvider } from './sms/onecodesoft.provider';
import { MetaCloudProvider } from './whatsapp/meta-cloud.provider';
import { SmtpProvider } from './email/smtp.provider';
import { MetaPageProvider } from './messenger/meta-page.provider';

/** D7: every messaging provider, one line each. Order is display order. */
export const MESSAGING_PROVIDERS = [
  GreenwebProvider,
  MimsmsProvider,
  OnecodesoftProvider,
  MetaCloudProvider,
  SmtpProvider,
  MetaPageProvider,
] as const;
