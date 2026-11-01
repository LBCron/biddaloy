import type { FieldSensitivity } from '@biddaloy/shared';
import { FieldSensitivity as S } from '@biddaloy/shared';
import { FUNCTIONS, isNumeric, unify, type Typed, type ValueType } from './expression.functions';
import { ExpressionError, parseExpression, type Expr } from './expression.parser';

/** What a `[field]` reference resolves to. Supplied from the registry; the expression cannot invent one. */
export interface RefTarget {
  sql: string;
  type: ValueType;
  sensitivity: FieldSensitivity;
  /** Alias of the entity it reads, so the compiler can join it. */
  entity: string;
}

export interface CompiledExpression {
  sql: string;
  type: ValueType;
  /** The most sensitive field the expression reads (D5). */
  sensitivity: FieldSensitivity;
  /** Entity aliases the expression reads. */
  entities: string[];
}

const RANK: FieldSensitivity[] = [S.PUBLIC, S.PERSONAL, S.CONTACT, S.FINANCIAL, S.SENSITIVE];
const higher = (a: FieldSensitivity, b: FieldSensitivity) =>
  RANK.indexOf(a) >= RANK.indexOf(b) ? a : b;

/**
 * [8.15.36] Turns an expression into a SQL fragment (Epic 8.15 D4, D5). The fragment is built only
 * from registry SQL for `[field]` references, fixed function templates, and bound parameters for every
 * literal: a number or text written in the expression becomes `:name` in `params`, never SQL text.
 * Types are checked, so a money value cannot be added to text.
 */
export function compileExpression(
  source: string,
  resolve: (key: string) => RefTarget | undefined,
  /** Gives the next unused parameter name, e.g. `c0`, `c1`. */
  nextParam: () => string,
  params: Record<string, unknown>,
): CompiledExpression {
  const tree = parseExpression(source);
  let sensitivity: FieldSensitivity = S.PUBLIC;
  const entities = new Set<string>();

  const bind = (value: unknown, cast: string): string => {
    const name = nextParam();
    params[name] = value;
    return `(:${name})::${cast}`;
  };

  function compile(e: Expr): Typed {
    switch (e.kind) {
      case 'num':
        return { sql: bind(e.value, 'numeric'), type: 'NUMBER' };
      case 'str':
        return { sql: bind(e.value, 'text'), type: 'TEXT' };
      case 'bool':
        return { sql: e.value ? 'TRUE' : 'FALSE', type: 'BOOLEAN' };
      case 'null':
        return { sql: 'NULL', type: 'NULL' };
      case 'ref': {
        const target = resolve(e.key);
        if (!target) throw new ExpressionError('EXPR_UNKNOWN_FIELD', e.pos);
        sensitivity = higher(sensitivity, target.sensitivity);
        entities.add(target.entity);
        return { sql: `(${target.sql})`, type: target.type };
      }
      case 'neg': {
        const x = compile(e.operand);
        if (!isNumeric(x.type)) throw new ExpressionError('EXPR_TYPE');
        return { sql: `(-${x.sql})`, type: x.type };
      }
      case 'not': {
        const x = compile(e.operand);
        if (x.type !== 'BOOLEAN') throw new ExpressionError('EXPR_TYPE');
        return { sql: `(NOT ${x.sql})`, type: 'BOOLEAN' };
      }
      case 'bin':
        return binary(e);
      case 'call':
        return call(e);
    }
  }

  function binary(e: Extract<Expr, { kind: 'bin' }>): Typed {
    const l = compile(e.left);
    const r = compile(e.right);
    switch (e.op) {
      case 'and':
      case 'or':
        if (l.type !== 'BOOLEAN' || r.type !== 'BOOLEAN')
          throw new ExpressionError('EXPR_TYPE', e.pos);
        return { sql: `(${l.sql} ${e.op.toUpperCase()} ${r.sql})`, type: 'BOOLEAN' };
      case '=':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (!unify(l.type, r.type)) throw new ExpressionError('EXPR_TYPE', e.pos);
        const op = e.op === '!=' ? '<>' : e.op;
        return { sql: `(${l.sql} ${op} ${r.sql})`, type: 'BOOLEAN' };
      }
      case '+':
      case '-':
      case '*':
      case '/': {
        if (!isNumeric(l.type) || !isNumeric(r.type)) throw new ExpressionError('EXPR_TYPE', e.pos);
        // Money stays money only for + and - between money; times or over anything is a plain number.
        const same = l.type === r.type ? l.type : unify(l.type, r.type);
        if (!same) throw new ExpressionError('EXPR_TYPE', e.pos);
        const type: ValueType = e.op === '+' || e.op === '-' ? same : 'NUMBER';
        // A zero divisor gives no answer (NULL), never an error.
        const right = e.op === '/' ? `NULLIF(${r.sql}, 0)` : r.sql;
        return { sql: `(${l.sql} ${e.op} ${right})`, type };
      }
    }
  }

  function call(e: Extract<Expr, { kind: 'call' }>): Typed {
    const fn = Object.hasOwn(FUNCTIONS, e.name) ? FUNCTIONS[e.name] : undefined;
    if (!fn) throw new ExpressionError('EXPR_UNKNOWN_FUNCTION', e.pos);
    if (e.args.length < fn.min || e.args.length > fn.max)
      throw new ExpressionError('EXPR_ARITY', e.pos);
    const args = e.args.map(compile);
    // Plain numbers written in the expression, for functions that need a fixed one (round's digits).
    const literals = e.args.map((a) => (a.kind === 'num' ? a.value : null));
    const built = fn.build(args, literals);
    if (typeof built === 'string') throw new ExpressionError(built, e.pos);
    return built;
  }

  const result = compile(tree);
  return { ...result, sensitivity, entities: [...entities] };
}
