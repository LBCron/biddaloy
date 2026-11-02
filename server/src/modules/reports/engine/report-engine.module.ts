import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassModule } from '../../classes/classes.module';
import { ReportCompiler } from './compiler/report-compiler';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { DefinitionRowSource } from './runner/definition-row-source';
import { ReportResultCache } from './runner/report-result.cache';
import { ReportRunnerService } from './runner/report-runner.service';
import { ReportRegistry } from './registry/registry';
import { RoleScopePolicy } from './security/role-scope.policy';

/** [8.15.14] The report engine's shared pieces: the semantic layer, the role scope policy and the compiler. */
@Module({
  imports: [ClassModule, TypeOrmModule.forFeature([ReportDefinitionVersion])],
  providers: [
    ReportRegistry,
    RoleScopePolicy,
    ReportCompiler,
    ReportResultCache,
    ReportRunnerService,
    DefinitionRowSource,
  ],
  exports: [ReportRegistry, RoleScopePolicy, ReportCompiler, ReportRunnerService],
})
export class ReportEngineModule {}
