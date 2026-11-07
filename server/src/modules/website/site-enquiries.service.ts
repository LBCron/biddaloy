import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CommunicationMedium, SiteSectionKey } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { CommunicationsService } from '../communications/communications.service';
import { SiteEnquiry } from './entities/site-enquiry.entity';
import type { CreateEnquiryDto, EnquiryDto, EnquiryListDto } from './dto/site-enquiry.dto';

const toDto = (e: SiteEnquiry): EnquiryDto => ({
  id: e.id,
  name: e.name,
  phone: e.phone,
  message: e.message,
  seen_at: e.seen_at ? e.seen_at.toISOString() : null,
  created_at: e.created_at.toISOString(),
});

/**
 * The office-SMS switch (D22, D37) lives on the published `contact` section as
 * `enquirySmsToOffice: true`. Absent or anything but `true` means off.
 */
export function officeSmsOn(published: SiteConfig): boolean {
  return published.pages.some((p) =>
    p.sections.some((s) => s.key === SiteSectionKey.CONTACT && s.data.enquirySmsToOffice === true),
  );
}

/** [40.3.01] Contact-form messages from the public site (D22). */
@Injectable()
export class SiteEnquiriesService {
  private readonly logger = new Logger(SiteEnquiriesService.name);

  constructor(
    @InjectRepository(SiteEnquiry) private readonly enquiries: Repository<SiteEnquiry>,
    private readonly communications: CommunicationsService,
  ) {}

  /**
   * Stores one enquiry. `tenantId` comes from the host the caller resolved, never the body.
   * With the switch on, one SMS goes to the school phone; a failed SMS never loses the enquiry.
   */
  async createPublic(
    tenantId: string,
    dto: CreateEnquiryDto,
    office: { smsOn: boolean; phone: string | null; schoolName: string },
  ): Promise<void> {
    await this.enquiries.insert({
      tenant_id: tenantId,
      name: dto.name,
      phone: dto.phone,
      message: dto.message,
    });
    if (!office.smsOn || !office.phone) return;
    try {
      await this.communications.enqueue(
        {
          medium: CommunicationMedium.SMS,
          recipient_address: office.phone,
          recipient_name: office.schoolName.slice(0, 100),
          message_body: `Website enquiry from ${dto.name} (${dto.phone}): ${dto.message}`.slice(
            0,
            300,
          ),
        },
        tenantId,
        // No signed-in user sent this; the log column is nullable.
        null as unknown as string,
      );
    } catch (e) {
      this.logger.warn(`enquiry SMS failed: ${String(e)}`);
    }
  }

  async list(tenantId: string, page: number, limit: number): Promise<EnquiryListDto> {
    const [rows, total] = await this.enquiries.findAndCount({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const unseen = await this.enquiries.count({
      where: { tenant_id: tenantId, seen_at: IsNull() },
    });
    return { items: rows.map(toDto), total, unseen };
  }

  async markSeen(tenantId: string, id: string): Promise<EnquiryDto> {
    const e = await this.find(tenantId, id);
    if (!e.seen_at) {
      e.seen_at = new Date();
      await this.enquiries.update({ id, tenant_id: tenantId }, { seen_at: e.seen_at });
    }
    return toDto(e);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    await this.enquiries.delete({ id, tenant_id: tenantId });
  }

  private async find(tenantId: string, id: string): Promise<SiteEnquiry> {
    const e = await this.enquiries.findOne({ where: { id, tenant_id: tenantId } });
    if (!e) throw new NotFoundException('site.enquiry_not_found');
    return e;
  }
}
