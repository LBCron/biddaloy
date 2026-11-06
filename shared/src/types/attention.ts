import type { AlertRuleKey } from '../attention/rule-catalogue';
import type {
  AlertCategory,
  AlertRecipientState,
  AlertSeverity,
  AlertSource,
} from '../enums/attention';

/** Rule copy with `{param}` placeholders. */
export interface RuleMessage {
  title: string;
  why: string;
  steps: string[];
  action?: string;
}

/** `schools.settings.attention`. Absent keys fall back to the defaults below. */
export interface AttentionSettings {
  /** Per-rule switch; only rules with `canDisable` honour `enabled: false` (D34). */
  rules: Partial<Record<AlertRuleKey, { enabled: boolean }>>;
  /** Minutes after period start before "attendance not taken" fires. Default 15 (D3). */
  attendanceGraceMinutes: number;
  /** Minutes before a class starts that `class.starting` fires. Default 10 (D3). */
  classStartingLeadMinutes: number;
  /** Morning daily-sweep time, HH:mm. Default '07:00' (D10). */
  dailyAt: string;
  /** Evening daily-sweep time, HH:mm. Default '17:00' (D10). */
  eveningAt: string;
  /** No pushes in this window, HH:mm. Default 21:00-07:00 (D23). */
  quietHours: { start: string; end: string };
  /** Guardian SMS fallback on/off. Default false (D29). */
  guardianSmsFallback: boolean;
  /** Staff SMS fallback on/off. Default false (D29). */
  staffSmsFallback?: boolean;
  /** Max fallback SMS per guardian per day. Default 2 (D29). */
  guardianSmsDailyCap: number;
  /** SMS credits below this raise `comms.sms_credit_low`. Default 200 (D34). */
  smsCreditLowThreshold: number;
  /** Failed messages above this raise `comms.failed_messages`. Default 10 (D34). */
  failedMessagesThreshold: number;
  /** Escalate unmarked attendance to heads. Default true (D34). */
  escalateAttendanceToHeads: boolean;
}

/** Client shape of the server's `AlertItemDto`. Dates are ISO strings. */
export interface AlertItem {
  recipientId: string;
  alertId: string;
  ruleKey: string;
  source: AlertSource;
  severity: AlertSeverity;
  category: AlertCategory;
  state: AlertRecipientState;
  title: string;
  why: string;
  steps: string[];
  actionLabel?: string;
  actionUrl?: string;
  closable: boolean;
  raisedAt: string;
  expiresAt?: string;
  snoozedUntil?: string;
  studentName?: string;
  sectionLabel?: string;
  resolvedAt?: string;
  resolvedByName?: string;
}

export interface AttentionSummary {
  critical: number;
  warning: number;
  reminder: number;
  /** OPEN + HIDDEN live items (the bar counts only OPEN). */
  activeTotal: number;
  top: AlertItem | null;
  updatedAt: string | null;
  staleMinutes: number;
}
