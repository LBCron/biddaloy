import { describe, expect, it } from 'vitest';
import { CsvStreamWriter } from './csv-stream.writer';

const run = async (chunks: unknown[][][]): Promise<string> => {
  const csv = new CsvStreamWriter();
  const parts: string[] = [];
  csv.on('data', (d: Buffer | string) => parts.push(d.toString()));
  for (const chunk of chunks) csv.write(chunk);
  csv.end();
  await new Promise((resolve) => csv.once('end', resolve));
  return parts.join('');
};

describe('CsvStreamWriter', () => {
  it('writes the byte-order mark once, on the first chunk only', async () => {
    const text = await run([[['a', 'b']], [['c', 'd']], [['e', 'f']]]);
    expect(text.split('﻿')).toHaveLength(2);
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.slice(1).split('\r\n')).toEqual(['"a","b"', '"c","d"', '"e","f"']);
  });

  it('guards a formula cell', async () => {
    const text = await run([[['=1+1']]]);
    expect(text).toContain("'=1+1");
  });
});
