/**
 * [8.15.36] The calculated-field language, parsed by hand (Epic 8.15 D4). No `eval`, no third-party
 * parser: a tokenizer and a Pratt parser over a small grammar. Nothing here knows about SQL.
 *
 *   expression := or
 *   literals   := 12  3.5  'text'  true  false  null
 *   field      := [gender]            (a registry field or measure key)
 *   operators  := + - * /   = != <> < <= > >=   and  or  not
 *   functions  := if(cond, a, b)  coalesce(a, b, ...)  round(x, n)  days_between(a, b)  concat(a, ...)  pct(a, b)
 */
export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_EXPRESSION_DEPTH = 8;

export type ExpressionErrorCode =
  | 'EXPR_TOO_LONG'
  | 'EXPR_TOO_DEEP'
  | 'EXPR_SYNTAX'
  | 'EXPR_UNKNOWN_FIELD'
  | 'EXPR_UNKNOWN_FUNCTION'
  | 'EXPR_ARITY'
  | 'EXPR_TYPE';

/** Fixed sentences only: neither the expression nor a name from it is ever echoed back. */
const MESSAGES: Record<ExpressionErrorCode, string> = {
  EXPR_TOO_LONG: 'A calculation is too long.',
  EXPR_TOO_DEEP: 'A calculation is too deeply nested.',
  EXPR_SYNTAX: 'A calculation is not written correctly.',
  EXPR_UNKNOWN_FIELD: 'A calculation uses a field that does not exist.',
  EXPR_UNKNOWN_FUNCTION: 'A calculation uses a function that does not exist.',
  EXPR_ARITY: 'A calculation gives a function the wrong number of values.',
  EXPR_TYPE: 'A calculation mixes values that do not go together.',
};

export class ExpressionError extends Error {
  constructor(
    readonly code: ExpressionErrorCode,
    /** Character position in the expression, for the designer to point at. */
    readonly position = 0,
  ) {
    super(MESSAGES[code]);
    this.name = 'ExpressionError';
  }
}

export type BinaryOp = '+' | '-' | '*' | '/' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'ref'; key: string; pos: number }
  | { kind: 'neg'; operand: Expr }
  | { kind: 'not'; operand: Expr }
  | { kind: 'bin'; op: BinaryOp; left: Expr; right: Expr; pos: number }
  | { kind: 'call'; name: string; args: Expr[]; pos: number };

type Token =
  | { t: 'num'; value: number; pos: number }
  | { t: 'str'; value: string; pos: number }
  | { t: 'ref'; value: string; pos: number }
  | { t: 'word'; value: string; pos: number }
  | { t: 'op'; value: string; pos: number }
  | { t: 'end'; pos: number };

const REF_KEY = /^[a-z][a-z0-9_.]*$/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ t: 'num', value: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (c === "'") {
      let value = '';
      let j = i + 1;
      for (;;) {
        if (j >= source.length) throw new ExpressionError('EXPR_SYNTAX', i);
        if (source[j] === "'") {
          if (source[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += source[j++];
      }
      tokens.push({ t: 'str', value, pos: i });
      i = j + 1;
    } else if (c === '[') {
      const end = source.indexOf(']', i);
      const key = end === -1 ? '' : source.slice(i + 1, end);
      if (!REF_KEY.test(key)) throw new ExpressionError('EXPR_SYNTAX', i);
      tokens.push({ t: 'ref', value: key, pos: i });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ t: 'word', value: m[0].toLowerCase(), pos: i });
      i += m[0].length;
    } else {
      const two = source.slice(i, i + 2);
      if (['<=', '>=', '!=', '<>'].includes(two)) {
        tokens.push({ t: 'op', value: two === '<>' ? '!=' : two, pos: i });
        i += 2;
      } else if ('+-*/=<>(),'.includes(c)) {
        tokens.push({ t: 'op', value: c, pos: i });
        i++;
      } else {
        throw new ExpressionError('EXPR_SYNTAX', i);
      }
    }
  }
  tokens.push({ t: 'end', pos: source.length });
  return tokens;
}

