import { SiteMediaSlot } from '@biddaloy/shared';
import {
  BoldIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  Table2Icon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';
import { useSlate } from 'slate-react';

import { Button } from '../button';
import { ImageSlotUpload, type ImageSlotUploadLabels } from '../image-slot-upload';
import { Input } from '../input';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';

import {
  addTableColumn,
  addTableRow,
  deleteTable,
  inTable,
  insertImage,
  insertTable,
  isBlockActive,
  isMarkActive,
  setLink,
  toggleBlock,
  toggleMark,
  unwrapLink,
} from './commands';
import type { BlockType, ListType } from './types';

export interface RichTextEditorLabels {
  editor: string;
  toolbar: string;
  bold: string;
  italic: string;
  paragraph: string;
  heading2: string;
  heading3: string;
  bulleted: string;
  numbered: string;
  quote: string;
  table: string;
  addRow: string;
  addColumn: string;
  deleteTable: string;
  image: string;
  imageAlt: string;
  link: string;
  linkUrl: string;
  linkApply: string;
  linkRemove: string;
  /** Shown when the address is not http(s) or a `/` path. */
  linkInvalid: string;
  imageUpload: ImageSlotUploadLabels;
}

function ToolButton({
  label,
  pressed,
  disabled,
  onAction,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={`size-11 md:size-8 ${pressed ? 'bg-muted text-primary' : 'text-text-secondary'}`}
      // mousedown would blur the editor and lose the selection
      onMouseDown={(e) => e.preventDefault()}
      onClick={onAction}
    >
      {children}
    </Button>
  );
}

function LinkControl({ labels }: { labels: RichTextEditorLabels }) {
  const editor = useSlate();
  const [open, setOpen] = React.useState(false);
  const [href, setHref] = React.useState('');
  const [bad, setBad] = React.useState(false);
  const active = isBlockActive(editor, 'link');
  // the popover steals focus, so keep the selection to wrap when it closes
  const saved = React.useRef(editor.selection);
  const apply = () => {
    if (saved.current) editor.select(saved.current);
    if (!setLink(editor, href.trim())) {
      setBad(true);
      return;
    }
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          saved.current = editor.selection;
          setHref('');
          setBad(false);
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          aria-label={labels.link}
          title={labels.link}
          aria-pressed={active}
          className={`size-11 md:size-8 ${active ? 'bg-muted text-primary' : 'text-text-secondary'}`}
        >
          <LinkIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <Input
          aria-label={labels.linkUrl}
          placeholder="https://"
          inputMode="url"
          value={href}
          aria-invalid={bad || undefined}
          onChange={(e) => {
            setHref(e.target.value);
            setBad(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
        {bad ? (
          <p role="alert" className="text-sm text-destructive">
            {labels.linkInvalid}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" onClick={apply}>
            {labels.linkApply}
          </Button>
          {active ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                unwrapLink(editor);
                setOpen(false);
              }}
            >
              {labels.linkRemove}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ImageControl({
  labels,
  onUploadImage,
  disabled,
}: {
  labels: RichTextEditorLabels;
  onUploadImage: (blob: Blob) => Promise<{ mediaId: string }>;
  disabled: boolean;
}) {
  const editor = useSlate();
  const [open, setOpen] = React.useState(false);
  const [alt, setAlt] = React.useState('');
  const saved = React.useRef(editor.selection);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          saved.current = editor.selection;
          setAlt('');
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          aria-label={labels.image}
          title={labels.image}
          disabled={disabled}
          className="size-11 text-text-secondary md:size-8"
        >
          <ImageIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <Input
          aria-label={labels.imageAlt}
          placeholder={labels.imageAlt}
          value={alt}
          maxLength={200}
          onChange={(e) => setAlt(e.target.value)}
        />
        <ImageSlotUpload
          slot={SiteMediaSlot.POST_IMAGE}
          labels={labels.imageUpload}
          onUpload={async (blob) => {
            const { mediaId } = await onUploadImage(blob);
            if (saved.current) editor.select(saved.current);
            insertImage(editor, mediaId, alt.trim());
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function Toolbar({
  labels,
  onUploadImage,
  imageCapReached,
}: {
  labels: RichTextEditorLabels;
  onUploadImage: (blob: Blob) => Promise<{ mediaId: string }>;
  imageCapReached: boolean;
}) {
  const editor = useSlate();
  const table = inTable(editor);
  const block = (type: BlockType | ListType, label: string, icon: React.ReactNode) => (
    <ToolButton
      label={label}
      pressed={isBlockActive(editor, type)}
      disabled={table}
      onAction={() => toggleBlock(editor, type)}
    >
      {icon}
    </ToolButton>
  );
  return (
    <div
      role="toolbar"
      aria-label={labels.toolbar}
      className="flex flex-wrap items-center gap-0.5 border-b border-border-subtle p-1"
    >
      <ToolButton
        label={labels.bold}
        pressed={isMarkActive(editor, 'bold')}
        onAction={() => toggleMark(editor, 'bold')}
      >
        <BoldIcon aria-hidden />
      </ToolButton>
      <ToolButton
        label={labels.italic}
        pressed={isMarkActive(editor, 'italic')}
        onAction={() => toggleMark(editor, 'italic')}
      >
        <ItalicIcon aria-hidden />
      </ToolButton>
      {block('paragraph', labels.paragraph, <PilcrowIcon aria-hidden />)}
      {block('heading-two', labels.heading2, <Heading2Icon aria-hidden />)}
      {block('heading-three', labels.heading3, <Heading3Icon aria-hidden />)}
      {block('bulleted-list', labels.bulleted, <ListIcon aria-hidden />)}
      {block('numbered-list', labels.numbered, <ListOrderedIcon aria-hidden />)}
      {block('block-quote', labels.quote, <QuoteIcon aria-hidden />)}
      <ToolButton label={labels.table} disabled={table} onAction={() => insertTable(editor)}>
        <Table2Icon aria-hidden />
      </ToolButton>
      {table ? (
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => addTableRow(editor)}
            onMouseDown={(e) => e.preventDefault()}
          >
            {labels.addRow}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => addTableColumn(editor)}
            onMouseDown={(e) => e.preventDefault()}
          >
            {labels.addColumn}
          </Button>
          <ToolButton label={labels.deleteTable} onAction={() => deleteTable(editor)}>
            <Trash2Icon aria-hidden />
          </ToolButton>
        </>
      ) : null}
      <LinkControl labels={labels} />
      <ImageControl
        labels={labels}
        onUploadImage={onUploadImage}
        disabled={table || imageCapReached}
      />
    </div>
  );
}
