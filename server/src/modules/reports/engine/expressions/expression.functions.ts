import type { ExpressionErrorCode } from './expression.parser';

/** The value types the language knows. MONEY and PERCENT are numbers that remember what they are. */
export type ValueType = 'NUMBER' | 'MONEY' | 'PERCENT' | 'TEXT' | 'DATE' | 'BOOLEAN' | 'NULL';

export const isNumeric = (t: ValueType) => t === 'NUMBER' || t === 'MONEY' || t === 'PERCENT';

/** One compiled argument: its SQL text and its type. */
export interface Typed {
  sql: string;
  type: ValueType;
}

export interface FunctionDef {
  name: string;
  min: number;
  max: number;
  /** The result type and SQL for already compiled arguments, or an error code for a bad mix of types. */
  build(
    args: Typed[],
    literals: (number | null)[],
  ): { sql: string; type: ValueType } | ExpressionErrorCode;
}

/** The type two values share, or `null` when they cannot be mixed. NULL fits anything. */
export function unify(a: ValueType, b: ValueType): ValueType | null {
  if (a === 'NULL') return b;
  if (b === 'NULL') return a;
  if (a === b) return a;
  if (isNumeric(a) && isNumeric(b)) return a === 'NUMBER' ? b : b === 'NUMBER' ? a : null;
  return null;
}

const text = (t: ValueType) => t === 'TEXT';

/**
 * The whitelist. A name that is not here cannot be called, and every function compiles to fixed SQL
 * around its compiled arguments: there is no way to pass raw SQL through any of them.
 */
export const FUNCTIONS: Record<string, FunctionDef> = {
  if: {
    name: 'if',
    min: 3,
    max: 3,
    build([cond, a, b]) {
      if (cond.type !== 'BOOLEAN') return 'EXPR_TYPE';
      const type = unify(a.type, b.type);
      if (!type) return 'EXPR_TYPE';
      return { sql: `CASE WHEN ${cond.sql} THEN ${a.sql} ELSE ${b.sql} END`, type };
    },
  },
  coalesce: {
    name: 'coalesce',
    min: 2,
    max: 6,
    build(args) {
      let type: ValueType | null = 'NULL';
      for (const a of args) type = type === null ? null : unify(type, a.type);
      if (!type) return 'EXPR_TYPE';
      return { sql: `COALESCE(${args.map((a) => a.sql).join(', ')})`, type };
    },
  },
  round: {
    name: 'round',
    min: 2,
    max: 2,
    build([x, n], literals) {
      const digits = literals[1];
      if (!isNumeric(x.type) || n.type !== 'NUMBER') return 'EXPR_TYPE';
      // The digit count must be a plain whole number written in the expression: it is inlined as a
      // checked integer, never as text.
      if (digits === null || !Number.isInteger(digits) || digits < 0 || digits > 6)
        return 'EXPR_TYPE';
      return { sql: `ROUND((${x.sql})::numeric, ${digits})`, type: x.type };
    },
  },
  days_between: {
    name: 'days_between',
    min: 2,
    max: 2,
    build([a, b]) {
      if (a.type !== 'DATE' || b.type !== 'DATE') return 'EXPR_TYPE';
      return { sql: `((${b.sql})::date - (${a.sql})::date)`, type: 'NUMBER' };
    },
  },
  concat: {
    name: 'concat',
    min: 2,
    max: 8,
    build(args) {
      // Any value can be joined as text; money and numbers keep their plain digits.
      return { sql: `CONCAT(${args.map((a) => `(${a.sql})::text`).join(', ')})`, type: 'TEXT' };
    },
  },
  pct: {
    name: 'pct',
    min: 2,
    max: 2,
    build([a, b]) {
      if (!isNumeric(a.type) || !isNumeric(b.type)) return 'EXPR_TYPE';
      // A zero total gives no percentage (NULL), never a division error.
      return { sql: `(100.0 * (${a.sql}) / NULLIF((${b.sql}), 0))`, type: 'PERCENT' };
    },
  },
};

export { text as isText };
