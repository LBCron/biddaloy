import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FieldSensitivity } from '@biddaloy/shared';
import { compileExpression, type RefTarget } from './expression.compiler';
import {
  ExpressionError,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_LENGTH,
  parseExpression,
} from './expression.parser';

const FIELDS: Record<string, RefTarget> = {
  name: { sql: 's.full_name', type: 'TEXT', sensitivity: FieldSensitivity.PERSONAL, entity: 's' },
  gender: { sql: 's.gender', type: 'TEXT', sensitivity: FieldSensitivity.PUBLIC, entity: 's' },
  roll: { sql: 's.roll_number', type: 'NUMBER', sensitivity: FieldSensitivity.PUBLIC, entity: 's' },
  billed: {
    sql: 'sf.total_amount',
    type: 'MONEY',
    sensitivity: FieldSensitivity.FINANCIAL,
    entity: 'sf',
  },
  paid: {
    sql: 'sf.paid_amount',
    type: 'MONEY',
    sensitivity: FieldSensitivity.FINANCIAL,
    entity: 'sf',
  },
  born: {
    sql: 's.date_of_birth',
    type: 'DATE',
    sensitivity: FieldSensitivity.PERSONAL,
    entity: 's',
  },
  religion: {
    sql: 's.religion',
    type: 'TEXT',
    sensitivity: FieldSensitivity.SENSITIVE,
    entity: 's',
  },
  active: {
    sql: 's.is_active',
    type: 'BOOLEAN',
    sensitivity: FieldSensitivity.PUBLIC,
    entity: 's',
  },
};

function compile(source: string) {
  let n = 0;
  const params: Record<string, unknown> = {};
  const result = compileExpression(
    source,
    (key) => FIELDS[key],
    () => `c${n++}`,
    params,
  );
  return { ...result, params };
}

const fails = (source: string, code: string) => {
  let error: unknown;
  try {
    compile(source);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ExpressionError);
  expect((error as ExpressionError).code).toBe(code);
  return error as ExpressionError;
};

describe('calculated fields: parsing', () => {
  it('reads numbers, text, fields, brackets and the usual precedence', () => {
    expect(parseExpression('1 + 2 * 3')).toMatchObject({
      kind: 'bin',
      op: '+',
      right: { kind: 'bin', op: '*' },
    });
    expect(parseExpression('(1 + 2) * 3')).toMatchObject({
      kind: 'bin',
      op: '*',
      left: { kind: 'bin', op: '+' },
    });
    expect(parseExpression('10 - 4 - 3')).toMatchObject({ op: '-', left: { op: '-' } }); // left to right
    expect(parseExpression('not [active] and [roll] > 3 or true')).toMatchObject({ op: 'or' });
  });

  it("reads '' inside text as one quote", () => {
    expect(parseExpression("'it''s'")).toEqual({ kind: 'str', value: "it's" });
  });

  it('is case-insensitive for words and keeps field keys exact', () => {
    expect(parseExpression('IF(TRUE, 1, 2)')).toMatchObject({ kind: 'call', name: 'if' });
    expect(() => parseExpression('[Gender]')).toThrow(ExpressionError);
  });

  it.each([
    '',
    '1 +',
    '(1',
    '1 2',
    "'open",
    '[no_end',
    '[Bad]',
    'if(',
    'f(1,)',
    '#',
    '1 ; 2',
    '[a] ]',
    '1 constructor 2',
    '1 __proto__ 2',
  ])('rejects %j as a syntax error', (source) => {
    expect(() => parseExpression(source)).toThrow(expect.objectContaining({ code: 'EXPR_SYNTAX' }));
  });

  it('refuses an expression over 500 characters', () => {
    expect(() => parseExpression('1+'.repeat(MAX_EXPRESSION_LENGTH))).toThrow(
      expect.objectContaining({ code: 'EXPR_TOO_LONG' }),
    );
  });

  it('refuses nesting deeper than 8 and allows exactly 8', () => {
    const nest = (n: number) => 'not '.repeat(n - 1) + 'true';
    expect(() => parseExpression(nest(MAX_EXPRESSION_DEPTH))).not.toThrow();
    expect(() => parseExpression(nest(MAX_EXPRESSION_DEPTH + 1))).toThrow(
      expect.objectContaining({ code: 'EXPR_TOO_DEEP' }),
    );
    // A long flat chain is a deep tree too: the limit is on the tree, not on the writing.
    expect(() => parseExpression('1+1+1+1+1+1+1+1+1')).toThrow(
      expect.objectContaining({ code: 'EXPR_TOO_DEEP' }),
    );
  });

  it('never echoes the expression in an error', () => {
    const error = fails("[nope] + 'secret value'", 'EXPR_UNKNOWN_FIELD');
    expect(error.message).not.toContain('nope');
    expect(error.message).not.toContain('secret');
  });
});

