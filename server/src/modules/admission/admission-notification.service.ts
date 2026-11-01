import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import {
  AdmissionApplicantStatus,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
} from '@biddaloy/shared';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import {
  CREDIT_RESERVE_FAILED,
  INSUFFICIENT_SMS_CREDIT,
} from '../communications/credits/insufficient-sms-credit.constants';
import { School } from '../schools/entities/school.entity';
import { resolveTemplateLocale, TemplateLocale } from '../account-access/account-access-templates';
import { AdmissionApplicant } from './entities/admission-applicant.entity';

type AdmissionTemplate = (applicantName: string, intakeTitle: string) => string;

// [#2265] Typed values (name, intake title) are inserted as typed (D15).
const TEMPLATE_BY_STATUS: Record<
  TemplateLocale,
  Partial<Record<AdmissionApplicantStatus, AdmissionTemplate>>
> = {
  en: {
    [AdmissionApplicantStatus.SHORTLISTED]: (name, intake) =>
      `Good news! ${name}'s application for ${intake} has been shortlisted. We will contact you with next steps.`,
    [AdmissionApplicantStatus.ADMITTED]: (name, intake) =>
      `Congratulations! ${name} has been admitted for ${intake}. Please contact the school office to complete enrollment.`,
    [AdmissionApplicantStatus.REJECTED]: (name, intake) =>
      `Thank you for applying. ${name}'s application for ${intake} was not successful this time.`,
  },
  bn: {
    [AdmissionApplicantStatus.SHORTLISTED]: (name, intake) =>
      `সুখবর! ${intake}-এ ${name}-এর আবেদন প্রাথমিকভাবে নির্বাচিত হয়েছে। পরবর্তী ধাপ আমরা জানাব।`,
    [AdmissionApplicantStatus.ADMITTED]: (name, intake) =>
      `অভিনন্দন! ${name} ${intake}-এ ভর্তির জন্য নির্বাচিত হয়েছে। ভর্তি সম্পন্ন করতে স্কুল অফিসে যোগাযোগ করুন।`,
    [AdmissionApplicantStatus.REJECTED]: (name, intake) =>
      `আবেদন করার জন্য ধন্যবাদ। এবার ${intake}-এ ${name}-এর আবেদন সফল হয়নি।`,
  },
};

/**
 * [27.7] Thin producer for admission status-change notifications — reuses
 * the same `CommunicationLog` + `COMMUNICATIONS_QUEUE` mechanism every
 * other channel in the app goes through (see
 * `docs/architecture/05-communications.md` and
 * `AbsenceNoticeService.queueRecipients`, the closest existing precedent
 * for an automated, staff-action-triggered send).
 *
 * ponytail: applicants aren't linked to a real `Guardian` row before
 * ADMITTED, so there's no `preferred_communication`/opt-out to consult yet
 * — sends SMS only, to `guardian_phone` (always present). Widen to
 * guardian preference once applicants carry a `guardian_id`.
 */
@Injectable()
export class AdmissionNotificationService {
  private readonly logger = new Logger(AdmissionNotificationService.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  async notifyStatusChange(
    applicant: Pick<
      AdmissionApplicant,
      'id' | 'tenant_id' | 'applicant_name' | 'guardian_name' | 'guardian_phone' | 'status'
    >,
    intakeTitle: string,
  ): Promise<void> {
    // PENDING or any other status — nothing to notify about
    if (!TEMPLATE_BY_STATUS.en[applicant.status]) return;

    // No module change: read the school through the log repo's manager.
    const school = await this.logRepo.manager.findOne(School, {
      where: { id: applicant.tenant_id },
      select: { id: true, settings: true },
    });
    // No stored locale resolves to the bn-BD default (#3136).
    const locale = resolveTemplateLocale(school?.settings?.region?.locale);
    const template = TEMPLATE_BY_STATUS[locale][applicant.status]!;

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: applicant.tenant_id,
        medium: CommunicationMedium.SMS,
        recipient_address: applicant.guardian_phone,
        recipient_name: applicant.guardian_name,
        message_body: template(applicant.applicant_name, intakeTitle),
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        sent_by_user_id: null,
        metadata: { applicant_id: applicant.id, admission_status: applicant.status },
      }),
    );

    // [#2216] Metered SMS must hold credit before it is queued. A reserve
    // that throws fails the log rather than leaving it QUEUED with no job.
    const credit = await this.smsCreditService
      .reserveForLog(applicant.tenant_id, log)
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to reserve SMS credit for admission log ${log.id}: ${String(error)}`,
        );
        return CREDIT_RESERVE_FAILED;
      });
    if (typeof credit === 'string') {
      log.status = CommunicationStatus.FAILED;
      log.metadata = {
        ...log.metadata,
        reason: credit === 'INSUFFICIENT' ? INSUFFICIENT_SMS_CREDIT : credit,
      };
      await this.logRepo.save(log);
      return;
    }

    try {
      await this.queue.add('send', { logId: log.id, ...credit });
    } catch (error) {
      if (credit.segments !== undefined) {
        await this.smsCreditService.releaseForLog(applicant.tenant_id, log.id, credit.segments);
      }
      this.logger.warn(
        `Failed to enqueue admission status-change notification ${log.id} for applicant ${applicant.id}: ${String(error)}`,
      );
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
      await this.logRepo.save(log);
    }
  }
}
