import { Injectable } from '@nestjs/common';
import { SiteCacheService } from '../site-cache.service';
import { ClassSectionsFeed } from './class-sections.feed';
import { BlogFeed } from './blog.feed';
import { AdmissionsFeed } from './admissions.feed';
import { EventsFeed } from './events.feed';
import { FeesFeed } from './fees.feed';
import { NoticesFeed } from './notices.feed';
import { RoutineFeed } from './routine.feed';
import { TeachersFeed } from './teachers.feed';

export type FeedRow = Record<string, unknown>;
export interface FeedOpts {
  /** teachers: cap the list (the homepage shows the first 8, D27). */
  limit?: number;
  /** routine: the class section whose published routine is shown. */
  classSectionId?: string;
}
export interface Feed {
  load(tenantId: string, opts?: FeedOpts): Promise<FeedRow[]>;
}

/** Every feed the site can read. One registry, one 60 s cache per kind (D21, D32). */
export type FeedKind =
  'notices' | 'events' | 'routine' | 'teachers' | 'blog' | 'fees' | 'admissions' | 'sections';

/**
 * `kind -> provider(tenantId, opts)`. Reads go through `cached`, which never depends on the
 * site `version`: a notice ticked public shows within 60 s without publishing the site. Redis
 * down: the provider runs, the page is still served (fail-open, D42).
 */
@Injectable()
export class FeedRegistry {
  private readonly feeds: Record<FeedKind, Feed>;

  constructor(
    private readonly cache: SiteCacheService,
    notices: NoticesFeed,
    events: EventsFeed,
    routine: RoutineFeed,
    teachers: TeachersFeed,
    private readonly blog: BlogFeed,
    fees: FeesFeed,
    admissions: AdmissionsFeed,
    sections: ClassSectionsFeed,
  ) {
    this.feeds = { notices, events, routine, teachers, blog, fees, admissions, sections };
  }

  /** One published post by slug, not cached (an older post is rare; one indexed read). */
  blogPost(tenantId: string, slug: string): Promise<FeedRow | null> {
    return this.blog.one(tenantId, slug);
  }

  has(kind: string): kind is FeedKind {
    return Object.prototype.hasOwnProperty.call(this.feeds, kind);
  }

  /** The cache key carries the options that change the answer, so two answers never share one. */
  private keyFor(kind: FeedKind, opts: FeedOpts): string {
    if (kind === 'teachers' && opts.limit !== undefined) return 'teachers:home';
    if (kind === 'routine') return `routine:${opts.classSectionId ?? ''}`;
    return kind;
  }

  cached(kind: FeedKind, tenantId: string, opts: FeedOpts = {}): Promise<FeedRow[]> {
    return this.cache.getOrLoadFeed(tenantId, this.keyFor(kind, opts), () =>
      this.feeds[kind].load(tenantId, opts),
    );
  }
}
