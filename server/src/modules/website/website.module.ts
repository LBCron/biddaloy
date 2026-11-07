import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../schools/entities/school.entity';
import { Notice } from '../notices/entities/notice.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { CommunicationsModule } from '../communications/communications.module';
import { TurnstileService } from '../registration/turnstile.service';
import { StorageModule } from '../storage/storage.module';
import { SchoolsModule } from '../schools/schools.module';
import { ExamsModule } from '../exams/exams.module';
import { ResultsFeed } from './public/feeds/results.feed';
import { SchoolSite } from './entities/school-site.entity';
import { SiteMedia } from './entities/site-media.entity';
import { SitePost } from './entities/site-post.entity';
import { SiteEnquiry } from './entities/site-enquiry.entity';
import { StaffWebProfile } from './entities/staff-web-profile.entity';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';
import { SubdomainController } from './subdomain.controller';
import { SubdomainService } from './subdomain.service';
import { PreviewTokenService } from './preview-token.service';
import { SiteMediaController } from './site-media.controller';
import { SiteMediaService } from './site-media.service';
import { PublicSiteController } from './public/public-site.controller';
import { PublicSiteService } from './public/public-site.service';
import { SiteHostService } from './public/site-host.service';
import { SiteCacheService } from './public/site-cache.service';
import { SitePostsController } from './site-posts.controller';
import { SitePostsService } from './site-posts.service';
import { PublicEnquiryController, SiteEnquiriesController } from './site-enquiries.controller';
import { SiteEnquiriesService } from './site-enquiries.service';
import { StaffWebProfilesController } from './staff-web-profiles.controller';
import { StaffWebProfilesService } from './staff-web-profiles.service';
import { NoticesFeed } from './public/feeds/notices.feed';
import { EventsFeed } from './public/feeds/events.feed';
import { RoutineFeed } from './public/feeds/routine.feed';
import { TeachersFeed } from './public/feeds/teachers.feed';
import { ClassSectionsFeed } from './public/feeds/class-sections.feed';
import { BlogFeed } from './public/feeds/blog.feed';
import { FeesFeed } from './public/feeds/fees.feed';
import { AdmissionsFeed } from './public/feeds/admissions.feed';
import { FeedRegistry } from './public/feeds/feed-registry';
import { CustomDomainController } from './custom-domain.controller';
import { CustomDomainService } from './custom-domain.service';
import { CUSTOM_DOMAIN_QUEUE, CustomDomainProcessor } from './custom-domain.processor';
import { CloudflareSaasClient } from './cloudflare-saas.client';
import { UmamiClient } from './umami.client';
import { UmamiService } from './umami.service';

/**
 * [40.1.04] The school website: ADMIN editing (`/website`) and the anonymous by-host reads the
 * site container uses (`/public/site/by-host/:host/*`). `TENANT_STATUS_REDIS` is global.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SchoolSite,
      SiteMedia,
      School,
      Notice,
      SitePost,
      SiteEnquiry,
      StaffWebProfile,
      UserTenant,
    ]),
    BullModule.registerQueue({ name: CUSTOM_DOMAIN_QUEUE }),
    StorageModule,
    SchoolsModule,
    ExamsModule,
    CommunicationsModule,
  ],
  controllers: [
    SiteConfigController,
    SubdomainController,
    CustomDomainController,
    SiteMediaController,
    PublicSiteController,
    SitePostsController,
    SiteEnquiriesController,
    PublicEnquiryController,
    StaffWebProfilesController,
  ],
  providers: [
    SiteConfigService,
    SubdomainService,
    CustomDomainService,
    CustomDomainProcessor,
    CloudflareSaasClient,
    UmamiClient,
    UmamiService,
    PreviewTokenService,
    SiteMediaService,
    PublicSiteService,
    SiteHostService,
    SiteCacheService,
    NoticesFeed,
    EventsFeed,
    RoutineFeed,
    TeachersFeed,
    BlogFeed,
    FeesFeed,
    AdmissionsFeed,
    ResultsFeed,
    ClassSectionsFeed,
    FeedRegistry,
    SitePostsService,
    SiteEnquiriesService,
    StaffWebProfilesService,
    TurnstileService,
  ],
  exports: [SiteCacheService],
})
export class WebsiteModule {}
