import { Injectable } from '@nestjs/common';

/** One list that can be exported: its header and a way to read every matching row. */
export interface ReportRowSource {
  header(
    tenantId: string,
    userId: string,
    query: Record<string, unknown>,
  ): string[] | Promise<string[]>;
  /**
   * Every row matching `query`, in the list's order. The queued job calls this with the filters
   * saved on the run. Only roles holding REPORTS_EXPORT can queue an export, and none of them is
   * limited to assigned sections, so no section scope is passed.
   */
  rows(tenantId: string, userId: string, query: Record<string, unknown>): AsyncIterable<unknown[]>;
}

/**
 * [8.15.16] Which sources a queued export can rebuild by name. The owning service registers its
 * list when it starts (`students-list`, `dues-list`, ...); defined reports add theirs in [8.15.22].
 * A map in this folder rather than imports of the feature modules, so the global export module
 * never depends on them.
 */
@Injectable()
export class ReportRowSourceRegistry {
  private readonly sources = new Map<string, ReportRowSource>();

  register(key: string, source: ReportRowSource): void {
    this.sources.set(key, source);
  }

  get(key: string): ReportRowSource | undefined {
    return this.sources.get(key);
  }

  keys(): string[] {
    return [...this.sources.keys()];
  }
}
