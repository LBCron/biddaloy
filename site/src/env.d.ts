/// <reference types="astro/client" />
import type { Lang, SiteManifest, SitePageData } from './lib/types';

declare global {
  namespace App {
    interface Locals {
      host: string;
      lang: Lang;
      /** The manifest; absent on the 404/503 error pages. */
      site?: SiteManifest;
      /** Set when the preview header is present: the theme name being previewed. */
      preview?: string;
      /** `?preview=<token>`, forwarded to every API call. */
      previewToken?: string;
      /** Demo home page for a preview (no API call). */
      previewHome?: SitePageData;
      /** A blog post page sets this; the layout prints it as NewsArticle JSON-LD. */
      postLd?: Omit<import('./lib/seo').PostLd, 'author'>;
    }
  }
}
