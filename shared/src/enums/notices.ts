/** Notice board shared types (Epic 53). D6/D16/D21. */
export enum NoticeStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum NoticeSmsStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
}

export enum NoticeRecipientKind {
  STAFF = 'STAFF',
  STUDENT = 'STUDENT',
  GUARDIAN = 'GUARDIAN',
}

export enum AudienceTarget {
  STAFF = 'STAFF',
  STUDENTS = 'STUDENTS',
  GUARDIANS = 'GUARDIANS',
}

export enum AudienceTab {
  ROLE = 'ROLE',
  NAMED_STAFF = 'NAMED_STAFF',
  CLASS = 'CLASS',
  SECTION = 'SECTION',
  NAMED_STUDENT = 'NAMED_STUDENT',
  EXAM_FAILED = 'EXAM_FAILED',
  FEE_DUE = 'FEE_DUE',
  LOW_ATTENDANCE = 'LOW_ATTENDANCE',
  ORG_GROUP = 'ORG_GROUP',
}

export const NOTICE_LIMITS = {
  titleMax: 140,
  bodyMax: 5000,
  filesMax: 3,
  fileBytesMax: 5 * 1024 * 1024,
  recipientsMax: 5000,
  mimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
} as const;
