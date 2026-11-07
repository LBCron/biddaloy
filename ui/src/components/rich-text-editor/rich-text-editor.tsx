/**
 * [40.3.03] Rich text for blog posts and pages (Slate). Allows exactly the node types in
 * `types.ts`; anything else (pasted or restored from old data) is turned into a paragraph, and a
 * link the server would refuse is unwrapped. Plain `Editable`, no raw HTML anywhere: the server
 * re-validates and renders the JSON itself. Texts are props, like `ChoiceCards`.
 *
 * ponytail: the toolbar is a row of Tab stops, not a roving-focus `role="toolbar"`; arrow-key
 * roving is a later pass if a screen-reader test asks for it.
 *
 * Import from `@biddaloy/ui/rich-text-editor` and `React.lazy` it: Slate is heavy and is kept out
 * of the `components` barrel so it does not land in every importer's entry chunk.
 */
import { SITE_POST_BODY_MAX_CHARS, SITE_POST_MAX_IMAGES } from '@biddaloy/shared';
import * as React from 'react';
import { createEditor, Editor, Element, Path, Range, Transforms, type Point } from 'slate';
import { withHistory } from 'slate-history';
import { Editable, Slate, withReact } from 'slate-react';

import { cn } from '../../primitives/lib/utils';

import { exitEmptyListItem, findAbove, toggleMark } from './commands';
import { makeRenderElement, renderLeaf } from './elements';
import { countImages, isSafeHref, limitImages, toPlainText } from './serialize';
import { Toolbar, type RichTextEditorLabels } from './toolbar';
import { ELEMENT_TYPES, type RichTextValue } from './types';

export type { RichTextEditorLabels } from './toolbar';

export function createRichEditor(maxChars = SITE_POST_BODY_MAX_CHARS) {
  const e = withHistory(withReact(createEditor()));
  const { isInline, isVoid, normalizeNode, insertText, insertFragment, insertBreak } = e;
  const { deleteBackward, deleteForward, deleteFragment } = e;

  e.isInline = (el) => el.type === 'link' || isInline(el);
  e.isVoid = (el) => el.type === 'image' || isVoid(el);

  e.normalizeNode = (entry) => {
    const [node, path] = entry;
    if (Element.isElement(node)) {
      if (!ELEMENT_TYPES.has(node.type)) {
        Transforms.setNodes(e, { type: 'paragraph' }, { at: path });
        return;
      }
      if (node.type === 'link' && !isSafeHref(node.href)) {
        Transforms.unwrapNodes(e, { at: path });
        return;
      }
      // An image is a top-level block. Inside a list item, cell or quote it would put a block
      // in an inline-only parent, so it is dropped (ponytail: dropped, not lifted).
      if (node.type === 'image' && path.length > 1) {
        Transforms.removeNodes(e, { at: path });
        return;
      }
    }
    normalizeNode(entry);
  };

  // ponytail: typing over a selection counts the selected text too, so the cap bites a little
  // early; exact replace-accounting if anyone notices.
  const room = () => maxChars - toPlainText(e.children).length;

  const cellAt = (point: Point) =>
    Editor.above(e, { at: point, match: (n) => Element.isElement(n) && n.type === 'table-cell' });
  /** A selection that starts or ends in a table cell and does not stay inside that one cell. */
  const spansCells = () => {
    const { selection } = e;
    if (!selection || Range.isCollapsed(selection)) return false;
    const a = cellAt(selection.anchor);
    const f = cellAt(selection.focus);
    if (!a && !f) return false;
    return !a || !f || !Path.equals(a[1], f[1]);
  };

  e.insertText = (text, options) => {
    if (text.length > room() || spansCells()) return;
    insertText(text, options);
  };
  e.insertFragment = (fragment, options) => {
    if (spansCells()) return;
    const images = SITE_POST_MAX_IMAGES - countImages(e.children);
    const safe = limitImages(fragment, Math.max(0, images));
    if (toPlainText(safe).length > room()) return;
    insertFragment(safe, options);
  };
  e.deleteFragment = (...args) => {
    if (spansCells()) return;
    deleteFragment(...args);
  };

  // A table cell is one line, and Backspace/Delete at its edge must not merge cells.
  e.insertBreak = (...args) => {
    if (findAbove(e, 'table-cell')) return;
    if (exitEmptyListItem(e)) return;
    insertBreak(...args);
  };
  const edgeGuard = (edge: 'start' | 'end', fn: typeof deleteBackward) =>
    ((unit) => {
      const { selection } = e;
      if (selection && Range.isCollapsed(selection)) {
        const cell = findAbove(e, 'table-cell');
        const at = edge === 'start' ? Editor.isStart : Editor.isEnd;
        if (cell && at(e, selection.anchor, cell[1])) return;
      }
      fn(unit);
    }) as typeof deleteBackward;
  e.deleteBackward = edgeGuard('start', deleteBackward);
  e.deleteForward = edgeGuard('end', deleteForward);
  return e;
}

export interface RichTextEditorProps {
  value: RichTextValue;
  onChange: (value: RichTextValue) => void;
  /** Receives the cropped blob; resolves with the stored media id. */
  onUploadImage: (blob: Blob) => Promise<{ mediaId: string }>;
  /** Picture for a stored media id. Without it an image shows as a labelled box. */
  imageUrl?: (mediaId: string) => string | undefined;
  lang: 'bn' | 'en';
  labels: RichTextEditorLabels;
  maxChars?: number;
  disabled?: boolean;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  onUploadImage,
  imageUrl,
  lang,
  labels,
  maxChars = SITE_POST_BODY_MAX_CHARS,
  disabled,
  className,
}: RichTextEditorProps) {
  const editor = React.useMemo(() => createRichEditor(maxChars), [maxChars]);
  const RenderElement = React.useMemo(() => makeRenderElement(imageUrl), [imageUrl]);
  const [used, setUsed] = React.useState(() => toPlainText(value).length);
  const [images, setImages] = React.useState(() => countImages(value));
  const nf = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US');

  return (
    <div
      lang={lang}
      className={cn(
        'rounded-lg border border-border-subtle bg-card focus-within:ring-2 focus-within:ring-primary',
        className,
      )}
    >
      <Slate
        editor={editor}
        initialValue={value}
        onChange={(next) => {
          setUsed(toPlainText(next).length);
          setImages(countImages(next));
          if (editor.operations.some((op) => op.type !== 'set_selection')) onChange(next);
        }}
      >
        {disabled ? null : (
          <Toolbar
            labels={labels}
            onUploadImage={onUploadImage}
            imageCapReached={images >= SITE_POST_MAX_IMAGES}
          />
        )}
        <Editable
          readOnly={disabled}
          aria-label={labels.editor}
          aria-multiline
          renderElement={RenderElement}
          renderLeaf={renderLeaf}
          className="min-h-48 p-3 text-body outline-none"
          onKeyDown={(e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'b') {
              e.preventDefault();
              toggleMark(editor, 'bold');
            } else if (mod && e.key.toLowerCase() === 'i') {
              e.preventDefault();
              toggleMark(editor, 'italic');
            } else if (e.key === 'Backspace' && exitEmptyListItem(editor)) {
              e.preventDefault();
            }
          }}
        />
      </Slate>
      <p
        aria-live="polite"
        className="border-t border-border-subtle px-3 py-1 text-end text-sm text-text-secondary"
      >
        {nf.format(used)} / {nf.format(maxChars)}
      </p>
    </div>
  );
}
