import type { SiteIslandKind, SiteSectionKey } from '@biddaloy/shared';

export type FeedKind = SiteIslandKind | SiteSectionKey;
export type FeedLoader = (tenantId: string, params: Record<string, string>) => Promise<unknown>;

const feeds = new Map<string, FeedLoader>();

/** A feed registers itself once (later waves add events, results...). Last one wins. */
export function registerFeed(kind: FeedKind, loader: FeedLoader): void {
  feeds.set(kind, loader);
}

export function hasFeed(kind: string): boolean {
  return feeds.has(kind);
}

export async function loadFeed(
  kind: string,
  tenantId: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const loader = feeds.get(kind);
  if (!loader) throw new Error('feed.unregistered');
  return loader(tenantId, params);
}
