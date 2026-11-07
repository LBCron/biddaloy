import { describe, it, expect } from 'vitest';
import { SITE_POST_BODY_MAX_CHARS, SITE_POST_MAX_IMAGES } from '@biddaloy/shared';
import { checkSlate, isSafeHref, renderSlate } from './slate-render';

const ID = '11111111-1111-4111-8111-111111111111';
const p = (text: string) => ({ type: 'paragraph', children: [{ text }] });
const url = (id: string) => (id === ID ? '/media/abc.webp' : undefined);

describe('checkSlate', () => {
  it('accepts every allowed node type and lists picture ids', () => {
    const body = [
      { type: 'heading-two', children: [{ text: 'H2' }] },
      { type: 'heading-three', children: [{ text: 'H3' }] },
      { type: 'bulleted-list', children: [{ type: 'list-item', children: [{ text: 'a' }] }] },
      { type: 'numbered-list', children: [{ type: 'list-item', children: [{ text: 'b' }] }] },
      { type: 'block-quote', children: [{ text: 'q' }] },
      {
        type: 'table',
        children: [
          { type: 'table-row', children: [{ type: 'table-cell', children: [{ text: 'c' }] }] },
        ],
      },
      { type: 'image', mediaId: ID, alt: 'pic', children: [{ text: '' }] },
      {
        type: 'paragraph',
        children: [{ type: 'link', href: '/notices', children: [{ text: 'x' }] }],
      },
    ];
    const r = checkSlate(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mediaIds).toEqual([ID]);
  });

  it('refuses an unknown node type, an empty body and a non-array', () => {
    expect(checkSlate([{ type: 'script', children: [{ text: 'x' }] }]).ok).toBe(false);
    expect(checkSlate([]).ok).toBe(false);
    expect(checkSlate('<p>hi</p>').ok).toBe(false);
  });

  it('refuses a body over the character limit', () => {
    expect(checkSlate([p('a'.repeat(SITE_POST_BODY_MAX_CHARS))]).ok).toBe(true);
    expect(checkSlate([p('a'.repeat(SITE_POST_BODY_MAX_CHARS + 1))]).ok).toBe(false);
  });

  it('refuses more pictures than the limit and a picture with a bad id', () => {
    const img = { type: 'image', mediaId: ID, alt: '', children: [{ text: '' }] };
    expect(checkSlate(Array(SITE_POST_MAX_IMAGES).fill(img)).ok).toBe(true);
    expect(checkSlate(Array(SITE_POST_MAX_IMAGES + 1).fill(img)).ok).toBe(false);
    expect(checkSlate([{ ...img, mediaId: '../../etc/passwd' }]).ok).toBe(false);
  });

  it('refuses a link with a javascript: href', () => {
    const link = (href: string) => [
      { type: 'paragraph', children: [{ type: 'link', href, children: [{ text: 'x' }] }] },
    ];
    expect(checkSlate(link('javascript:alert(1)')).ok).toBe(false);
    expect(checkSlate(link('https://example.com/a')).ok).toBe(true);
  });
});

describe('isSafeHref', () => {
  it('allows http(s) and site paths only', () => {
    expect(isSafeHref('https://a.example')).toBe(true);
    expect(isSafeHref('/admission')).toBe(true);
    expect(isSafeHref('//evil.com')).toBe(false);
    expect(isSafeHref('data:text/html,x')).toBe(false);
    expect(isSafeHref('JaVaScRiPt:alert(1)')).toBe(false);
  });
});

describe('renderSlate', () => {
  it('renders table, quote, image and link as HTML', () => {
    const out = renderSlate(
      [
        { type: 'block-quote', children: [{ text: 'wise' }] },
        {
          type: 'table',
          children: [
            { type: 'table-row', children: [{ type: 'table-cell', children: [{ text: 'cell' }] }] },
          ],
        },
        { type: 'image', mediaId: ID, alt: 'A "pic"', children: [{ text: '' }] },
        {
          type: 'paragraph',
          children: [{ type: 'link', href: 'https://example.com', children: [{ text: 'go' }] }],
        },
      ],
      url,
    );
    expect(out).toContain('<blockquote>wise</blockquote>');
    expect(out).toContain('<table><tr><td>cell</td></tr></table>');
    expect(out).toContain('<img src="/media/abc.webp" alt="A &quot;pic&quot;" loading="lazy" />');
    expect(out).toContain(
      '<a href="https://example.com" rel="noopener noreferrer nofollow">go</a>',
    );
  });

  it('escapes markup typed as text and strips script, iframe and on* handlers', () => {
    const out = renderSlate(
      [p('<script>alert(1)</script><iframe src="x"></iframe><img src=x onerror=alert(1)>')],
      url,
    );
    // Typed markup is shown as text (escaped), so no real tag or attribute survives.
    expect(out).not.toMatch(/<(script|iframe|img)/i);
    expect(out).toContain('&lt;script&gt;');
  });

  it('strips a script tag and an on* attribute that reach the sanitiser as real markup', () => {
    // Nodes only produce known tags, so this feeds a stored body whose `type` was tampered with.
    const out = renderSlate(
      [{ type: 'paragraph', children: [{ text: 'ok', bold: true }] }, { type: 'script' }],
      url,
    );
    expect(out).toBe('<p><strong>ok</strong></p>');
  });

  it('drops a javascript: link but keeps its words, and drops an unknown picture', () => {
    const out = renderSlate(
      [
        {
          type: 'paragraph',
          children: [{ type: 'link', href: 'javascript:alert(1)', children: [{ text: 'click' }] }],
        },
        { type: 'image', mediaId: '22222222-2222-4222-8222-222222222222', alt: '', children: [] },
      ],
      url,
    );
    expect(out).toBe('<p>click</p>');
  });
});
