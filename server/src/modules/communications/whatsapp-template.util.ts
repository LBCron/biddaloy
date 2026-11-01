import { CommunicationMedium } from '@biddaloy/shared';
import { ReminderTemplateVars, templateVarValue } from './reminder-template.util';

/**
 * Meta rejects freeform WhatsApp text outside its 24-hour session window,
 * which a proactive fee reminder is always outside of. So a WhatsApp
 * reminder is dispatched as a **pre-approved template**, not as the
 * rendered message body — see MetaCloudProvider.
 *
 * This is the single place that decides "does this recipient get a
 * template, and with what positional parameters." Both the send path
 * (which stores the answer on CommunicationLog.metadata for the worker)
 * and the preview path (which must show the sender what will really be
 * delivered) call it, so the mandatory review step can never disagree
 * with what the send then does.
 */

/**
 * Meta requires a language code on every template send. The request may
 * omit it, in which case this is what the provider actually uses — so
 * this is also what a preview must display, rather than "unset."
 */
export const DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE = 'en';

/** The approved template one recipient will actually receive. */
export interface WhatsAppTemplateDispatch {
  name: string;
  language: string;
  /** Rendered values filling the template's {{1}}, {{2}}, … in order. */
  params: string[];
}

/** The template fields shared by the bulk and single reminder request DTOs. */
export interface WhatsAppTemplateRequest {
  whatsapp_template_name?: string;
  whatsapp_template_language?: string;
  whatsapp_template_params?: string[];
}

/**
 * Null when this recipient is not a WhatsApp template send — either the
 * channel is something else, or no approved template name was supplied
 * (in which case the send is queued as freeform text and Meta will
 * reject it; the rendered message body is then an honest preview of the
 * attempt).
 *
 * Params are named in the request and positional at Meta's end, so they
 * are resolved here in the order given. A name the renderer cannot fill
 * becomes an empty string — callers validate names up front
 * (validateWhatsAppParams) so that should be unreachable.
 */
export function resolveWhatsAppTemplate(
  medium: CommunicationMedium,
  vars: ReminderTemplateVars,
  request: WhatsAppTemplateRequest,
): WhatsAppTemplateDispatch | null {
  if (medium !== CommunicationMedium.WHATSAPP || !request.whatsapp_template_name) {
    return null;
  }

  return {
    name: request.whatsapp_template_name,
    language: request.whatsapp_template_language ?? DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE,
    params: (request.whatsapp_template_params ?? []).map(
      (name) => templateVarValue(vars, name) ?? '',
    ),
  };
}

/** The snake_cased shape CommunicationLog.metadata carries to the worker. */
export function whatsAppTemplateMetadata(
  template: WhatsAppTemplateDispatch | null,
): Record<string, unknown> | null {
  if (!template) return null;
  return {
    template_name: template.name,
    template_language: template.language,
    template_params: template.params,
  };
}
