import { Transform, type TransformCallback } from 'node:stream';
import { toCsvContent } from '@biddaloy/shared';

const BOM = '﻿';

/**
 * Turns chunks of rows into CSV text. The UTF-8 BOM (so Excel reads Bangla
 * correctly) is written once, on the first chunk; later chunks are joined to
 * it with the CRLF row separator. Escaping and the formula guard come from
 * `toCsvContent` in `@biddaloy/shared`, the one shared implementation.
 */
export class CsvStreamWriter extends Transform {
  private started = false;

  constructor() {
    super({ writableObjectMode: true });
  }

  override _transform(
    rows: readonly (readonly unknown[])[],
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    if (rows.length === 0) return callback();
    // `toCsvContent` always leads with the BOM; keep it only for the first chunk.
    const body = toCsvContent(rows).slice(BOM.length);
    this.push(this.started ? `\r\n${body}` : `${BOM}${body}`);
    this.started = true;
    callback();
  }
}
