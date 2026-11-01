import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  NOTICE_LIMITS,
  NoticeStatus,
  Permission,
  roleHasPermission,
  type UserRole,
} from '@biddaloy/shared';
import { StorageService, type StoredObject } from '../../storage/storage.service';
import { tenantObjectKey } from '../../storage/storage-key';
import { matchesDeclaredType } from '../../storage/file-signature';
import { Notice } from '../entities/notice.entity';
import { NoticeAttachment } from '../entities/notice-attachment.entity';
import { claimRecipientRows } from '../notice-recipients.service';
import type { NoticeFileDto } from './dto/notice-reader.dto';

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type NoticeCaller = { userId: string; role: UserRole };

export const toDto = (a: NoticeAttachment): NoticeFileDto => ({
  id: a.id,
  original_name: a.original_name,
  mime_type: a.mime_type,
  size_bytes: a.size_bytes,
});

const isHeic = (f: Express.Multer.File) =>
  /^image\/hei[cf]$/i.test(f.mimetype) || /\.hei[cf]$/i.test(f.originalname ?? '');

/** [53.2.02] Notice files: author or NOTICE_MANAGE writes; author, manager or a recipient reads. */
@Injectable()
export class NoticeFilesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  private canManage(user: NoticeCaller) {
    return roleHasPermission(user.role, Permission.NOTICE_MANAGE);
  }

  /** Author or manager, notice not withdrawn. 404 for anyone else (no existence leak). */
  private async writable(
    manager: EntityManager,
    tenantId: string,
    user: NoticeCaller,
    id: string,
    lock = false,
  ): Promise<Notice> {
    const n = await manager.findOne(Notice, {
      where: { id, tenant_id: tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!n || (n.author_user_id !== user.userId && !this.canManage(user))) {
      throw new NotFoundException('Notice not found');
    }
    if (n.status === NoticeStatus.WITHDRAWN) {
      throw new UnprocessableEntityException('Files cannot change on a withdrawn notice');
    }
    return n;
  }

  private async assertRoom(manager: EntityManager, n: Notice, adding: number) {
    const existing = await manager.count(NoticeAttachment, {
      where: { tenant_id: n.tenant_id, notice_id: n.id },
    });
    if (existing + adding > NOTICE_LIMITS.filesMax) {
      throw new BadRequestException(`A notice can have at most ${NOTICE_LIMITS.filesMax} files`);
    }
  }

  async upload(
    tenantId: string,
    user: NoticeCaller,
    noticeId: string,
    files: Express.Multer.File[],
  ): Promise<NoticeFileDto[]> {
    // Array check, not just `.length`: a tampered request must not pass a string here.
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }
    const manager = this.dataSource.manager;
    const current = await this.writable(manager, tenantId, user, noticeId);
    await this.assertRoom(manager, current, files.length);

    for (const file of files) {
      // D6: HEIC first, so the person is told how to fix it.
      if (isHeic(file)) throw new BadRequestException('ছবিটি JPG করে দিন');
      if (!(NOTICE_LIMITS.mimeTypes as readonly string[]).includes(file.mimetype)) {
        throw new BadRequestException('File must be PDF, JPG, PNG or WebP');
      }
      if (file.size > NOTICE_LIMITS.fileBytesMax) {
        throw new BadRequestException(
          `File must be at most ${NOTICE_LIMITS.fileBytesMax / (1024 * 1024)}MB`,
        );
      }
      if (!matchesDeclaredType(file.buffer, file.mimetype)) {
        throw new BadRequestException('File content does not match its declared type');
      }
      if (file.originalname.length > 255) {
        throw new BadRequestException('Filename must be at most 255 characters');
      }
    }

    const keys: string[] = [];
    try {
      for (const file of files) {
        const key = tenantObjectKey(tenantId, 'notice-files', EXT[file.mimetype]);
        keys.push(key);
        await this.storage.put(key, file.buffer, file.mimetype);
      }
      const saved = await this.dataSource.transaction(async (tx) => {
        // Lock + re-count so two parallel uploads cannot both pass the limit.
        const n = await this.writable(tx, tenantId, user, noticeId, true);
        await this.assertRoom(tx, n, files.length);
        const rows = await tx.save(
          NoticeAttachment,
          files.map((file, i) =>
            tx.create(NoticeAttachment, {
              tenant_id: tenantId,
              notice_id: n.id,
              storage_key: keys[i],
              original_name: file.originalname,
              mime_type: file.mimetype,
              size_bytes: file.size,
            }),
          ),
        );
        if (n.status === NoticeStatus.PUBLISHED) {
          await tx.update(Notice, { id: n.id, tenant_id: tenantId }, { edited_at: new Date() });
        }
        return rows;
      });
      return saved.map(toDto);
    } catch (e) {
      await Promise.all(
        keys.map((k) => this.storage.deleteForTenant(k, tenantId).catch(() => undefined)),
      );
      throw e;
    }
  }

  async remove(
    tenantId: string,
    user: NoticeCaller,
    noticeId: string,
    fileId: string,
  ): Promise<void> {
    const key = await this.dataSource.transaction(async (tx) => {
      const n = await this.writable(tx, tenantId, user, noticeId, true);
      const file = await tx.findOne(NoticeAttachment, {
        where: { id: fileId, notice_id: n.id, tenant_id: tenantId },
      });
      if (!file) throw new NotFoundException('File not found');
      await tx.delete(NoticeAttachment, { id: file.id, tenant_id: tenantId });
      if (n.status === NoticeStatus.PUBLISHED) {
        await tx.update(Notice, { id: n.id, tenant_id: tenantId }, { edited_at: new Date() });
      }
      return file.storage_key;
    });
    await this.storage.deleteForTenant(key, tenantId).catch(() => undefined);
  }

  /** Author, manager, or a recipient of a PUBLISHED notice. Everyone else: 404. */
  async open(
    tenantId: string,
    user: NoticeCaller,
    noticeId: string,
    fileId: string,
  ): Promise<{ file: NoticeAttachment; object: StoredObject }> {
    const m = this.dataSource.manager;
    const n = await m.findOne(Notice, { where: { id: noticeId, tenant_id: tenantId } });
    let allowed = !!n && (n.author_user_id === user.userId || this.canManage(user));
    if (n && !allowed && n.status === NoticeStatus.PUBLISHED) {
      await claimRecipientRows(m, tenantId, user.userId);
      const rows = await m.query(
        `SELECT 1 FROM notice_recipients WHERE tenant_id = $1 AND notice_id = $2 AND user_id = $3 LIMIT 1`,
        [tenantId, noticeId, user.userId],
      );
      allowed = rows.length > 0;
    }
    if (!n || !allowed) throw new NotFoundException('File not found');
    const file = await m.findOne(NoticeAttachment, {
      where: { id: fileId, notice_id: noticeId, tenant_id: tenantId },
    });
    if (!file) throw new NotFoundException('File not found');
    return { file, object: await this.storage.getForTenant(file.storage_key, tenantId) };
  }
}
