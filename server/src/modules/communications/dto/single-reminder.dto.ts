import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsNotEmpty,
  ArrayNotEmpty,
  MaxLength,
} from 'class-validator';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';

export class SendSingleReminderDto {
  /**
   * Supports {{student_name}}, {{guardian_name}}, {{due_amount}}, {{due_month}}.
   * Not sanitized: staff-authored content, same reasoning as
   * SendBulkReminderDto.message_template — see reminders.dto.ts.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message_template: string;

  /**
   * Contact exactly these guardians. Omit to default to the primary
   * contact(s). `@ArrayNotEmpty` for the same reason as
   * SendBulkReminderDto.mediums: `[]` reads as "nobody" but would fall
   * through to the primary-contact default, so it must 400 instead.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];

  /**
   * Overrides every selected guardian's preferred_communication for this
   * send only — never written back to the guardian record. Matches the
   * issue's "override communication medium temporarily."
   */
  @IsOptional()
  @IsEnum(CommunicationMedium)
  medium?: CommunicationMedium;

  // WhatsApp template sends only — see MetaCloudProvider for the
  // 24-hour freeform-window constraint this exists to work around.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  whatsapp_template_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp_template_language?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whatsapp_template_params?: string[];
}

export class SkippedGuardianDto {
  guardian_id: string;
  guardian_name: string;
  reason: string;
}

/**
 * The Meta-approved template a WhatsApp recipient will actually be sent,
 * with the request's named parameters already resolved to the positional
 * values Meta receives ({{1}}, {{2}}, … in order).
 *
 * Exists because WhatsApp is the one channel where `message_body` is not
 * what leaves the building: Meta rejects freeform text outside its
 * 24-hour session window, so the send path dispatches this template
 * instead. Without it the mandatory review step would show the sender
 * text no WhatsApp guardian will ever receive.
 */
export class WhatsAppTemplatePreviewDto {
  name: string;
  language: string;
  params: string[];
}

export class ReminderPreviewRecipientDto {
  guardian_id: string;
  guardian_name: string;
  medium: CommunicationMedium;
  address: string;
  /**
   * The rendered text. Delivered as-is on SMS and email. On WhatsApp it is
   * delivered only when `whatsapp_template` is null — and such a send is
   * freeform outside Meta's session window, so it will be rejected.
   */
  message_body: string;
  subject: string | null;
  /** Non-null only for a WhatsApp recipient sent as an approved template. */
  whatsapp_template: WhatsAppTemplatePreviewDto | null;
}

export class ReminderPreviewResponseDto {
  student_id: string;
  recipients: ReminderPreviewRecipientDto[];
  skipped: SkippedGuardianDto[];
}

export class SentReminderRecipientDto {
  communication_log_id: string;
  guardian_id: string;
  guardian_name: string;
  medium: CommunicationMedium;
  status: CommunicationStatus;
}

export class SingleReminderResponseDto {
  student_id: string;
  sent: SentReminderRecipientDto[];
  skipped: SkippedGuardianDto[];
}
