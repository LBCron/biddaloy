import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Repository, IsNull, In } from 'typeorm';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ExamStatus,
  countSmsSegments,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { Student } from '../students/entities/student.entity';
import { School } from '../schools/entities/school.entity';
import { resolveReminderAudience } from '../communications/reminder-recipients.util';
import { resolveTemplateLocale } from '../account-access/account-access-templates';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../communications/credits/insufficient-sms-credit.constants';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

export interface ResultSmsOutcome {
  queued: number;
  skipped: Array<{ student_id: string; reason: string }>;
}

const PG_UNIQUE_VIOLATION = '23505';

function buildBody(
  locale: 'bn' | 'en',
  name: string,
  exam: string,
  r: { gpa: unknown; grade: unknown; is_fail: boolean },
): string {
  return locale === 'bn'
    ? `${name}-এর "${exam}" ফলাফল: জিপিএ ${r.gpa}, গ্রেড ${r.grade}${r.is_fail ? ' (অকৃতকার্য)' : ''}।`
    : `${name}'s result for "${exam}": GPA ${r.gpa}, Grade ${r.grade}${r.is_fail ? ' (FAIL)' : ''}.`;
}

/**
 * [19.5.1] Sends each guardian their child's published result by SMS,
 * reusing the communications module's own send path (`CommunicationLog`
 * + `COMMUNICATIONS_QUEUE`) and credit ledger (`SmsCreditService.reserve`,
 * same as `reminders.service.ts`'s bulk flow) — no second sender, no new
 * queue, no new worker.
 */
