/**
 * [53.2.02] What the public notice page may show. Deliberately has no author
 * and no recipient field: the page is reached by a link anyone can forward.
 */
export class PublicNoticeFileDto {
  id: string;
  mimeType: string;
  name: string;
}

export class PublicNoticeDto {
  schoolName: string;
  title: string;
  body: string;
  publishedAt: Date | null;
  editedAt: Date | null;
  files: PublicNoticeFileDto[];
}
