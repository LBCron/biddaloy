import type { TabSpec } from '../../codec/tab-spec';
import { schoolSiteTab } from './school-site.tab';
import { siteGalleryAlbumsTab } from './site-gallery-album.tab';
import { siteEnquiriesTab } from './site-enquiry.tab';
import { sitePostsTab } from './site-post.tab';
import { staffWebProfilesTab } from './staff-web-profile.tab';

/** [40.1.08] Epic 40 school website. `site_media` is not a tab: its files are in the storage backup. */
export const websiteTabs: TabSpec<any, any>[] = [
  schoolSiteTab,
  sitePostsTab,
  siteEnquiriesTab,
  staffWebProfilesTab,
  siteGalleryAlbumsTab,
];

export { schoolSiteTab, sitePostsTab, siteEnquiriesTab, staffWebProfilesTab, siteGalleryAlbumsTab };
