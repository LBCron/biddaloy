import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  ArrayNotEmpty,
  ArrayMaxSize,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@biddaloy/shared';
import { ReminderPreviewRecipientDto } from './single-reminder.dto';
import { CommunicationLogMedium, PUSH_MEDIUM } from '../entities/communication-log.entity';
import { DELIVERY_ERROR_CODES, DeliveryErrorCode } from '../delivery-error-code';

/**
 * Upper bound on one batch. The endpoint resolves recipients and enqueues
 * jobs inside the request, so an unbounded list would turn a single call
 * into a long-running write of tens of thousands of rows. Callers with
 * more students than this send several batches.
 */
export const MAX_BULK_REMINDER_STUDENTS = 500;

export class SendBulkReminderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_REMINDER_STUDENTS)
  @IsUUID('4', { each: true })
  student_ids: string[];

  /**
   * Supports {{student_name}}, {{guardian_name}}, {{due_amount}}, {{due_month}}.
   * Not sanitized: staff-authored content (see @Roles on the controller), a
   * higher trust boundary than the identity data it interpolates. The
   * interpolated values are already clean because their sources — Student /
   * Guardian full_name — are sanitized at creation; see
   * reminder-template.util.ts and server/README.md's sanitization note.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message_template: string;

  /**
   * Channels this batch is allowed to use. Omit to accept whatever each
   * guardian prefers; supply a list to restrict the batch to guardians who
   * prefer one of those channels.
   *
   * `@ArrayNotEmpty` because `[]` and "omitted" mean opposite things to a
   * caller — "no channel at all" vs "any channel" — but resolveRecipients
   * collapses both to "any channel". A UI that deselects every channel
   * must get a 400, not a send to everybody.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(CommunicationMedium, { each: true })
  mediums?: CommunicationMedium[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  batch_name?: string;

  /**
   * WhatsApp rejects freeform text outside its 24-hour session window, which
   * a proactive fee reminder is always outside of. Supply a pre-approved
   * template name to make WhatsApp recipients deliverable; without it they
   * are queued as freeform and will be rejected by Meta.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  whatsapp_template_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp_template_language?: string;

  /**
   * Placeholder names whose rendered values fill the WhatsApp template's
   * positional parameters, in order — e.g. ["guardian_name","due_amount"]
   * maps to the template's {{1}} and {{2}}. Named rather than positional
   * here so the mapping to an approved template is explicit.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  whatsapp_template_params?: string[];
}

export class SkippedRecipientDto {
  student_id: string;
  guardian_id: string | null;
  reason: string;
}

export class ReminderBatchResponseDto {
  id: string;
  batch_name: string;
  status: ReminderBatchStatus;
  total_recipients: number;
  successful_count: number;
  failed_count: number;
  message_template: string | null;
  created_at: Date;
  /**
   * The batch's original targeting, replayed from filters_applied so the
   * detail page can retry failures on the same channels with the same
   * approved template. Null mediums means the send used each guardian's
   * preferred channel.
   */
  mediums: CommunicationMedium[] | null;
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
  whatsapp_template_params: string[] | null;
  /** Recipients deliberately not queued, with the reason for each. */
  skipped: SkippedRecipientDto[];
}

