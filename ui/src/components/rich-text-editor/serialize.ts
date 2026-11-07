import { isSiteRelativeHref } from '@biddaloy/shared';
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
 * Same rule the server applies to a link: http(s), or a `/`-relative path. Anything else
 * (`javascript:`, `data:`, `mailto:`, `//host`) is refused.
 */
export function isSafeHref(href: string): boolean {
  if (isSiteRelativeHref(href)) return true;
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function countImages(value: Descendant[]): number {
  const walk = (n: Descendant): number =>
    'text' in n ? 0 : (n.type === 'image' ? 1 : 0) + n.children.reduce((s, c) => s + walk(c), 0);
  return value.reduce((s, n) => s + walk(n), 0);
}

export const EMPTY_VALUE: Descendant[] = [{ type: 'paragraph', children: [{ text: '' }] }];