describe('calculated fields: compiling', () => {
  it('uses only registry SQL for fields and binds every literal', () => {
    const { sql, params } = compile("if([gender] = 'MALE', [roll] + 10, 0)");
    expect(sql).toBe(
      'CASE WHEN ((s.gender) = (:c0)::text) THEN ((s.roll_number) + (:c1)::numeric) ELSE (:c2)::numeric END',
    );
    expect(params).toEqual({ c0: 'MALE', c1: 10, c2: 0 });
  });

  it('a percentage and a division answer NULL on a zero total, not an error', () => {
    expect(compile('pct([paid], [billed])').sql).toContain('NULLIF(((sf.total_amount)), 0)');
    expect(compile('[billed] / [roll]').sql).toContain('NULLIF((s.roll_number), 0)');
  });

  it('knows what each function gives back', () => {
    expect(compile('round([billed], 2)')).toMatchObject({ type: 'MONEY' });
    expect(compile('days_between([born], [born])')).toMatchObject({ type: 'NUMBER' });
    expect(compile("concat([name], ' / ', [roll])").type).toBe('TEXT');
    expect(compile('coalesce([roll], 0)').type).toBe('NUMBER');
    expect(compile('pct(1, 2)').type).toBe('PERCENT');
  });

  it('keeps money as money across + and -, and makes it a number across * and /', () => {
    expect(compile('[billed] - [paid]').type).toBe('MONEY');
    expect(compile('[billed] * 2').type).toBe('NUMBER');
  });

  describe('type errors', () => {
    it.each([
      ['[billed] + [name]', 'money and text'],
      ["[roll] + 'a'", 'number and text'],
      ['not [roll]', 'not on a number'],
      ['[roll] and [active]', 'and on a number'],
      ['[gender] = 5', 'text equals number'],
      ['if([roll], 1, 2)', 'if on a number'],
      ["if([active], 1, 'a')", 'if branches differ'],
      ['days_between([roll], [born])', 'days between a number'],
      ['round([billed], [roll])', 'digits from a field'],
      ['round([billed], 9)', 'too many digits'],
      ['round([billed], 1.5)', 'fractional digits'],
      ['-[name]', 'minus on text'],
    ])('%s (%s)', (source) => {
      fails(source, 'EXPR_TYPE');
    });

    it('unknown names and wrong argument counts', () => {
      fails('[nothing]', 'EXPR_UNKNOWN_FIELD');
      fails('lower([name])', 'EXPR_UNKNOWN_FUNCTION');
      fails('constructor(1, 2)', 'EXPR_UNKNOWN_FUNCTION');
      fails('__proto__(1, 2)', 'EXPR_UNKNOWN_FUNCTION');
      fails('if(true, 1)', 'EXPR_ARITY');
      fails('pct(1)', 'EXPR_ARITY');
    });
  });

  describe('what a calculation may reveal (D5)', () => {
    it('is as sensitive as the most sensitive field it reads', () => {
      expect(compile('[roll] + 1').sensitivity).toBe(FieldSensitivity.PUBLIC);
      expect(compile('concat([gender], [name])').sensitivity).toBe(FieldSensitivity.PERSONAL);
      expect(compile('pct([paid], [billed])').sensitivity).toBe(FieldSensitivity.FINANCIAL);
      expect(compile("if([religion] = 'x', [billed], 0)").sensitivity).toBe(
        FieldSensitivity.SENSITIVE,
      );
    });

    it('lists the tables it reads, so the compiler can join them', () => {
      expect(compile('[billed] + [roll]').entities.sort()).toEqual(['s', 'sf']);
    });
  });
});

describe('calculated fields: injection fuzz', () => {
  const NASTY = [
    "'",
    '"',
    ';',
    '--',
    '/*',
    '*/',
    '\\',
    '%',
    '$$',
    '`',
    ')',
    '(',
    '||',
    'DROP TABLE x',
    "' OR 1=1 --",
  ];

  it('no random text yields SQL that contains a quote, semicolon or comment', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (source) => {
        let compiled;
        try {
          compiled = compile(source);
        } catch (error) {
          expect(error).toBeInstanceOf(ExpressionError); // never any other kind of failure
          return;
        }
        expect(compiled.sql).not.toMatch(/['";`\\]|--|\/\*/);
      }),
      { numRuns: 2000 },
    );
  });

  it('text written with every kind of nasty character is bound, never spliced into SQL', () => {
    const nasty = fc
      .array(fc.constantFrom(...NASTY, 'a', ' ', '0'), { minLength: 1, maxLength: 10 })
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(nasty, fc.integer({ min: 0, max: 1_000_000 }), (text, n) => {
        const source = `if([gender] = '${text.replace(/'/g, "''")}', [roll] + ${n}, 0)`;
        const { sql, params } = compile(source);
        expect(sql).not.toMatch(/['";`\\]|--|\/\*/);
        expect(sql).not.toContain('DROP');
        expect(Object.values(params)).toContain(text);
        expect(Object.values(params)).toContain(n);
      }),
      { numRuns: 1500 },
    );
  });

  it('a generated well-formed expression always compiles to SQL with only known pieces', () => {
    const leaf = fc.oneof(
      fc.integer({ min: 0, max: 999 }).map(String),
      fc.constantFrom('[roll]', '[billed]', '[paid]'),
    );
    const arithmetic = fc.letrec((tie) => ({
      expr: fc.oneof(
        { depthSize: 'small' },
        leaf,
        fc
          .tuple(tie('expr'), fc.constantFrom('+', '-', '*', '/'), tie('expr'))
          .map(([a, op, b]) => `(${a} ${op} ${b})`),
      ),
    })).expr;
    fc.assert(
      fc.property(arithmetic, (source) => {
        try {
          const { sql } = compile(source);
          expect(sql).not.toMatch(/['";`\\]|--|\/\*/);
        } catch (error) {
          // MONEY * MONEY is fine; only the language's own limits or type rules may refuse.
          expect(error).toBeInstanceOf(ExpressionError);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
