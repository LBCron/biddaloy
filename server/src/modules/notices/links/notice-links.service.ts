import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { NoticeStatus } from '@biddaloy/shared';
import { Notice } from '../entities/notice.entity';
import { NoticeAttachment } from '../entities/notice-attachment.entity';
import { NoticeRecipient } from '../entities/notice-recipient.entity';
import { School } from '../../schools/entities/school.entity';
import { SchoolsService } from '../../schools/schools.service';
import { StorageService } from '../../storage/storage.service';
import { PublicNoticeDto } from './public-notice.dto';

/** 32 random bytes, base64url. Only the sha256 is stored. Copy of invoice-share.service.ts. */
function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** A real token is 43 characters; anything longer never reaches the database. */
const MAX_TOKEN_LENGTH = 64;

export interface ResolvedNoticeLink {
  notice: Notice;
  schoolName: string;
  /** Set when the token is a personal link; null for the public link. */
  recipientId: string | null;
}

/**
 * [53.2.02] Notice links: one public link per notice and one personal link per
 * recipient. `resolve` is read-only (Rule 17): a mail or link scanner must not
 * fake a read. Only `markOpened` writes, and only for a personal token.
 */
@Injectable()
export class NoticeLinksService {
  constructor(
    @InjectRepository(Notice) private readonly notices: Repository<Notice>,
    @InjectRepository(NoticeRecipient) private readonly recipients: Repository<NoticeRecipient>,
    @InjectRepository(NoticeAttachment) private readonly attachments: Repository<NoticeAttachment>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly schoolsService: SchoolsService,
    private readonly storage: StorageService,
  ) {}

  /** Returns the raw token once; only its hash is kept. */
  async createPublicLink(notice: Pick<Notice, 'id' | 'tenant_id'>): Promise<string> {
    const token = generateRawToken();
    const res = await this.notices.update(
      { id: notice.id, tenant_id: notice.tenant_id },
      { public_token_hash: hashToken(token), public_token_created_at: new Date() },
    );
    // Never hand back a token that points at nothing (wrong tenant or missing notice).
    if (!res.affected) throw new Error('Notice not found for this tenant');
    return token;
  }

  async turnOffPublicLink(notice: Pick<Notice, 'id' | 'tenant_id'>): Promise<void> {
    await this.notices.update(
      { id: notice.id, tenant_id: notice.tenant_id },
      { public_token_hash: null, public_token_created_at: null },
    );
  }

  /**
   * Only recipients of this notice get a link; other ids are skipped. Pass `em` to write the
   * hashes inside the caller's transaction, so they commit or roll back with it.
   */
  async createPersonalLinks(
    noticeId: string,
    recipientIds: string[],
    em?: EntityManager,
  ): Promise<{ recipientId: string; token: string }[]> {
    if (recipientIds.length === 0) return [];
    const recipients = em ? em.getRepository(NoticeRecipient) : this.recipients;
    const rows = await recipients.find({
      select: { id: true },
      where: { notice_id: noticeId, id: In(recipientIds) },
    });
    const out: { recipientId: string; token: string }[] = [];
    for (const { id } of rows) {
      const token = generateRawToken();
      await recipients.update(
        { id, notice_id: noticeId },
        { link_token_hash: hashToken(token) },
      );
      out.push({ recipientId: id, token });
    }
    return out;
  }

  /** Withdraw / delete: every link of the notice stops working at once. */
  async killAll(noticeId: string): Promise<void> {
    await this.notices.update(
      { id: noticeId },
      { public_token_hash: null, public_token_created_at: null },
    );
    await this.recipients.update(
      { notice_id: noticeId, link_token_hash: Not(IsNull()) },
      { link_token_hash: null },
    );
  }

  /** Null for every dead token (unknown, turned off, draft, withdrawn, expired). Never writes. */
  async resolve(token: string): Promise<ResolvedNoticeLink | null> {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const hash = hashToken(token);

    let notice = await this.notices.findOne({ where: { public_token_hash: hash } });
    let recipientId: string | null = null;
    // public hash still set while the flag is off (a failed clean-up): the link is dead
    if (notice && !notice.is_public) return null;
    if (!notice) {
      const recipient = await this.recipients.findOne({ where: { link_token_hash: hash } });
      if (!recipient) return null;
      recipientId = recipient.id;
      notice = await this.notices.findOne({
        where: { id: recipient.notice_id, tenant_id: recipient.tenant_id },
      });
    }
    if (!notice || notice.status !== NoticeStatus.PUBLISHED || notice.withdrawn_at) return null;

    const school = await this.schools.findOne({ where: { id: notice.tenant_id } });
    if (!school || school.status !== 'ACTIVE') return null;

    if (notice.expires_on) {
      if (notice.expires_on < (await this.schoolsService.todayFor(notice.tenant_id))) return null;
    }
    return { notice, schoolName: school.name, recipientId };
  }

  async getPage(token: string): Promise<PublicNoticeDto | null> {
    const r = await this.resolve(token);
    if (!r) return null;
    const files = await this.attachments.find({
      where: { notice_id: r.notice.id, tenant_id: r.notice.tenant_id },
      order: { sort: 'ASC', created_at: 'ASC' },
    });
    return {
      schoolName: r.schoolName,
      title: r.notice.title,
      body: r.notice.body,
      publishedAt: r.notice.published_at,
      editedAt: r.notice.edited_at,
      files: files.map((f) => ({ id: f.id, mimeType: f.mime_type, name: f.original_name })),
    };
  }

  /** Null when the token is dead, the file is not this notice's, or storage has no object. */
  async getFile(
    token: string,
    fileId: string,
  ): Promise<{ body: Readable; mimeType: string } | null> {
    const r = await this.resolve(token);
    if (!r) return null;
    const file = await this.attachments.findOne({
      where: { id: fileId, notice_id: r.notice.id, tenant_id: r.notice.tenant_id },
    });
    if (!file) return null;
    try {
      const object = await this.storage.getForTenant(file.storage_key, r.notice.tenant_id);
      return { body: object.body as Readable, mimeType: file.mime_type };
    } catch {
      return null;
    }
  }

  /**
   * D22: a personal link, opened once, marks the recipient seen. Conditional
   * UPDATEs keep the first time. Returns false for a dead token; a public
   * token is valid and writes nothing.
   */
  async markOpened(token: string): Promise<boolean> {
    const r = await this.resolve(token);
    if (!r) return false;
    if (r.recipientId) {
      const now = new Date();
      const where = { id: r.recipientId, notice_id: r.notice.id, tenant_id: r.notice.tenant_id };
      await this.recipients.update({ ...where, link_opened_at: IsNull() }, { link_opened_at: now });
      await this.recipients.update({ ...where, seen_at: IsNull() }, { seen_at: now });
    }
    return true;
  }
}
