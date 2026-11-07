import { isSiteRelativeHref, SITE_HREF_MAX_CHARS } from '@biddaloy/shared';
import type { Descendant, Node } from 'slate';

/** Plain text of a Slate value: one line per block. Used for the counter and excerpts. */
export function toPlainText(value: Node[]): string {
  const walk = (n: Node): string => {
    if ('text' in n) return n.text;
    if (!('type' in n)) return n.children.map(walk).join('\n');
    if (n.type === 'image') return '';
    const parts = n.children.map(walk);
    return n.type === 'link' || n.type === 'list-item' || n.type === 'table-cell'
      ? parts.join('')
      : parts.join('\n');
  };
  return value.map(walk).join('\n');
}

/**
 * The link as it will be stored, or null when the server would refuse it: http(s) absolute
 * (stored as the browser-normalised `URL.href`) or a `/`-relative path, within
 * `SITE_HREF_MAX_CHARS`. Any space or control character in the raw input is refused, because the
 * URL parser silently strips tabs and newlines (`ht\ttps://x` would otherwise pass).
 */
export function normalizeHref(href: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return null;
  if (isSiteRelativeHref(href)) return href;
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href.length <= SITE_HREF_MAX_CHARS ? u.href : null;
  } catch {
    return null;
  }
}

export const isSafeHref = (href: string) => normalizeHref(href) !== null;

/** Drops image nodes past `allowed`, walking the fragment in document order. */
export function limitImages(fragment: Node[], allowed: number): Descendant[] {
  let left = allowed;
  const walk = (nodes: Node[]): Descendant[] =>
    nodes.flatMap((n): Descendant[] => {
      if ('text' in n) return [n];
      if (!('type' in n)) return walk(n.children);
      if (n.type === 'image') return left-- > 0 ? [n] : [];
      return [{ ...n, children: walk(n.children) } as Descendant];
    });
  return walk(fragment);
}

export function countImages(value: Node[]): number {
  const walk = (n: Node): number =>
    'text' in n
      ? 0
      : ('type' in n && n.type === 'image' ? 1 : 0) + n.children.reduce((s, c) => s + walk(c), 0);
  return value.reduce((s, n) => s + walk(n), 0);
}

export const EMPTY_VALUE: Descendant[] = [{ type: 'paragraph', children: [{ text: '' }] }];