@Injectable()
export class ResultSmsService {
  private readonly logger = new Logger(ResultSmsService.name);

  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(Result)
    private readonly resultRepo: Repository<Result>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly smsCreditService: SmsCreditService,
    private readonly auditService: AuditService,
  ) {}

  async sendForExam(
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ResultSmsOutcome> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new BadRequestException('Exam not found');
    }
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException('This exam is not published — nothing to send yet.');
    }

    const results = await this.resultRepo.find({
      where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const students =
      results.length === 0
        ? []
        : await this.studentRepo.find({
            where: { id: In(results.map((r) => r.student_id)), tenant_id: tenantId },
            relations: ['guardians'],
          });
    const studentById = new Map(students.map((s) => [s.id, s]));

    const skipped: ResultSmsOutcome['skipped'] = [];
    let jobs: Array<{ log: CommunicationLog; segments: number }> = [];
    const school = await this.examRepo.manager.findOne(School, {
      where: { id: tenantId },
      select: { id: true, settings: true },
    });
    // No stored locale resolves to the bn-BD default (#3136).
    const locale = resolveTemplateLocale(school?.settings?.region?.locale);
    // Nullable on older rows; 0 still gives them one stable publication key.
    const publishedAt = exam.published_at?.getTime() ?? 0;

    for (const result of results) {
      const student = studentById.get(result.student_id);
      if (!student) {
        skipped.push({ student_id: result.student_id, reason: 'student_not_found' });
        continue;
      }
      // Reachable first, then the primary pick, so a primary with no phone
      // falls back to a secondary who has one.
      const guardians = resolveReminderAudience(
        (student.guardians ?? []).filter((g) => g.phone),
      ).guardians;
      if (guardians.length === 0) {
        skipped.push({ student_id: student.id, reason: 'no_reachable_guardian' });
        continue;
      }

      const body = buildBody(
        locale,
        locale === 'bn' ? (student.full_name_bn ?? student.full_name) : student.full_name,
        exam.name,
        result,
      );
      const segments = countSmsSegments(body).segments;
      for (const guardian of guardians) {
        // One log per guardian per student — the same "one message per
        // recipient" shape reminders.service.ts uses, not one per exam.
        jobs.push({
          log: this.logRepo.create({
            tenant_id: tenantId,
            medium: CommunicationMedium.SMS,
            recipient_address: guardian.phone as string,
            recipient_name: guardian.full_name,
            message_body: body,
            student_id: student.id,
            guardian_id: guardian.id,
            sent_by_user_id: userId,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.RESULT_SMS,
            reference_key: `exam-result:${examId}:${publishedAt}:${student.id}:${guardian.id}`,
          }),
          segments,
        });
      }
    }

    // Drop pairs already sent for this publication (one query).
    if (jobs.length > 0) {
      const existing = await this.logRepo.find({
        where: { tenant_id: tenantId, reference_key: In(jobs.map((j) => j.log.reference_key!)) },
        select: ['reference_key'],
      });
      const sent = new Set(existing.map((e) => e.reference_key));
      const dupStudents = new Set<string>();
      jobs = jobs.filter((j) => {
        if (!sent.has(j.log.reference_key)) return true;
        dupStudents.add(j.log.student_id!);
        return false;
      });
      for (const id of dupStudents) skipped.push({ student_id: id, reason: 'already_sent' });
    }

    if (jobs.length === 0) {
      return { queued: 0, skipped };
    }

    // Key convention (#1317): reserve `batch:<batchId>`, jobs carry the bare
    // batchId. Credit is per segment (one credit = one segment).
    const sendId = randomUUID();
    const batchId = `exam-result-sms:${examId}:${sendId}`;
    const totalSegments = jobs.reduce((sum, j) => sum + j.segments, 0);
    const metered = await this.smsCreditService.isMetered(tenantId);
    if (metered) {
      const reservation = await this.smsCreditService.reserve(
        tenantId,
        totalSegments,
        `batch:${batchId}`,
        { type: 'batch', id: sendId },
      );
      if (!reservation.ok) {
        throw new ConflictException({
          message: "Insufficient SMS credit to send this exam's result SMS.",
          details: {
            code: INSUFFICIENT_SMS_CREDIT,
            required: totalSegments,
            available: reservation.available,
          },
        });
      }
    }

    let queued = 0;
    for (const job of jobs) {
      let saved: CommunicationLog | undefined;
      try {
        saved = await this.logRepo.save(job.log);
        await this.queue.add('send', {
          logId: saved.id,
          ...(metered ? { batchId, segments: job.segments } : {}),
        });
        queued += 1;
      } catch (err) {
        // A concurrent double click lost the race on the unique reference_key.
        const duplicate = (err as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION;
        if (duplicate) {
          skipped.push({ student_id: job.log.student_id!, reason: 'already_sent' });
        }
        if (metered) {
          // No job will ever settle this share. Before the log exists there is no
          // `log:<id>` to key on, so use a fresh part key (same as CommunicationsService.enqueue).
          try {
            await this.smsCreditService.settlePart(
              tenantId,
              `batch:${batchId}`,
              saved ? `log:${saved.id}` : `enqueue-failed:${randomUUID()}`,
              job.segments,
              'RELEASE',
            );
          } catch (releaseErr) {
            this.logger.error({
              msg: 'sms credit release on enqueue failure failed — reservation left stranded',
              communication_log_id: saved?.id,
              tenant_id: tenantId,
              error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
            });
          }
        }
        if (saved) {
          try {
            saved.status = CommunicationStatus.FAILED;
            // Nothing was queued, so release the dedup key: a retry must be able to send this pair.
            saved.metadata = {
              ...saved.metadata,
              error: 'Failed to enqueue for delivery',
              released_reference_key: saved.reference_key,
            };
            saved.reference_key = null;
            await this.logRepo.save(saved);
          } catch (saveErr) {
            this.logger.error({
              msg: 'failed to mark result-sms log FAILED after enqueue failure',
              communication_log_id: saved.id,
              tenant_id: tenantId,
              error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            });
          }
        }
      }
    }

    await this.auditService.record({
      action: AuditAction.REMINDER_SENT,
      entity_type: 'Exam',
      entity_id: examId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { queued, skipped_count: skipped.length },
    });

    return { queued, skipped };
  }
}
