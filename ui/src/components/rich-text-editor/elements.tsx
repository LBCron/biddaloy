import { ImageIcon } from 'lucide-react';
import type { RenderElementProps, RenderLeafProps } from 'slate-react';

export function renderLeaf({ attributes, children, leaf }: RenderLeafProps) {
  let out = children;
  if (leaf.bold) out = <strong>{out}</strong>;
  if (leaf.italic) out = <em>{out}</em>;
  return <span {...attributes}>{out}</span>;
}

/** `imageUrl` turns a stored media id into a picture; without it a labelled box stands in. */
export function makeRenderElement(imageUrl?: (mediaId: string) => string | undefined) {
  return function RenderElement({ attributes, children, element }: RenderElementProps) {
    switch (element.type) {
      case 'heading-two':
        return (
          <h2 {...attributes} className="mt-4 mb-2 text-h2">
            {children}
          </h2>
        );
      case 'heading-three':
        return (
          <h3 {...attributes} className="mt-3 mb-2 text-h3">
            {children}
          </h3>
        );
      case 'block-quote':
        return (
          <blockquote
            {...attributes}
            className="my-2 border-s-4 border-border-functional ps-3 text-text-secondary"
          >
            {children}
          </blockquote>
        );
      case 'bulleted-list':
        return (
          <ul {...attributes} className="my-2 list-disc ps-6">
            {children}
          </ul>
        );
      case 'numbered-list':
        return (
          <ol {...attributes} className="my-2 list-decimal ps-6">
            {children}
          </ol>
        );
      case 'list-item':
        return <li {...attributes}>{children}</li>;
      case 'table':
        return (
          <table {...attributes} className="my-2 w-full table-fixed border-collapse">
            <tbody>{children}</tbody>
          </table>
        );
      case 'table-row':
        return <tr {...attributes}>{children}</tr>;
      case 'table-cell':
        return (
          <td {...attributes} className="border border-border-subtle p-2 align-top">
            {children}
          </td>
        );
      case 'link':
        return (
          <a {...attributes} href={element.href} className="text-primary underline">
            {children}
          </a>
        );
      case 'image': {
        const src = imageUrl?.(element.mediaId);
        return (
          <div {...attributes}>
            <figure contentEditable={false} className="my-2 select-none">
              {src ? (
                <img src={src} alt={element.alt} className="max-h-64 max-w-full rounded-md" />
              ) : (
                <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-text-secondary">
                  <ImageIcon aria-hidden className="size-5" />
                  <span>{element.alt}</span>
                </div>
              )}
            </figure>
            {children}
          </div>
        );
      }
      default:
        return (
          <p {...attributes} className="my-1 text-body">
            {children}
          </p>
        );
    }
  };
}