/** Binding power of each infix operator; higher binds tighter. */
const INFIX: Record<string, { bp: number; op: BinaryOp }> = {
  or: { bp: 1, op: 'or' },
  and: { bp: 2, op: 'and' },
  '=': { bp: 4, op: '=' },
  '!=': { bp: 4, op: '!=' },
  '<': { bp: 4, op: '<' },
  '<=': { bp: 4, op: '<=' },
  '>': { bp: 4, op: '>' },
  '>=': { bp: 4, op: '>=' },
  '+': { bp: 5, op: '+' },
  '-': { bp: 5, op: '-' },
  '*': { bp: 6, op: '*' },
  '/': { bp: 6, op: '/' },
};
const RECURSION_LIMIT = 64;
const NOT_BP = 3;
const NEG_BP = 7;

/** Parses an expression into a tree. Throws `ExpressionError` and nothing else. */
export function parseExpression(source: string): Expr {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new ExpressionError('EXPR_TOO_LONG');
  const tokens = tokenize(source);
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];

  function expect(value: string): void {
    const tok = next();
    if (tok.t !== 'op' || tok.value !== value) throw new ExpressionError('EXPR_SYNTAX', tok.pos);
  }

  function primary(depth: number): Expr {
    const tok = next();
    switch (tok.t) {
      case 'num':
        return { kind: 'num', value: tok.value };
      case 'str':
        return { kind: 'str', value: tok.value };
      case 'ref':
        return { kind: 'ref', key: tok.value, pos: tok.pos };
      case 'word': {
        if (tok.value === 'true' || tok.value === 'false') {
          return { kind: 'bool', value: tok.value === 'true' };
        }
        if (tok.value === 'null') return { kind: 'null' };
        if (tok.value === 'not') return { kind: 'not', operand: expr(NOT_BP, depth + 1) };
        // Any other word must be a function call.
        expect('(');
        const args: Expr[] = [];
        if (!(peek().t === 'op' && (peek() as { value: string }).value === ')')) {
          for (;;) {
            args.push(expr(0, depth + 1));
            const sep = next();
            if (sep.t === 'op' && sep.value === ',') continue;
            if (sep.t === 'op' && sep.value === ')') break;
            throw new ExpressionError('EXPR_SYNTAX', sep.pos);
          }
        } else {
          next();
        }
        return { kind: 'call', name: tok.value, args, pos: tok.pos };
      }
      case 'op':
        if (tok.value === '(') {
          const inner = expr(0, depth + 1);
          expect(')');
          return inner;
        }
        if (tok.value === '-') return { kind: 'neg', operand: expr(NEG_BP, depth + 1) };
        throw new ExpressionError('EXPR_SYNTAX', tok.pos);
      default:
        throw new ExpressionError('EXPR_SYNTAX', tok.pos);
    }
  }

  function expr(minBp: number, depth: number): Expr {
    // Guards the parser's own recursion; the limit on the finished tree is checked below.
    if (depth > RECURSION_LIMIT) throw new ExpressionError('EXPR_TOO_DEEP', peek().pos);
    let left = primary(depth);
    for (;;) {
      const tok = peek();
      const key = tok.t === 'op' || tok.t === 'word' ? (tok as { value: string }).value : '';
      const infix = Object.hasOwn(INFIX, key) ? INFIX[key] : undefined;
      if (!infix || infix.bp <= minBp) break;
      next();
      // Left-associative: the right side must bind tighter than this operator.
      const right = expr(infix.bp, depth + 1);
      left = { kind: 'bin', op: infix.op, left, right, pos: tok.pos };
    }
    return left;
  }

  const tree = expr(0, 0);
  const rest = peek();
  if (rest.t !== 'end') throw new ExpressionError('EXPR_SYNTAX', rest.pos);
  if (treeDepth(tree) > MAX_EXPRESSION_DEPTH) throw new ExpressionError('EXPR_TOO_DEEP');
  return tree;
}

/** Levels of nesting in a tree: a lone value is 1. */
export function treeDepth(e: Expr): number {
  switch (e.kind) {
    case 'neg':
    case 'not':
      return 1 + treeDepth(e.operand);
    case 'bin':
      return 1 + Math.max(treeDepth(e.left), treeDepth(e.right));
    case 'call':
      return 1 + Math.max(0, ...e.args.map(treeDepth));
    default:
      return 1;
  }
}