export class QueryReminderBatchesDto {
  /** Matches against batch_name (ILIKE, escaped). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(ReminderBatchStatus)
  status?: ReminderBatchStatus;

  @IsOptional()
  @IsDateString()
  from_date?: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;

  @IsOptional()
  @IsEnum(['created_at', 'batch_name', 'total_recipients'])
  sort?: 'created_at' | 'batch_name' | 'total_recipients';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** Shared page envelope for the reminder history/logs lists. */
export class ReminderPaginatedResponseDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * One row of the Reminder History list. Deliberately excludes `skipped`
 * (potentially hundreds of entries per batch, persisted in
 * filters_applied) — the detail endpoint returns it for one batch at a
 * time instead of every batch on the page carrying its full skip list.
 */
export class ReminderBatchListItemDto {
  id: string;
  batch_name: string;
  status: ReminderBatchStatus;
  total_recipients: number;
  successful_count: number;
  failed_count: number;
  created_at: Date;
}

export class ReminderBatchListResponseDto extends ReminderPaginatedResponseDto {
  data: ReminderBatchListItemDto[];
}

/**
 * A guardian (or a whole student, when guardian_id is null — e.g.
 * no_open_dues / no_guardians) the bulk send would leave out, named so the
 * sender can act on it before anything is sent. Unlike the persisted
 * SkippedRecipientDto this carries guardian_name: preview is exactly the
 * "review before send" step, and a bare UUID is not reviewable.
 */
export class BulkPreviewSkippedDto {
  guardian_id: string | null;
  guardian_name: string | null;
  reason: string;
}

export class BulkPreviewStudentDto {
  student_id: string;
  student_name: string;
  /** Same shape as the single-student preview's recipients. */
  recipients: ReminderPreviewRecipientDto[];
  skipped: BulkPreviewSkippedDto[];
}

/**
 * [15.6.4/#547] The SMS units the send would reserve — a rendered-per-
 * recipient sum, see sms-projection.util.ts. `available`/`reserved`/
 * `shortfall` are only meaningful in `PLATFORM` metering, so `OFF` omits
 * them rather than shipping zeros that would read as "you have nothing."
 */
export class BulkSmsProjectionDto {
  sms_recipients: number;
  sms_units: number;
  metering: 'OFF' | 'PLATFORM';
  available?: number;
  reserved?: number;
  shortfall?: number;
}

export class BulkReminderPreviewResponseDto {
  total_students: number;
  recipients_count: number;
  skipped_count: number;
  students: BulkPreviewStudentDto[];
  projection: BulkSmsProjectionDto;
}

/** Same paging rules as the batch list; logs pages just default larger. */
export class QueryReminderBatchLogsDto extends QueryReminderBatchesDto {
  limit?: number = 50;
}

/**
 * One message-log row: the batch detail page's per-recipient table, the tenant-wide message log
 * and the check-status answer. `student_id` is what a retry composes its fresh
 * `POST /reminder/bulk` from; `error` is a fixed code for the worker's failure reason
 * (CommunicationLog.metadata.error) so "FAILED" is never unexplained.
 */
export class ReminderBatchLogDto {
  id: string;
  // A plain `CommunicationLogMedium` union isn't reliably introspected by
  // the `@nestjs/swagger` CLI plugin — see
  // `CommunicationResponseDto.medium`'s own comment (communications.dto.ts).
  @ApiProperty({ enum: [...Object.values(CommunicationMedium), PUSH_MEDIUM] })
  medium: CommunicationLogMedium;
  recipient_address: string;
  recipient_name: string;
  status: CommunicationStatus;
  trigger: CommunicationTrigger;
  student_id: string | null;
  guardian_id: string | null;
  provider_message_id: string | null;
  /** [97.4.01] The company that sent it (`metadata.provider`), null before Epic 97 or in sink mode. */
  provider: string | null;
  // A fixed code, never the raw failure text (Rule 23, see delivery-error-code.ts).
  @ApiProperty({ enum: DELIVERY_ERROR_CODES, nullable: true })
  error: DeliveryErrorCode | null;
  created_at: Date;
  /**
   * [97.4.02] D22 row detail, shaped at read time for the caller (`visibleLogBody`,
   * reminders.service.ts): invoice share links show as `/i/••••••`, sign-in codes and links were
   * redacted at write, and an exam result is null without RESULT_READ. Never what was sent.
   */
  message_body: string | null;
  /** True when `message_body` is held back from this caller (an exam result without RESULT_READ). */
  body_withheld: boolean;
  subject: string | null;
  /** SMS parts: what the send counted (`metadata.segments`), else counted from the stored text.
   * Null for other channels, and for a sign-in SMS with no recorded count (its stored text is redacted). */
  segments: number | null;
  /** The reminder round this message belongs to, for the round's page link. */
  batch_id: string | null;
  /** A test message from Settings (`metadata.test`). */
  is_test: boolean;
  sent_by_user_id: string | null;
  /** The staff member's name; null for an automatic send or a removed user. */
  sent_by_name: string | null;
  /**
   * D23: whether Check status can ask about this row (SENT, a company message id, a company that
   * declares `status`, not the test inbox). False-safe: the check-status route stays the authority.
   */
  can_check_status: boolean;
}

export class ReminderBatchLogListResponseDto extends ReminderPaginatedResponseDto {
  data: ReminderBatchLogDto[];
}

export class MessageLogCompanyLabelDto {
  en: string;
  bn: string;
}

export class MessageLogCompanyDto {
  name: string;
  @ApiProperty({ enum: CommunicationMedium })
  medium: CommunicationMedium;
  label: MessageLogCompanyLabelDto;
}

export class MessageLogSenderDto {
  id: string;
  full_name: string;
}

/** [97.4.02] `GET /communications/logs/filter-options`: the Company and Sent-by choices. */
export class MessageLogFilterOptionsDto {
  /** Every company the app can send through (static, no settings or secrets). */
  companies: MessageLogCompanyDto[];
  /** Staff who sent at least one message from this school, by name, at most 100. */
  senders: MessageLogSenderDto[];
}

/**
 * [87.SD] `GET /communications/logs` — the tenant-wide message log the
 * dashboard's Failed messages / SMS balance widgets open. Same row shape as
 * a batch's logs (`ReminderBatchLogDto`), filtered by outcome and channel.
 */
export class QueryCommunicationLogsDto {
  /** [97.4.01] D22/D33: recipient name, phone (any `+880` / `01` / spaced form) or email. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(CommunicationTrigger)
  trigger?: CommunicationTrigger;

  /** [#3343] One student's messages (the student page's Messages link). */
  @IsOptional()
  @IsUUID()
  student_id?: string;

  /** [#3343] One guardian's messages (the guardian page's Messages link). */
  @IsOptional()
  @IsUUID()
  guardian_id?: string;

  /** The staff user who sent it (`sent_by_user_id`). */
  @IsOptional()
  @IsUUID()
  sent_by?: string;

  /** The company that sent it (`metadata.provider`, a descriptor name). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @IsOptional()
  @IsEnum(CommunicationStatus)
  status?: CommunicationStatus;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  medium?: CommunicationMedium;

  @IsOptional()
  @IsRealDate()
  from_date?: string;

  @IsOptional()
  @IsRealDate()
  to_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
