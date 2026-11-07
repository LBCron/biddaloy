import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Editor, Transforms } from 'slate';
import { describe, expect, it, vi } from 'vitest';

import { addTableColumn, addTableRow, insertTable, setLink, toggleBlock } from './commands';
import { RichTextEditor, createRichEditor, type RichTextEditorLabels } from './rich-text-editor';
import { countImages, EMPTY_VALUE, isSafeHref, toPlainText } from './serialize';
import type { RichTextValue } from './types';

vi.mock('../image-slot-upload', () => ({
  ImageSlotUpload: ({ onUpload }: { onUpload: (b: Blob) => void }) => (
    <button type="button" onClick={() => onUpload(new Blob(['x'], { type: 'image/webp' }))}>
      pick-image
    </button>
  ),
}));

const labels: RichTextEditorLabels = {
  editor: 'Post text',
  toolbar: 'Formatting',
  bold: 'Bold',
  italic: 'Italic',
  paragraph: 'Paragraph',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulleted: 'Bullets',
  numbered: 'Numbers',
  quote: 'Quote',
  table: 'Table',
  addRow: 'Add row',
  addColumn: 'Add column',
  deleteTable: 'Delete table',
  image: 'Image',
  imageAlt: 'Picture description',
  link: 'Link',
  linkUrl: 'Web address',
  linkApply: 'Add link',
  linkRemove: 'Remove link',
  linkInvalid: 'Use an http or https address.',
  imageUpload: {
    choose: 'c',
    zoom: 'z',
    save: 's',
    svgRefused: 'x',
    tooLarge: 'x',
    unreadable: 'x',
    pan: 'p',
  },
};

function fresh(max?: number) {
  const e = createRichEditor(max);
  e.children = structuredClone(EMPTY_VALUE);
  Transforms.select(e, Editor.start(e, []));
  return e;
}

describe('editor model', () => {
  it('typing produces paragraph JSON; heading toggles and back', () => {
    const e = fresh();
    e.insertText('Hello');
    expect(e.children).toEqual([{ type: 'paragraph', children: [{ text: 'Hello' }] }]);
    toggleBlock(e, 'heading-two');
    expect(e.children[0]).toMatchObject({ type: 'heading-two' });
    toggleBlock(e, 'heading-two');
    expect(e.children[0]).toMatchObject({ type: 'paragraph' });
  });

  it('bullets wrap in a list; second press unwraps', () => {
    const e = fresh();
    e.insertText('a');
    toggleBlock(e, 'bulleted-list');
    expect(e.children).toEqual([
      { type: 'bulleted-list', children: [{ type: 'list-item', children: [{ text: 'a' }] }] },
    ]);
    toggleBlock(e, 'bulleted-list');
    expect(e.children[0]).toMatchObject({ type: 'paragraph' });
  });

  it('inserts a 2x2 table, then a row and a column', () => {
    const e = fresh();
    insertTable(e);
    const table = e.children.find((n) => 'type' in n && n.type === 'table');
    expect(table && 'children' in table && table.children).toHaveLength(2);
    Transforms.select(e, Editor.start(e, [1, 0, 0]));
    addTableRow(e);
    addTableColumn(e);
    const t = e.children[1] as { children: { children: unknown[] }[] };
    expect(t.children).toHaveLength(3);
    expect(t.children.every((r) => r.children.length === 3)).toBe(true);
  });

  it('refuses javascript: and data: links, accepts https and relative', () => {
    const e = fresh();
    e.insertText('x');
    Transforms.select(e, Editor.range(e, []));
    expect(setLink(e, 'javascript:alert(1)')).toBe(false);
    expect(setLink(e, 'data:text/html,hi')).toBe(false);
    expect(setLink(e, 'mailto:a@b.c')).toBe(false);
    expect(JSON.stringify(e.children)).not.toContain('link');
    expect(setLink(e, 'https://example.com/a')).toBe(true);
    expect(JSON.stringify(e.children)).toContain('https://example.com/a');
    expect(isSafeHref('/notices')).toBe(true);
    expect(isSafeHref('//evil.com')).toBe(false);
  });

  it('turns an unknown node into a paragraph and drops an unsafe link', () => {
    const e = createRichEditor();
    e.children = [
      { type: 'script', children: [{ text: 'a' }] } as never,
      {
        type: 'paragraph',
        children: [{ type: 'link', href: 'javascript:1', children: [{ text: 'b' }] }],
      },
    ];
    Editor.normalize(e, { force: true });
    expect(e.children[0]).toMatchObject({ type: 'paragraph' });
    expect(JSON.stringify(e.children)).not.toContain('javascript');
    expect(toPlainText(e.children)).toBe('a\nb');
  });

  it('blocks input past the cap', () => {
    const e = fresh(5);
    e.insertText('abc');
    e.insertText('defg');
    expect(toPlainText(e.children)).toBe('abc');
    e.insertText('de');
    expect(toPlainText(e.children)).toBe('abcde');
    e.insertText('f');
    expect(toPlainText(e.children)).toBe('abcde');
  });

  it('counts images', () => {
    const v: RichTextValue = [
      { type: 'image', mediaId: 'm', alt: '', children: [{ text: '' }] },
      { type: 'paragraph', children: [{ text: 'x' }] },
    ];
    expect(countImages(v)).toBe(1);
  });
});

describe('RichTextEditor', () => {
  const setup = (onUploadImage = vi.fn(async () => ({ mediaId: 'm1' })), onChange = vi.fn()) => {
    render(
      <RichTextEditor
        value={structuredClone(EMPTY_VALUE)}
        onChange={onChange}
        onUploadImage={onUploadImage}
        lang="en"
        labels={labels}
      />,
    );
    return { onUploadImage, onChange };
  };

  it('renders an accessible toolbar, textbox and counter', () => {
    setup();
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Post text' })).toBeTruthy();
    expect(screen.getByText('0 / 20,000')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the counter in Bengali digits', () => {
    render(
      <RichTextEditor
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        onUploadImage={vi.fn()}
        lang="bn"
        labels={labels}
      />,
    );
    expect(screen.getByText('০ / ২০,০০০')).toBeTruthy();
  });

  it('image path calls onUploadImage', async () => {
    const { onUploadImage } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Image' }));
    await user.click(screen.getByText('pick-image'));
    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
  });

  it('link popover refuses javascript:', async () => {
    const { onChange } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByLabelText('Web address');
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert').textContent).toBe('Use an http or https address.');
    expect(onChange).not.toHaveBeenCalled();
  });
});
