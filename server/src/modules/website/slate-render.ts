import sanitizeHtml from 'sanitize-html';
import {
  SITE_POST_BODY_MAX_CHARS,
  SITE_POST_MAX_IMAGES,
  isSiteRelativeHref,
} from '@biddaloy/shared';

/**
 * [40.3.01] Blog body: Slate JSON in, sanitised HTML out (D18). Two steps, both here:
 * `checkSlate` is the save-time gate (fixed answer, never echoes input, Rule 23);
 * `renderSlate` builds HTML from the nodes we know and passes it through `sanitize-html`
 * with an explicit allowlist, so even a body stored before a rule changed cannot ship script.
 */

const BLOCKS: Record<string, string> = {
  paragraph: 'p',
  'heading-two': 'h2',
  'heading-three': 'h3',
  'bulleted-list': 'ul',
  'numbered-list': 'ol',
  'list-item': 'li',
  table: 'table',
  'table-row': 'tr',
  'table-cell': 'td',
  'block-quote': 'blockquote',
};
const MAX_DEPTH = 10;
const MAX_ALT_CHARS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** http(s) or a path on the school's own site. Anything else (javascript:, data:, //host) is refused. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string') return false;
  const tooLong = href.length > 500;
  if (isSiteRelativeHref(href)) return true;
  try {
    const u = new URL(href);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !tooLong;
  } catch {
    return false;
  }
}

export type SlateCheck = { ok: true; mediaIds: string[]; text: string } | { ok: false };

/** Walks the tree once: allowed types only, limits on text, images and depth. */
export function checkSlate(body: unknown): SlateCheck {
  if (!Array.isArray(body) || body.length === 0) return { ok: false };
  const mediaIds: string[] = [];
  let chars = 0;
  let text = '';
  const walk = (nodes: unknown, depth: number): boolean => {
    if (!Array.isArray(nodes) || depth > MAX_DEPTH) return false;
    for (const n of nodes) {
      if (!isObj(n)) return false;
      if (typeof n.text === 'string') {
        chars += n.text.length;
        text += n.text;
        if (chars > SITE_POST_BODY_MAX_CHARS) return false;
        continue;
      }
      const type = n.type;
      if (typeof type !== 'string') return false;
      if (type === 'image') {
        if (typeof n.mediaId !== 'string' || !UUID_RE.test(n.mediaId)) return false;
        if (typeof n.alt !== 'string' || n.alt.length > MAX_ALT_CHARS) return false;
        mediaIds.push(n.mediaId);
        if (mediaIds.length > SITE_POST_MAX_IMAGES) return false;
        continue;
      }
      if (type === 'link') {
        if (!isSafeHref(n.href)) return false;
      } else if (!(type in BLOCKS)) {
        return false;
      }
      if (!walk(n.children, depth + 1)) return false;
      text += ' ';
    }
    return true;
  };
  return walk(body, 0) ? { ok: true, mediaIds, text: text.trim() } : { ok: false };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function html(nodes: unknown, mediaUrl: (id: string) => string | undefined): string {
  if (!Array.isArray(nodes)) return '';
  return nodes
    .map((n): string => {
      if (!isObj(n)) return '';
      if (typeof n.text === 'string') {
        let t = esc(n.text);
        if (n.bold === true) t = `<strong>${t}</strong>`;
        if (n.italic === true) t = `<em>${t}</em>`;
        return t;
      }
      if (n.type === 'image') {
        const src = typeof n.mediaId === 'string' ? mediaUrl(n.mediaId) : undefined;
        return src
          ? `<img src="${esc(src)}" alt="${esc(String(n.alt ?? ''))}" loading="lazy">`
          : '';
      }
      const inner = html(n.children, mediaUrl);
      if (n.type === 'link') {
        // A bad href drops the link and keeps its words.
        return isSafeHref(n.href) ? `<a href="${esc(n.href)}">${inner}</a>` : inner;
      }
      const tag = typeof n.type === 'string' ? BLOCKS[n.type] : undefined;
      return tag ? `<${tag}>${inner}</${tag}>` : '';
    })
    .join('');
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'table',
    'tr',
    'td',
    'blockquote',
    'a',
    'img',
    'strong',
    'em',
  ],
  allowedAttributes: { a: ['href'], img: ['src', 'alt', 'loading'] },
  allowedSchemes: ['http', 'https'],
  allowProtocolRelative: false,
  // `/media/<id>` is a relative src: sanitize-html lets relative URLs through when no scheme.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
  },
};
// `rel` is added by the transform, so it must be allowed back through.
(SANITIZE.allowedAttributes as Record<string, string[]>).a.push('rel');

/** `mediaUrl` answers the public path of a picture id, or undefined to drop the image. */
export function renderSlate(body: unknown, mediaUrl: (id: string) => string | undefined): string {
  return sanitizeHtml(html(body, mediaUrl), SANITIZE);
}
