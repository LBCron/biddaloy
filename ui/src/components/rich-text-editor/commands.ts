/**
 * Editor commands. Only the node types in `types.ts` can be produced here.
 */
import { Editor, Element, Node, Path, Range, Transforms, type Descendant } from 'slate';

import { normalizeHref } from './serialize';
import type { BlockType, ImageNode, ListType } from './types';

const LISTS: readonly string[] = ['bulleted-list', 'numbered-list'];

const isEl = (n: Node): n is Element => Element.isElement(n);

export function findAbove(editor: Editor, type: string) {
  return Editor.above(editor, { match: (n) => isEl(n) && n.type === type });
}

/** True when any part of the selection is in a table, not only a table around its start. */
export const inTable = (editor: Editor) =>
  !!editor.selection &&
  Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, editor.selection),
      match: (n) => isEl(n) && n.type === 'table',
    }),
  ).length > 0;

export function isBlockActive(editor: Editor, type: string): boolean {
  const { selection } = editor;
  if (!selection) return false;
  const [match] = Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, selection),
      match: (n) => isEl(n) && n.type === type,
    }),
  );
  return !!match;
}

export function isMarkActive(editor: Editor, mark: 'bold' | 'italic'): boolean {
  return !!Editor.marks(editor)?.[mark];
}

export function toggleMark(editor: Editor, mark: 'bold' | 'italic') {
  if (isMarkActive(editor, mark)) Editor.removeMark(editor, mark);
  else Editor.addMark(editor, mark, true);
}

/** Paragraph, headings, quote and the two lists. A second press goes back to a paragraph. */
export function toggleBlock(editor: Editor, type: BlockType | ListType) {
  if (inTable(editor)) return;
  const isList = LISTS.includes(type);
  const active = isBlockActive(editor, type);
  Transforms.unwrapNodes(editor, {
    match: (n) => isEl(n) && LISTS.includes(n.type),
    split: true,
  });
  const next = active ? 'paragraph' : isList ? 'list-item' : type;
  Transforms.setNodes(editor, { type: next } as never, {
    match: (n) => isEl(n) && Editor.isBlock(editor, n) && n.type !== 'image',
  });
  if (!active && isList) Transforms.wrapNodes(editor, { type, children: [] });
}

const cell = (): Element => ({ type: 'table-cell', children: [{ text: '' }] });
const row = (n: number): Element => ({
  type: 'table-row',
  children: Array.from({ length: n }, cell),
});

export function insertTable(editor: Editor) {
  if (inTable(editor)) return;
  // After the top-level block the cursor is in, so the table never lands inside a list.
  const top = editor.selection?.anchor.path[0];
  const at = top === undefined ? [editor.children.length] : [top + 1];
  Transforms.insertNodes(
    editor,
    [
      { type: 'table', children: [row(2), row(2)] },
      { type: 'paragraph', children: [{ text: '' }] },
    ],
    { at, select: true },
  );
}

export function addTableRow(editor: Editor) {
  const r = findAbove(editor, 'table-row');
  if (!r) return;
  Transforms.insertNodes(editor, row(r[0].children.length), { at: Path.next(r[1]) });
}

export function addTableColumn(editor: Editor) {
  const c = findAbove(editor, 'table-cell');
  const t = findAbove(editor, 'table');
  if (!c || !t) return;
  const at = (c[1][c[1].length - 1] ?? 0) + 1;
  for (let i = t[0].children.length - 1; i >= 0; i--) {
    Transforms.insertNodes(editor, cell(), { at: [...t[1], i, at] });
  }
}

export function deleteTable(editor: Editor) {
  const t = findAbove(editor, 'table');
  if (t) Transforms.removeNodes(editor, { at: t[1] });
}

/** False (and nothing inserted) when the link is not one the server accepts. */
export function setLink(editor: Editor, raw: string): boolean {
  const href = normalizeHref(raw);
  if (!href) return false;
  const { selection } = editor;
  const current = selection && Range.isCollapsed(selection) ? findAbove(editor, 'link') : undefined;
  if (current) {
    Transforms.setNodes(editor, { href } as never, { at: current[1] });
    return true;
  }
  unwrapLink(editor);
  if (selection && !Range.isCollapsed(selection)) {
    Transforms.wrapNodes(editor, { type: 'link', href, children: [] }, { split: true });
  } else {
    Transforms.insertNodes(editor, { type: 'link', href, children: [{ text: href }] });
  }
  return true;
}

export function unwrapLink(editor: Editor) {
  Transforms.unwrapNodes(editor, { match: (n) => isEl(n) && n.type === 'link' });
}

export const inList = (editor: Editor) => !!findAbove(editor, 'list-item');

/** After the top-level block the cursor is in, so it never lands inside a list item or cell. */
export function insertImage(editor: Editor, mediaId: string, alt: string) {
  const img: ImageNode = { type: 'image', mediaId, alt, children: [{ text: '' }] };
  const top = editor.selection?.anchor.path[0];
  const at = top === undefined ? [editor.children.length] : [top + 1];
  Transforms.insertNodes(
    editor,
    [img as Descendant, { type: 'paragraph', children: [{ text: '' }] }],
    { at, select: true },
  );
}

/** Backspace on an empty list item leaves the list. Returns true when it handled the key. */
export function exitEmptyListItem(editor: Editor): boolean {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return false;
  const item = findAbove(editor, 'list-item');
  if (!item || Node.string(item[0]) !== '') return false;
  const list = Editor.parent(editor, item[1])[0];
  if (!isEl(list)) return false;
  toggleBlock(editor, list.type as ListType);
  return true;
}
