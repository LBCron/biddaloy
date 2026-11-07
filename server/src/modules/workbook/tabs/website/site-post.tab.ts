import { SitePost } from '../../../website/entities/site-post.entity';
import { createRefChildTab } from '../people/ref-child-tab.factory';

/**
 * [40.1.08] `site_posts`: blog posts and pages of the school website. The cover picture is not
 * in the workbook (the files live in the storage backup), so a restored post has no cover.
 */
export const sitePostsTab = createRefChildTab<SitePost>({
  name: 'site_posts',
  entityClass: SitePost,
  refs: [],
  fields: [
    {
      key: 'kind',
      type: 'enum',
      enumValues: ['POST', 'PAGE'],
      required: true,
      label: { en: 'Kind', bn: 'ধরন' },
    },
    { key: 'slug', type: 'string', required: true, label: { en: 'Slug', bn: 'ঠিকানার অংশ' } },
    { key: 'title', type: 'json', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
    { key: 'body', type: 'json', required: true, label: { en: 'Body', bn: 'লেখা' } },
    { key: 'published_at', type: 'datetime', label: { en: 'Published at', bn: 'প্রকাশের সময়' } },
  ],
  checkRow: (row) => {
    if (typeof row.slug !== 'string' || row.slug.length > 80)
      return { column: 'slug', message: 'Slug must be text of at most 80 characters' };
    const t = row.title;
    if (
      typeof t !== 'object' ||
      t === null ||
      Array.isArray(t) ||
      !Object.values(t).every((v) => typeof v === 'string')
    )
      return { column: 'title', message: 'Title must be an object of text per language' };
    return null;
  },
  naturalKey: ['slug'],
  excluded: ['cover_media_id'], // the picture is a file in storage, not a workbook row
});
