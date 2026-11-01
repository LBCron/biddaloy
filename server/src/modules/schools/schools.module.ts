import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { SchoolsController } from './schools.controller';
import { EncryptionService } from './settings/encryption.service';
import { buildEncryptionKey, buildPreviousEncryptionKeys } from './settings/encryption-key';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import { SchoolSettingsReader } from './settings/school-settings-reader.service';
import { TenantStatusModule } from './tenant-status.module';
import { AuditModule } from '../audit/audit.module';
import { SchoolProfileController } from './profile/profile.controller';
import { SchoolProfileService } from './profile/profile.service';
import { SchoolLogoController } from './profile/logo.controller';
import { SchoolLogoService } from './profile/logo.service';
import { StorageModule } from '../storage/storage.module';
import { ProvisioningService } from './provisioning/provisioning.service';
import { ProvisioningController } from './provisioning/provisioning.controller';
import { SchoolAdminsService } from './admins/school-admins.service';
import { SchoolAdminsController } from './admins/school-admins.controller';
import { AccountAccessModule } from '../account-access/account-access.module';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuthToken } from '../account-access/entities/auth-token.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CreditsModule } from '../communications/credits/credits.module';
import { SchoolSmsCreditsController } from './sms-credits/sms-credits.controller';
import { SmsCreditsService } from './sms-credits/sms-credits.service';
// [33.3.1] Entity-only registration (no ClassModule import) — same
// reasoning as Student above: SchoolsService's vocabulary guard needs to
// count/rewrite Class/ClassSection rows on an `organisation` settings
// change without a cross-module DI cycle (ClassModule already imports
// SchoolsModule for SchoolSettingsReader).
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';

const TENANT_SETTINGS_CACHE_TTL_MS = 30_000;

/** The `EncryptionService` provider's `useFactory`, pulled out and exported
 * so `schools.module.spec.ts` can exercise this exact wiring — every other
 * spec in this module builds `new EncryptionService(randomBytes(32))`
 * directly, which bypasses `buildEncryptionKey`'s "no key outside
 * production" behaviour entirely. */
export function encryptionServiceFactory(config: ConfigService): EncryptionService {
  const currentKey = buildEncryptionKey(
    config.get<string>('NODE_ENV'),
    config.get<string>('SETTINGS_ENCRYPTION_KEY'),
  );
  const previousKeys = buildPreviousEncryptionKeys(
    config.get<string>('SETTINGS_ENCRYPTION_KEY_PREVIOUS'),
  );
  return new EncryptionService(currentKey, previousKeys);
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      School,
      UserTenant,
      Student,
      CommunicationLog,
      AuditLog,
      User,
      AuthToken,
      Class,
      ClassSection,
    ]),
    ConfigModule,
    AuditModule,
    StorageModule,
    TenantStatusModule,
    // Circular: AccountAccessModule imports SchoolsModule (for
    // SchoolsService's tenant-settings lookups) — forwardRef breaks the
    // cycle so ProvisioningService can reuse AccountAccessDeliveryService
    // rather than re-implementing invitation delivery here (#529).
    forwardRef(() => AccountAccessModule),
    // Circular: CreditsModule already forwardRef's SchoolsModule (it needs
    // SchoolsService's resolved-settings lookup for isMetered) — this is
    // the other half of that same break, so SchoolsModule can reach
    // SmsCreditService for the SUPER_ADMIN grant/adjust endpoint (#550).
    forwardRef(() => CreditsModule),
  ],
  controllers: [
    SchoolsController,
    SchoolProfileController,
    SchoolLogoController,
    ProvisioningController,
    SchoolAdminsController,
    SchoolSmsCreditsController,
  ],
  providers: [
    SchoolsService,
    SchoolProfileService,
    SchoolLogoService,
    ProvisioningService,
    SchoolAdminsService,
    SmsCreditsService,
    SchoolSettingsReader,
    {
      provide: EncryptionService,
      inject: [ConfigService],
      // Eagerly instantiated as part of module setup (Nest's default —
      // this module isn't lazy-loaded), so a production boot with no
      // SETTINGS_ENCRYPTION_KEY fails right here, at startup, rather than
      // on whatever request first happens to touch a tenant secret.
      useFactory: encryptionServiceFactory,
    },
    {
      provide: TenantSettingsCache,
      // A `useFactory` with no `inject` — Nest's constructor injection has
      // no provider for a bare `number`, so `new TenantSettingsCache(...)`
      // has to be called explicitly rather than left to `providers:
      // [TenantSettingsCache]`'s default `new TenantSettingsCache()`
      // (which would fail to resolve `ttlMs` at boot).
      useFactory: () => new TenantSettingsCache(TENANT_SETTINGS_CACHE_TTL_MS),
    },
  ],
  // TenantSettingsCache is exported so MessagingConfigResolver
  // (in communications/config) can share the exact same cache instance
  // SchoolsService invalidates on write — a second, module-local instance
  // would never see that invalidation and could serve stale credentials
  // past a rotation.
  //
  // TenantStatusService (SchoolsService's own dependency, injected via
  // `TenantStatusModule`'s `@Global()` export — see that module's file
  // comment) is not re-declared or re-exported here.
  // SchoolSettingsReader is exported so 16.2.2's auth/step-up module can
  // read `settings.fees.approvalMode` without depending on the rest of
  // SchoolsService's surface.
  exports: [SchoolsService, EncryptionService, TenantSettingsCache, SchoolSettingsReader],
})
export class SchoolsModule {}
