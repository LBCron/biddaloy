/**
 * [8.15.41] The four question starters on `/reports/new`: a person picks a question, fills one or
 * two blanks from dropdowns, and lands in the designer with the right subject, trays and filters
 * already chosen. Pure: no words (the start screen writes the sentences and takes every field and
 * count name from `GET /reports/meta`), no network.
 *
 * ```
 *  কতজন [ছাত্রছাত্রী v], [শ্রেণি v] ও [লিঙ্গ v] অনুযায়ী?   ->  STUDENTS, split: class + gender, count: students
 *  কাদের তালিকা, যারা [ছাত্রী v] [৬ষ্ঠ শ্রেণির v]?          ->  STUDENTS, show: roll, name, class, section;
 *                                                               only: gender = FEMALE, class = Class 6
 *  মোট কত টাকা [বাকি v], [শ্রেণি v] অনুযায়ী?              ->  FEES, split: class, add up: outstanding
 *  প্রতি মাসে কত [জমা v]?                                   ->  PAYMENTS, split: date (by month), add up: collected
 * ```
 *
 * The keys below are the registry's own (`server/src/modules/reports/engine/registry/areas/*.ts`).
 * A key the school's registry does not have is dropped by `buildDraft`, never sent.
 */
import { FilterOp, type ReportFilter, type ReportLayoutType } from '@biddaloy/shared';

export type StarterId = 'howMany' | 'whoList' | 'howMuch' | 'perMonth';
export const STARTER_IDS: readonly StarterId[] = ['howMany', 'whoList', 'howMuch', 'perMonth'];

/** The answers, by blank id. An empty string is "no answer" (an optional blank left alone). */
export type StarterAnswers = Record<string, string>;

/** One dropdown. `choices` name registry keys; the screen shows each key's own label. */
export type StarterBlank =
  | {
      id: string;
      kind: 'pick';
      optional?: boolean;
      /** The registry key each choice stands for, and the subject it belongs to (a blank may change the subject). */
      choices: readonly {
        value: string;
        /** A registry subject (`STUDENTS`, `FEES`…), or `ANY` for a split that fits whichever subject was chosen. */
        area: string;
        key: string;
        measure?: boolean;
      }[];
      /** The answer when nothing has been chosen yet. */
      initial: string;
    }
  // "Only those who…" blanks: the values of a field (a choice from a list, or the school's classes).
  | { id: string; kind: 'values'; field: 'gender' | 'class'; initial: '' };

export interface StarterDefinition {
  id: StarterId;
  blanks: readonly StarterBlank[];
}

/** What a starter picks: the subject, the trays, the "only those who…" conditions. */
export interface StarterPlan {
  /** A registry subject: `STUDENTS`, `FEES`… */
  area: string;
  picks: { show: string[]; split: string[]; count: string[] };
  filters: ReportFilter[];
  /** A date field that is split by gets this bucket. */
  bucket?: 'month';
  layout?: ReportLayoutType;
}

const STUDENT_SPLITS = ['class', 'gender', 'section', 'religion'] as const;
const STAFF_SPLITS = ['staff_type', 'designation', 'department'] as const;

/** What "…, … by" may split a count of this subject by (the other subject's splits make no sense). */
export function splitKeysFor(subject: string | undefined): readonly string[] {
  return subject === 'STAFF.staff' ? STAFF_SPLITS : STUDENT_SPLITS;
}

const splitChoices = (area: string, keys: readonly string[]) =>
  keys.map((key) => ({ value: `${area}.${key}`, area, key }));

