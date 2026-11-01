import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CloneCalendarDto } from './calendar-export.dto';

// Rule 5: event_ids reaches an IN (...) query, so the list is capped.
describe('CloneCalendarDto event_ids', () => {
  const check = (event_ids?: string[]) =>
    validate(
      plainToInstance(CloneCalendarDto, {
        source_year_id: randomUUID(),
        target_year_id: randomUUID(),
        ...(event_ids ? { event_ids } : {}),
      }),
    );
  const ids = (count: number) => Array.from({ length: count }, () => randomUUID());

  it('accepts the field left out (clone everything)', async () => {
    expect(await check()).toEqual([]);
  });

  it('accepts exactly 500 ids', async () => {
    expect(await check(ids(500))).toEqual([]);
  });

  it('rejects 501 ids', async () => {
    const errors = await check(ids(501));
    expect(errors.map((e) => e.property)).toContain('event_ids');
  });

  it('still rejects a non-UUID entry', async () => {
    const errors = await check(['not-a-uuid']);
    expect(errors.map((e) => e.property)).toContain('event_ids');
  });
});
