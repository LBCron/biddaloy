import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { checkSlate, renderSlate } from '../../slate-render';
import type { Feed, FeedRow } from './feed-registry';

const EXCERPT_CHARS = 160;
const mediaPath = (id: string) => `/media/${id}`;

/**
 * Published blog posts (kind POST), newest first: slug, title, cover id, a 160-character plain
 * text excerpt and the body as sanitised HTML (what the post page prints). Pages (kind PAGE) are
 * not in the blog list.
 * ponytail: the HTML of the 12 newest rides in the list (20k chars at most each); add a one-post
 * read when the list gets heavy.
 */
@Injectable()
export class BlogFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const rows: {
      id: string;
      slug: string;
      title: Record<string, string>;
      cover_media_id: string | null;
      body: unknown;
      published_at: Date;
    }[] = await this.ds.query(
      `SELECT id, slug, title, cover_media_id, body, published_at
         FROM site_posts
        WHERE tenant_id = $1 AND kind = 'POST'
          AND published_at IS NOT NULL AND published_at <= now()
        ORDER BY published_at DESC, id
        LIMIT 12`,
      [tenantId],
    );
    return rows.map((r) => {
      const checked = checkSlate(r.body);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        cover: r.cover_media_id,
        publishedAt: new Date(r.published_at).toISOString(),
        excerpt: checked.ok ? checked.text.replace(/\s+/g, ' ').slice(0, EXCERPT_CHARS) : '',
        html: renderSlate(r.body, mediaPath),
      };
    });
  }
}