export const STARTERS: Record<StarterId, StarterDefinition> = {
  howMany: {
    id: 'howMany',
    blanks: [
      {
        id: 'subject',
        kind: 'pick',
        initial: 'STUDENTS.students',
        choices: [
          { value: 'STUDENTS.students', area: 'STUDENTS', key: 'students', measure: true },
          { value: 'STAFF.staff', area: 'STAFF', key: 'staff', measure: true },
        ],
      },
      {
        id: 'first',
        kind: 'pick',
        initial: 'class',
        choices: [...STUDENT_SPLITS, ...STAFF_SPLITS].map((key) => ({
          value: key,
          area: 'ANY',
          key,
        })),
      },
      {
        id: 'second',
        kind: 'pick',
        optional: true,
        initial: 'gender',
        choices: [...STUDENT_SPLITS, ...STAFF_SPLITS].map((key) => ({
          value: key,
          area: 'ANY',
          key,
        })),
      },
    ],
  },
  whoList: {
    id: 'whoList',
    blanks: [
      { id: 'gender', kind: 'values', field: 'gender', initial: '' },
      { id: 'class', kind: 'values', field: 'class', initial: '' },
    ],
  },
  howMuch: {
    id: 'howMuch',
    blanks: [
      {
        id: 'amount',
        kind: 'pick',
        initial: 'outstanding',
        choices: ['billed', 'paid', 'outstanding'].map((key) => ({
          value: key,
          area: 'FEES',
          key,
          measure: true,
        })),
      },
      {
        id: 'by',
        kind: 'pick',
        initial: 'class',
        choices: splitChoices('FEES', ['class', 'fee_type', 'status']),
      },
    ],
  },
  perMonth: {
    id: 'perMonth',
    blanks: [
      {
        id: 'what',
        kind: 'pick',
        initial: 'PAYMENTS.collected',
        choices: [
          { value: 'PAYMENTS.collected', area: 'PAYMENTS', key: 'collected', measure: true },
          { value: 'FEES.billed', area: 'FEES', key: 'billed', measure: true },
          { value: 'PAYMENTS.payments', area: 'PAYMENTS', key: 'payments', measure: true },
        ],
      },
    ],
  },
};

/** The answers a card starts with. */
export function initialAnswers(id: StarterId): StarterAnswers {
  return Object.fromEntries(STARTERS[id].blanks.map((blank) => [blank.id, blank.initial]));
}

const ACTIVE = (field: string): ReportFilter => ({ field, op: FilterOp.EQ, value: 'ACTIVE' });

/** The plan for a starter and its answers. A blank left empty adds nothing. */
export function planStarter(id: StarterId, answers: StarterAnswers): StarterPlan {
  switch (id) {
    case 'howMany': {
      const staff = answers.subject === 'STAFF.staff';
      const area = staff ? 'STAFF' : 'STUDENTS';
      // Splits that belong to the other subject are dropped, so a changed subject never keeps a stale split.
      const allowed = splitKeysFor(answers.subject);
      const split = [answers.first, answers.second]
        .filter((key): key is string => !!key && allowed.includes(key))
        .filter((key, index, all) => all.indexOf(key) === index);
      return {
        area,
        picks: { show: [], split, count: [staff ? 'staff' : 'students'] },
        filters: [ACTIVE('status')],
      };
    }
    case 'whoList': {
      const filters: ReportFilter[] = [ACTIVE('status')];
      if (answers.gender) filters.push({ field: 'gender', op: FilterOp.EQ, value: answers.gender });
      if (answers.class) filters.push({ field: 'class', op: FilterOp.EQ, value: answers.class });
      return {
        area: 'STUDENTS',
        picks: { show: ['roll', 'name', 'class', 'section'], split: [], count: [] },
        filters,
      };
    }
    case 'howMuch':
      return {
        area: 'FEES',
        picks: {
          show: [],
          split: [answers.by || 'class'],
          count: [answers.amount || 'outstanding'],
        },
        filters: [],
      };
    case 'perMonth': {
      const [area = 'PAYMENTS', key = 'collected'] = (answers.what || 'PAYMENTS.collected').split(
        '.',
      );
      return {
        area,
        picks: { show: [], split: [area === 'FEES' ? 'due_date' : 'payment_date'], count: [key] },
        filters: [],
        bucket: 'month',
      };
    }
  }
}
