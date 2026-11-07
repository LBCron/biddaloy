import { SITE_POST_MAX_IMAGES } from '@biddaloy/shared';
import { render, screen } from '@testing-library/react';
import { Editor, Transforms, type Descendant } from 'slate';
import { describe, expect, it } from 'vitest';

import { inList, insertImage, insertTable, setLink, toggleBlock } from './commands';
import { createRichEditor, RichTextEditor, type RichTextEditorLabels } from './rich-text-editor';
import { countImages, EMPTY_VALUE, normalizeHref, toPlainText } from './serialize';

const img = (i: number): Descendant => ({
  type: 'image',
  mediaId: `m${i}`,
  alt: '',
  children: [{ text: '' }],
});

function fresh() {
  const e = createRichEditor();
  e.children = structuredClone(EMPTY_VALUE);
  Transforms.select(e, Editor.start(e, []));
  return e;
}

describe('image cap and structure', () => {
  it('a pasted fragment of 12 images ends at the cap', () => {
    const e = fresh();
    e.insertFragment(Array.from({ length: 12 }, (_, i) => img(i)));
    expect(countImages(e.children)).toBe(SITE_POST_MAX_IMAGES);
  });

  it('counts images already in the document against the cap', () => {
    const e = fresh();
    e.insertFragment(Array.from({ length: 8 }, (_, i) => img(i)));
    Transforms.insertNodes(
      e,
      { type: 'paragraph', children: [{ text: '' }] },
      { at: [e.children.length], select: true },
    );
    e.insertFragment(Array.from({ length: 8 }, (_, i) => img(100 + i)));
    expect(countImages(e.children)).toBe(SITE_POST_MAX_IMAGES);
  });

  it('an image inside a list item is dropped, never nested', () => {
    const e = createRichEditor();
    e.children = [
      {
        type: 'bulleted-list',
        children: [{ type: 'list-item', children: [{ text: 'a' }, img(1) as never] }],
      },
    ];
    Editor.normalize(e, { force: true });
    expect(countImages(e.children)).toBe(0);
    expect(toPlainText(e.children)).toBe('a');
  });

  it('insertImage from inside a list item lands after the list, at top level', () => {
    const e = fresh();
    e.insertText('a');
    toggleBlock(e, 'bulleted-list');
    expect(inList(e)).toBe(true); // the toolbar disables the image button on this
    insertImage(e, 'm1', 'alt');
    expect(e.children.map((n) => ('type' in n ? n.type : ''))).toEqual([
      'bulleted-list',
      'image',
      'paragraph',
    ]);
  });
});

describe('links', () => {
  it('stores the normalised URL and refuses whitespace tricks and long input', () => {
    expect(normalizeHref('HTTPS://Example.com')).toBe('https://example.com/');
    expect(normalizeHref('ht\ttps://x.com')).toBeNull();
    expect(normalizeHref('https://x.com/a b')).toBeNull();
    expect(normalizeHref(`https://x.com/${'a'.repeat(500)}`)).toBeNull();
    const e = fresh();
    e.insertText('x');
    Transforms.select(e, Editor.range(e, []));
    expect(setLink(e, 'ht\ttps://x.com')).toBe(false);
    expect(setLink(e, 'HTTPS://Example.com')).toBe(true);
    expect(JSON.stringify(e.children)).toContain('https://example.com/');
  });
});

describe('lists and tables', () => {
  it('Enter on an empty list item leaves the list', () => {
    const e = fresh();
    e.insertText('a');
    toggleBlock(e, 'bulleted-list');
    e.insertBreak();
    expect(toPlainText(e.children)).toBe('a\n');
    expect(JSON.stringify(e.children)).toContain('list-item');
    e.insertBreak();
    expect(e.children[e.children.length - 1]).toMatchObject({ type: 'paragraph' });
    expect(e.children).toHaveLength(2);
  });

  it('a selection across two cells cannot be deleted, typed over or pasted over', () => {
    const e = fresh();
    insertTable(e);
    Transforms.select(e, Editor.start(e, [1, 0, 0]));
    e.insertText('a');
    Transforms.select(e, Editor.start(e, [1, 0, 1]));
    e.insertText('b');
    Transforms.select(e, {
      anchor: Editor.start(e, [1, 0, 0]),
      focus: Editor.end(e, [1, 0, 1]),
    });
    const before = JSON.stringify(e.children);
    e.deleteFragment();
    e.insertText('z');
    e.insertFragment([{ type: 'paragraph', children: [{ text: 'z' }] }]);
    expect(JSON.stringify(e.children)).toBe(before);
  });
});

const labels = {
  editor: 'Post text',
  toolbar: 'Formatting',
  image: 'Image',
  imageUpload: {},
} as unknown as RichTextEditorLabels;

describe('toolbar and counter', () => {
  it('the counter is a polite live region', () => {
    render(
      <RichTextEditor
        value={structuredClone(EMPTY_VALUE)}
        onChange={() => {}}
        onUploadImage={() => Promise.resolve({ mediaId: 'm' })}
        lang="en"
        labels={labels}
      />,
    );
    expect(screen.getByText('0 / 20,000').getAttribute('aria-live')).toBe('polite');
  });
});
