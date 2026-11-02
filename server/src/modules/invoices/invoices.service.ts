import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, EntityManager, In } from 'typeorm';
import { Invoice, InvoiceSnapshot, InvoiceSnapshotStudent } from './entities/invoice.entity';
import { Student } from '../students/entities/student.entity';
import { Payment } from '../fees/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { InvoiceStatus, InvoiceKind, PaymentStatus, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { QueryInvoiceDto } from './dto/invoices.dto';
import { generateInvoiceNumber, generateCreditNoteNumber } from './invoice-numbering.util';
import { MONTH_NAMES, periodStartFromLabel } from './invoice-period.util';
import { renderInvoiceHtml } from './invoice-print.template';
import { renderInvoicePosHtml, PosPrintWidth } from './invoice-print-pos.template';
import { StorageService } from '../storage/storage.service';
import { readLogoDataUrl } from '../schools/profile/logo-data-url';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import {
  buildIssuerSnapshot,
  lockSchoolForSnapshot,
  resolveIssuer,
  IssuerSnapshot,
} from '../schools/profile/issuer-snapshot';
import { exportDate, pagedRows } from '../reports/export/paged-rows';

/** Older invoices were snapshotted before `period_start` existed. Fill it in
 * on a copy for the response — the stored snapshot is immutable and never
 * written back. */
function withPeriodStart(invoice: Invoice): Invoice {
  if (!Array.isArray(invoice.snapshot?.students)) return invoice;
  return {
    ...invoice,
    snapshot: {
      ...invoice.snapshot,
      students: invoice.snapshot.students.map((student) => ({
        ...student,
        lines: (student.lines ?? []).map((line) => ({
          ...line,
          period_start: line.period_start ?? periodStartFromLabel(line.period_label),
        })),
      })),
    },
  };
}

/** [16.5.2] `GET /invoices/:id/print?format=` values — `a4` is the
 * default when the query param is absent. */
export type InvoicePrintFormat = 'a4' | PosPrintWidth;

/** [MON-05] A reversal, a reversed original or a non-SUCCESS payment must
 * never get a "paid" invoice; reversals get credit notes instead. */
