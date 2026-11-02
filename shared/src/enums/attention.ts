export enum AlertSeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  REMINDER = 'REMINDER',
} // red / amber / blue (D4)

export enum AlertSource {
  RULE = 'RULE',
  MANUAL = 'MANUAL',
  NOTICE = 'NOTICE',
}

export enum AlertStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
  EXPIRED = 'EXPIRED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum AlertRecipientState {
  OPEN = 'OPEN',
  HIDDEN = 'HIDDEN',
  RESOLVED = 'RESOLVED',
  EXPIRED = 'EXPIRED',
} // D19

export enum AlertCadence {
  FAST = 'FAST',
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  ON_CHANGE = 'ON_CHANGE',
} // D7

export enum AlertCategory {
  SETUP = 'SETUP',
  SYSTEM = 'SYSTEM',
  STRUCTURE = 'STRUCTURE',
  ATTENDANCE = 'ATTENDANCE',
  PERIOD = 'PERIOD',
  HOMEWORK = 'HOMEWORK',
  CLASS = 'CLASS',
  STUDY_PLAN = 'STUDY_PLAN',
  FEES = 'FEES',
  EXAMS = 'EXAMS',
  OFFICE = 'OFFICE',
  FAMILY = 'FAMILY',
  COMMON = 'COMMON',
  PLATFORM = 'PLATFORM',
  BILLING = 'BILLING',
  MANUAL = 'MANUAL',
  NOTICE = 'NOTICE',
}

export type AlertSnoozeChoice = 'TWO_HOURS' | 'TOMORROW_MORNING' | 'NEXT_SCHOOL_DAY' | 'DATE'; // D28
