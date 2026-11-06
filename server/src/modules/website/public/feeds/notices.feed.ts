import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NoticeStatus } from '@biddaloy/shared';
import { Notice } from '../../../notices/entities/notice.entity';
import { SchoolsService } from '../../../schools/schools.service';

export interface WebsiteNoticeItem {
  id: string;
  title: string;
  /** Publish time, ISO. The site island reads `date`. */
  date: string;
  link: string;
}

/**
 * The public notice list for the site's `notices` island. Only `is_public` published notices
 * that are not withdrawn or expired; pinned-on-website first, newest 20. No body, no files.
 */
@Injectable()
export class NoticesFeed {
  constructor(
    @InjectRepository(Notice) private readonly notices: Repository<Notice>,
    private readonly schools: SchoolsService,
  ) {}

  async load(tenantId: string): Promise<WebsiteNoticeItem[]> {
    // The school's own date, not the database's UTC day (same as the rest of notices).
    const today = await this.schools.todayFor(tenantId);
    const rows = await this.notices
      .createQueryBuilder('n')
      .select(['n.id', 'n.title', 'n.published_at'])
      .where('n.tenant_id = :tenantId', { tenantId })
      .andWhere('n.is_public = true')
      .andWhere('n.status = :status', { status: NoticeStatus.PUBLISHED })
      .andWhere('n.withdrawn_at IS NULL')
      .andWhere('(n.expires_on IS NULL OR n.expires_on >= :today)', { today })
      .orderBy('n.pinned_on_website', 'DESC')
      .addOrderBy('n.published_at', 'DESC')
      .limit(20)
      .getMany();
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      date: (n.published_at as Date).toISOString(),
      link: '/notices',
    }));
  }
}
