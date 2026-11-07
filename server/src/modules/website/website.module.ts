import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../schools/entities/school.entity';
import { Notice } from '../notices/entities/notice.entity';
import { StorageModule } from '../storage/storage.module';
import { SchoolsModule } from '../schools/schools.module';
import { SchoolSite } from './entities/school-site.entity';
import { SiteMedia } from './entities/site-media.entity';
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
import { NoticesFeed } from './public/feeds/notices.feed';

/**
 * [40.1.04] The school website: ADMIN editing (`/website`) and the anonymous by-host reads the
 * site container uses (`/public/site/by-host/:host/*`). `TENANT_STATUS_REDIS` is global.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SchoolSite, SiteMedia, School, Notice]),
    StorageModule,
    SchoolsModule,
  ],
  controllers: [
    SiteConfigController,
    SubdomainController,
    SiteMediaController,
    PublicSiteController,
  ],
  providers: [
    SiteConfigService,
    SubdomainService,
    PreviewTokenService,
    SiteMediaService,
    PublicSiteService,
    SiteHostService,
    SiteCacheService,
    NoticesFeed,
  ],
  exports: [SiteCacheService],
})
export class WebsiteModule {}
