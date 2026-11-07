import { Injectable } from '@nestjs/common';
import { WebsiteResultsService } from '../../../exams/website-results.service';
import type { Feed } from './feed-registry';

/**
 * The exams on the website with their classes and sections: the first HTML of the results page.
 * Never read through the feed cache (see `FeedRegistry.live`): withdrawing an exam must hide
 * it on the next request.
 */
@Injectable()
export class ResultsFeed implements Feed {
  constructor(private readonly results: WebsiteResultsService) {}

  load(tenantId: string) {
    return this.results.listPublished(tenantId) as Promise<Record<string, unknown>[]>;
  }
}
