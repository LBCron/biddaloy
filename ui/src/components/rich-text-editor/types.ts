/**
 * [40.3.03] The Slate JSON the server validates (`slate-render.ts`, #3628): exactly these node
 * types, nothing else. Marks are bold/italic only.
 */
import type { BaseEditor, Descendant } from 'slate';
import type { HistoryEditor } from 'slate-history';
import type { ReactEditor } from 'slate-react';

export type TextNode = { text: string; bold?: boolean; italic?: boolean };
export type LinkNode = { type: 'link'; href: string; children: TextNode[] };
export type ImageNode = { type: 'image'; mediaId: string; alt: string; children: TextNode[] };
type Inline = TextNode | LinkNode;
export type BlockType = 'paragraph' | 'heading-two' | 'heading-three' | 'block-quote';
export type ListType = 'bulleted-list' | 'numbered-list';

export type SlateElement =
  | { type: BlockType; children: Inline[] }
  | { type: ListType; children: SlateElement[] }
  | { type: 'list-item'; children: Inline[] }
  | { type: 'table'; children: SlateElement[] }
  | { type: 'table-row'; children: SlateElement[] }
  | { type: 'table-cell'; children: Inline[] }
  | ImageNode
  | LinkNode;

export const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading-two',
  'heading-three',
  'block-quote',
  'bulleted-list',
  'numbered-list',
  'list-item',
  'table',
  'table-row',
  'table-cell',
  'image',
  'link',
]);

export type RichTextValue = Descendant[];

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: SlateElement;
    Text: TextNode;
  }
}