function assertInvoiceable(payment: Payment): void {
  if (
    payment.payment_status !== PaymentStatus.SUCCESS ||
    payment.reversal_of_payment_id ||
    payment.reversed_by_payment_id
  ) {
    throw new ConflictException({
      code: 'INVOICE_PAYMENT_NOT_INVOICEABLE',
      details: { code: 'INVOICE_PAYMENT_NOT_INVOICEABLE' },
      message: 'Only a live, successful payment can get an invoice. A reversal gets a credit note.',
    });
  }
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly repo: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /** [16.5.1] Groups `payment.allocations` by the (possibly different, for
   * a multi-student/sibling checkout) student each fee belongs to, and
   * freezes everything an invoice needs to render into an
   * `InvoiceSnapshot`. Call once, inside the same transaction the payment
   * (and its allocations' `StudentFee.paid_amount` updates) was
   * committed in — `balance_after` reads `StudentFee.paid_amount` as it
   * stands at that moment. */
  private async buildSnapshot(
    manager: EntityManager,
    payment: Payment,
    issuerSnapshot: IssuerSnapshot,
  ): Promise<InvoiceSnapshot> {
    const allocations = payment.allocations ?? [];
    const studentIds = [...new Set(allocations.map((a) => a.student_fee.student_id))];
    // [664 fix] Defense-in-depth: scope to `payment.tenant_id` even though
    // every current caller already passes tenant-scoped allocations. A
    // future caller that forgets to pre-scope its allocations to one
    // tenant would otherwise let a cross-tenant student id slip into the
    // invoice snapshot.
    const students = await manager.getRepository(Student).find({
      where: {
        id: In(studentIds.length ? studentIds : [payment.student_id]),
        tenant_id: payment.tenant_id,
      },
      relations: ['class_section', 'class_section.class'],
    });
    const studentById = new Map(students.map((s) => [s.id, s]));

    const byStudent = new Map<string, InvoiceSnapshotStudent>();
    for (const allocation of allocations) {
      const fee = allocation.student_fee;
      const student = studentById.get(fee.student_id);
      if (!student) {
        throw new NotFoundException({
          message: 'Student not found',
          details: { code: 'STUDENT_NOT_FOUND' },
        });
      }
      let entry = byStudent.get(student.id);
      if (!entry) {
        entry = {
          id: student.id,
          full_name: student.full_name,
          registration_number: student.registration_number,
          class_name: student.class_section?.class?.name ?? null,
          lines: [],
        };
        byStudent.set(student.id, entry);
      }
      entry.lines.push({
        fee_name: fee.fee_structure?.name ?? 'Fee',
        period_label: `${MONTH_NAMES[fee.month - 1]} ${fee.year}`,
        period_start: `${fee.year}-${String(fee.month).padStart(2, '0')}`,
        amount: Number(fee.total_amount),
        discount: Number(fee.discount_amount),
        paid_this_time: Number(allocation.allocated_amount),
        balance_after:
          Number(fee.total_amount) - Number(fee.discount_amount) - Number(fee.paid_amount),
      });
    }

    const lineTotals = [...byStudent.values()].flatMap((s) => s.lines);
    return {
      issuer: issuerSnapshot,
      students: [...byStudent.values()],
      totals: {
        billed: lineTotals.reduce((sum, l) => sum + l.amount, 0),
        discount: lineTotals.reduce((sum, l) => sum + l.discount, 0),
        paid: Number(payment.total_amount),
        change: Number(payment.change_amount),
        wallet_used: Number(payment.wallet_credit_used),
        wallet_added: Number(payment.wallet_credit_added),
      },
      payment: {
        method: payment.payment_method,
        reference: payment.transaction_reference,
        received_by_name: payment.received_by?.full_name ?? null,
        payment_date: payment.payment_date.toISOString(),
      },
    };
  }

  /** [16.5.1] Issues the one, immutable invoice for `paymentId` — built
   * from the payment's already-committed allocations (`StudentFee` lines,
   * possibly across several students in one checkout) plus the issuer's
   * identity, locked and frozen inside the *caller's* transaction via
   * `manager`. Status is `ISSUED` immediately; there is no DRAFT checkout
   * invoice. Callers own their own transaction/lock strategy — this
   * method never opens one of its own. */
  async create(paymentId: string, manager: EntityManager): Promise<Invoice> {
    // Lock the payment row so this serializes with a reversal's FOR UPDATE:
    // we either see the reversal committed (and 409) or it waits for us.
    // Write lock (not share): the caller later UPDATEs payments.invoice_id,
    // and two share-holders upgrading would deadlock.
    await manager
      .getRepository(Payment)
      .createQueryBuilder('p')
      .select('p.id')
      .where('p.id = :paymentId', { paymentId })
      .setLock('pessimistic_write')
      .getOne();
    const payment = await manager.getRepository(Payment).findOne({
      where: { id: paymentId },
      relations: [
        'allocations',
        'allocations.student_fee',
        'allocations.student_fee.fee_structure',
        'received_by',
      ],
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    assertInvoiceable(payment);
    if (!payment.allocations || payment.allocations.length === 0) {
      throw new BadRequestException('This payment has no allocations to build an invoice from');
    }

    // [15.5.5] Frozen at the moment of issue — same reasoning as
    // `CheckoutService.checkout`'s own lock: a concurrent
    // `SchoolProfileService.updateProfile` takes `FOR UPDATE` on the same
    // row, so the two serialize instead of racing.
    const school = await lockSchoolForSnapshot(manager, payment.tenant_id);
    const issuerSnapshot = buildIssuerSnapshot(school);
    const snapshot = await this.buildSnapshot(manager, payment, issuerSnapshot);

    const invoiceRepo = manager.getRepository(Invoice);
    const invoiceNumber = await generateInvoiceNumber(manager, payment.tenant_id);

    const invoice = await invoiceRepo.save(
      invoiceRepo.create({
        invoice_number: invoiceNumber,
        tenant_id: payment.tenant_id,
        kind: InvoiceKind.INVOICE,
        student_id: payment.student_id,
        payment_id: payment.id,
        related_invoice_id: null,
        total_amount: snapshot.totals.paid,
        tax_amount: 0,
        discount_amount: snapshot.totals.discount,
        status: InvoiceStatus.ISSUED,
        issued_date: payment.payment_date,
        due_date: payment.payment_date,
        snapshot,
        issued_by_user_id: payment.received_by_user_id,
        notes: null,
        issuer_snapshot: issuerSnapshot,
      }),
    );
    // Same transaction as the insert (`manager`): no invoice without its row.
    await this.auditService.record(
      {
        action: AuditAction.INVOICE_GENERATED,
        entity_type: 'Invoice',
        entity_id: invoice.id,
        tenant_id: payment.tenant_id,
        performed_by_user_id: payment.received_by_user_id,
        new_values: {
          invoice_id: invoice.id,
          invoice_number: invoiceNumber,
          payment_id: payment.id,
          total_amount: snapshot.totals.paid,
        },
      },
      manager,
    );
    return invoice;
  }

  /** [16.5.1] Staff-triggered manual entry point (`POST /invoices`) —
   * opens its own transaction around `create()` and returns the fully
   * resolved invoice, tenant-checked. */
  async createFromPayment(
    paymentId: string,
    tenantId: string,
  ): Promise<Invoice & { issuer: IssuerSnapshot }> {
    // Tenant check happens here, *before* `create()` runs — `create()`
    // itself trusts `paymentId` (its other two callers, checkout and
    // payment-allocation, already resolved the payment within the caller's
    // own tenant), so a manual cross-tenant id must be rejected up front
    // rather than after an invoice has already been minted.
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId, tenant_id: tenantId },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    // Before the idempotent "already invoiced" return: a payment invoiced
    // and later reversed must 409, not hand back its stale invoice.
    assertInvoiceable(payment);
    let invoiceId: string;
    try {
      invoiceId = await this.repo.manager.transaction(async (manager) => {
        const invoiceRepo = manager.getRepository(Invoice);
        // Check-then-create inside the transaction: a payment that already
        // has a live INVOICE-kind document is returned idempotently rather
        // than minting a second one.
        const existing = await invoiceRepo.findOne({
          where: { payment_id: paymentId, kind: InvoiceKind.INVOICE, deleted_at: IsNull() },
        });
        if (existing) return existing.id;

        const invoice = await this.create(paymentId, manager);
        // [B6] Written back inside the same transaction as the invoice
        // insert, not as a follow-up write after commit — a crash between
        // the two would otherwise leave a payment pointing at nothing.
        await manager.update(Payment, paymentId, { invoice_id: invoice.id });
        return invoice.id;
      });
    } catch (err) {
      // A concurrent call raced us and won — `IDX_invoices_payment_id_
      // kind_invoice` (B6) rejects the second INVOICE-kind row for this
      // payment_id. Postgres aborts the whole transaction on that
      // violation, so re-reading with the same (now-aborted) `manager`
      // would itself fail with "current transaction is aborted" — the
      // re-read has to happen outside the transaction, after it has
      // rolled back, on `this.repo` rather than `invoiceRepo`.
      if (!isInvoicePaymentUniqueViolation(err)) throw err;
      const winner = await this.repo.findOne({
        where: { payment_id: paymentId, kind: InvoiceKind.INVOICE, deleted_at: IsNull() },
      });
      if (!winner) throw err;
      invoiceId = winner.id;
    }
    return this.findOne(invoiceId, tenantId);
  }

  /** [16.5.1, amounts fixed by 16.6.1] Mints a credit note reversing the
   * invoice already issued for `paymentId` (`kind = CREDIT_NOTE`, linked
   * back via `related_invoice_id`, its own `status = ISSUED`, its own
   * numbering series). `total_amount`/`tax_amount`/`discount_amount`
   * mirror the original invoice's amounts as positive numbers — `kind`
   * is the discriminator that marks a row as a credit note, not the
   * sign. Storing a negative here would violate the real DB check
   * constraints (`CHK_inv_total_amount CHECK (total_amount > 0)`, etc.
   * from the initial migration); the sibling fix in
   * `PaymentReversalService` uses the same convention for reversal
   * `Payment` rows. Display code that wants a signed amount (e.g. the
   * print template) negates at render time via `signedAmount()`. */
  async createCreditNote(
    paymentId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    const invoiceRepo = manager.getRepository(Invoice);
    const original = await invoiceRepo.findOne({
      where: { payment_id: paymentId, kind: InvoiceKind.INVOICE, deleted_at: IsNull() },
    });
    if (!original) {
      throw new NotFoundException('No invoice found for this payment to reverse');
    }

    const creditNoteNumber = await generateCreditNoteNumber(manager, original.tenant_id);
    const creditNote = await invoiceRepo.save(
      invoiceRepo.create({
        invoice_number: creditNoteNumber,
        tenant_id: original.tenant_id,
        kind: InvoiceKind.CREDIT_NOTE,
        student_id: original.student_id,
        payment_id: original.payment_id,
        related_invoice_id: original.id,
        total_amount: Math.abs(Number(original.total_amount)),
        tax_amount: Math.abs(Number(original.tax_amount)),
        discount_amount: Math.abs(Number(original.discount_amount)),
        status: InvoiceStatus.ISSUED,
        issued_date: new Date(),
        due_date: new Date(),
        snapshot: original.snapshot,
        issued_by_user_id: original.issued_by_user_id,
        notes: reason,
        issuer_snapshot: original.issuer_snapshot,
      }),
    );
    original.status = InvoiceStatus.CANCELLED;
    await invoiceRepo.save(original);
    return creditNote;
  }

  async findOne(id: string, tenantId: string): Promise<Invoice & { issuer: IssuerSnapshot }> {
    const invoice = await this.repo.findOne({
      // [2638] Scope by the invoice's own tenant_id; `withDeleted` loads a
      // soft-deleted student, `deleted_at: IsNull()` still hides deleted invoices.
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['student', 'issued_by'],
      withDeleted: true,
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    // [15.5.5] `resolveIssuer` falls back to the live school profile for
    // any invoice created before this feature (null `issuer_snapshot`).
    const school = await this.schoolRepo.findOneOrFail({ where: { id: tenantId } });
    return { ...withPeriodStart(invoice), issuer: resolveIssuer(invoice, school) };
  }

  /**
   * @param restrictToStudentIds [5.1] — when supplied, only invoices for
   *   these students are returned. `InvoicesController` fills this in for
   *   PARENT/STUDENT callers from `FamilyAccessService`. `query.student_id`
   *   is caller-controlled and merely *intersects* with it, so naming an
   *   unlinked student yields an empty page rather than a leak.
   *
   *   An empty array means "linked to nobody" → empty page; `undefined`
   *   means "no restriction" (staff).
   */
  /** [8.15.11] Every invoice matching the list's own filters, as export rows. */
  exportHeader(): string[] {
    return ['Invoice No.', 'Student', 'Registration No.', 'Issued', 'Total', 'Status'];
  }

  iterateForExport(query: QueryInvoiceDto, tenantId: string) {
    return pagedRows(
      (page, limit) => this.findAll({ ...query, page, limit }, tenantId),
      (invoice: Invoice) => [
        invoice.invoice_number,
        invoice.student?.full_name ?? '',
        invoice.student?.registration_number ?? '',
        exportDate(invoice.issued_date),
        invoice.total_amount,
        invoice.status,
      ],
    );
  }

  async findAll(query: QueryInvoiceDto, tenantId: string, restrictToStudentIds?: string[]) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('invoice')
      // withDeleted() before the join: TypeORM adds `student.deleted_at IS NULL` at join time.
      .withDeleted()
      .leftJoinAndSelect('invoice.student', 'student')
      .where('invoice.tenant_id = :tenantId', { tenantId })
      .andWhere('invoice.deleted_at IS NULL');

    const search = normalizeSearchTerm(query.search);
    if (search) {
      qb.andWhere('(invoice.invoice_number ILIKE :search OR student.full_name ILIKE :search)', {
        search: `%${search}%`,
      });
    }
    if (restrictToStudentIds !== undefined) {
      if (restrictToStudentIds.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0 };
      }
      qb.andWhere('invoice.student_id IN (:...restrictToStudentIds)', { restrictToStudentIds });
    }
    if (query.student_id) {
      qb.andWhere('invoice.student_id = :studentId', { studentId: query.student_id });
    }
    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }
    if (query.from_date) {
      qb.andWhere('invoice.issued_date >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      qb.andWhere('invoice.issued_date <= :toDate', { toDate: query.to_date });
    }
    if (query.min_amount !== undefined) {
      qb.andWhere('invoice.total_amount >= :minAmount', { minAmount: query.min_amount });
    }
    if (query.max_amount !== undefined) {
      qb.andWhere('invoice.total_amount <= :maxAmount', { maxAmount: query.max_amount });
    }

    const sortColumn: Record<string, string> = {
      issued_date: 'invoice.issued_date',
      due_date: 'invoice.due_date',
      total_amount: 'invoice.total_amount',
      invoice_number: 'invoice.invoice_number',
      status: 'invoice.status',
    };
    const orderDirection = query.order === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(sortColumn[query.sort ?? 'issued_date'], orderDirection).addOrderBy(
      'invoice.id',
      'ASC',
    );

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * `format` — `a4` (default), `pos58`, or `pos80`; validated at the
   * controller ([16.5.2]).
   *
   * `linkedStudentIds` — [664 follow-up, 665] when set (a PARENT/STUDENT
   * caller), both templates filter `snapshot.students[]` down to this
   * subset before rendering, so a guardian linked to only one of two
   * siblings on a shared invoice never sees the other child's name,
   * registration number, or fee lines in the printed HTML — the same
   * privacy boundary the JSON response (`findOne`/`findAll`) already
   * enforces. `undefined` (staff/admin) renders every student, unfiltered.
   */
  async getPrintableHtml(
    id: string,
    tenantId: string,
    format: InvoicePrintFormat = 'a4',
    linkedStudentIds?: string[],
  ): Promise<string> {
    const invoice = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['student'],
      withDeleted: true,
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    // [15.5.7] live school profile is `resolveIssuer`'s fallback.
    const school = await this.schoolRepo.findOneOrFail({ where: { id: tenantId } });
    const issuer = resolveIssuer(invoice, school);
    // The logo is inlined as a `data:` URL: the client opens this HTML as a
    // `blob:` document, where a relative `<img src>` neither resolves nor
    // carries the bearer token `GET /schools/:id/logo` needs.
    const logoDataUrl = await readLogoDataUrl(this.storage, issuer.logo_key);

    if (format === 'pos58' || format === 'pos80') {
      // [16.5.2] POS renders from the snapshot's own `payment` block, not
      // the live `payments` table — a thermal receipt shows the one
      // payment this document was issued for, not the full history the
      // A4 format's "Payment History" table lists.
      return renderInvoicePosHtml(invoice, issuer, logoDataUrl, format, linkedStudentIds, null);
    }

    const payments = invoice.payment_id
      ? await this.paymentRepo.find({
          where: { id: invoice.payment_id, deleted_at: IsNull() },
          order: { payment_date: 'DESC' },
        })
      : [];
    return renderInvoiceHtml(invoice, payments, issuer, logoDataUrl, linkedStudentIds);
  }
}

/** [B6] True when `err` is specifically a unique-violation (SQLSTATE
 * 23505) on `IDX_invoices_payment_id_kind_invoice` — not just any
 * unique-constraint failure on `invoices`, so a future unrelated unique
 * constraint can't be misread as this race. Works however the error
 * reached us — a raw driver error or TypeORM's `QueryFailedError`
 * wrapper, both of which surface the driver's `code` and `constraint`. */
function isInvoicePaymentUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === '23505' && e.constraint === 'IDX_invoices_payment_id_kind_invoice';
}
