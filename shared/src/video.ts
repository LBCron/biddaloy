import type { BilingualText } from './presets/pack.types';

/** What the `video` entry in `SiteConfig.sections[].data` holds (D55–D58). */
export interface SiteVideoSectionData {
  heading: BilingualText;
  headingPosition: 'above' | 'below';
  videoId: string | null;
  startSeconds: number | null;
}

export const SITE_VIDEO_START_MAX_SECONDS = 86400;
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
]);

/** The URL inside an iframe embed code, or the pasted text itself. Null if it is not an allowed host. */
function youtubeUrl(input: string): URL | null {
  let text = input.trim();
  if (/^<iframe[\s>]/i.test(text)) {
    const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(text);
    // YouTube's embed code writes the query as `&amp;`; read it as `&` so `start=` survives.
    text = (m?.[1] ?? m?.[2] ?? '').replace(/&amp;/gi, '&').trim();
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return HOSTS.has(url.hostname) ? url : null;
}

/**
 * The 11-character id of a YouTube video from a pasted embed code or link, else null. Nothing else
 * from the pasted text is returned, so a foreign iframe or script can never reach the database.
 */
export function parseYoutubeVideoId(input: string): string | null {
  const url = youtubeUrl(input);
  if (!url) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (url.hostname === 'youtu.be') id = parts[0];
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (parts[0] === 'embed' || parts[0] === 'shorts') id = parts[1];
  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

/** `start=` or `t=` (`90`, `1m30s`) as whole seconds, capped at 86400; null when absent or unreadable. */
export function parseYoutubeStartSeconds(input: string): number | null {
  const url = youtubeUrl(input);
  const raw = url?.searchParams.get('start') ?? url?.searchParams.get('t');
  if (!raw) return null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return Math.min(secs, SITE_VIDEO_START_MAX_SECONDS);
}
