import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { ALL_TABS, EXPECTED_TABS } from '../codec/registry';
import { META_SHEET } from '../codec/meta';
import { README_SHEET } from '../codec/workbook-codec';
import { TemplateService } from './template.service';
import { STARTER_TABS } from './template.constants';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function fakeSchool(overrides: Partial<School> = {}): School {
  return {
    id: TENANT_ID,
    name: 'Sample School',
    slug: 'sample-school',
    settings: null,
    ...overrides,
  } as School;
}

function makeRepo(school: School | null): Repository<School> {
  return { findOne: vi.fn().mockResolvedValue(school) } as unknown as Repository<School>;
}

describe('TemplateService', () => {
  describe('defaultLang', () => {
    it('defaults to bn when the school has no locale override', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      await expect(service.defaultLang(TENANT_ID)).resolves.toBe('bn');
    });

    it('follows an en-* locale override to en', async () => {
      const service = new TemplateService(
        makeRepo(fakeSchool({ settings: { region: { locale: 'en-BD' } } })),
      );
      await expect(service.defaultLang(TENANT_ID)).resolves.toBe('en');
    });

    it('throws NotFoundException when the tenant has no School row', async () => {
      const service = new TemplateService(makeRepo(null));
      await expect(service.defaultLang(TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // Each build is a CPU-bound xlsx write; ~1s alone, over the 5s default when the full suite runs in parallel.
  describe('build', { timeout: 30_000 }, () => {
    it('produces every EXPECTED_TABS sheet plus _meta and _readme, in order', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'en');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const names = workbook.worksheets.map((ws) => ws.name);
      expect(names[0]).toBe(META_SHEET);
      expect(names[1]).toBe(README_SHEET);
      for (const tabName of EXPECTED_TABS) {
        expect(names).toContain(tabName);
      }
    });

    it('_meta sheet reports kind TEMPLATE', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'en');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const metaSheet = workbook.getWorksheet(META_SHEET)!;
      const values: Record<string, string> = {};
      metaSheet.eachRow((row, rowNo) => {
        if (rowNo === 1) return;
        values[String(row.getCell(1).value)] = String(row.getCell(2).value);
      });
      expect(values.kind).toBe('TEMPLATE');
    });

    it('every tab sheet has exactly one data row, whose id cell is SAMPLE', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'en');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      for (const tabName of EXPECTED_TABS) {
        const sheet = workbook.getWorksheet(tabName)!;
        expect(sheet).toBeDefined();
        const dataRowNumbers: number[] = [];
        sheet.eachRow((row, rowNo) => {
          if (rowNo === 1) return;
          dataRowNumbers.push(rowNo);
          expect(String(row.getCell(1).value)).toBe('SAMPLE');
        });
        expect(dataRowNumbers).toHaveLength(1);
      }
    });

    // Builds every registered tab (10 added by Epic 28); >5s on slow CI runners.
    it('gives every enum or bool column a list data validation on rows 2-1000', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'en');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      // Derive what SHOULD have a dropdown from the registry itself, then
      // assert each one does. Iterating only over the validations that
      // happen to exist (the previous shape) passed just as happily if a
      // column silently lost its dropdown — nothing was checking for
      // absence, and one surviving validation anywhere satisfied the whole
      // assertion.
      const expectedColumns = ALL_TABS.flatMap((tab) =>
        tab.columns
          .map((col, index) => ({ tab: tab.name, colNo: index + 1, col }))
          .filter(
            ({ col }) =>
              (col.type === 'enum' && col.enumValues && col.enumValues.length > 0) ||
              col.type === 'bool',
          ),
      );
      expect(expectedColumns.length).toBeGreaterThan(0);

      for (const { tab, colNo } of expectedColumns) {
        const sheet = workbook.getWorksheet(tab)!;
        const validations = (
          sheet as unknown as { dataValidations: { model: Record<string, any> } }
        ).dataValidations.model;
        // exceljs's reader expands a range sqref into one model entry per
        // cell address (`E2`, `E3`, ...), not the `E2:E1000` range string
        // this service wrote — so address in, letter out, then assert the
        // first data row of that column carries a `list` validation.
        const letter = sheet.getColumn(colNo).letter;
        expect(
          validations[`${letter}2`],
          `${tab}.${letter} (column ${colNo}) should have a dropdown`,
        ).toBeDefined();
        expect(validations[`${letter}2`].type).toBe('list');
      }

      // ...and every validation that exists is still a well-formed `list`
      // on a data row, which is what the original loop checked.
      for (const tabName of EXPECTED_TABS) {
        const sheet = workbook.getWorksheet(tabName)!;
        const validations = (
          sheet as unknown as { dataValidations: { model: Record<string, any> } }
        ).dataValidations.model;
        for (const address of Object.keys(validations)) {
          const match = /^[A-Z]+(\d+)$/.exec(address);
          expect(match).not.toBeNull();
          const rowNo = Number(match![1]);
          expect(rowNo).toBeGreaterThanOrEqual(2);
          expect(rowNo).toBeLessThanOrEqual(1000);
          expect(validations[address].type).toBe('list');
        }
      }
    }, 30_000);

    it('gives every header cell a comment naming the column and its requirement', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'en');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const sheet = workbook.getWorksheet('school')!;
      const idHeaderCell = sheet.getRow(1).getCell(1);
      expect(String(idHeaderCell.note)).toMatch(/required|optional/);
    });

    it('_readme lists every tab name', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'bn');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const readme = workbook.getWorksheet(README_SHEET)!;
      const text: string[] = [];
      readme.eachRow((row) => text.push(String(row.getCell(1).value)));
      const joined = text.join('\n');

      for (const tabName of EXPECTED_TABS) {
        expect(joined).toContain(tabName);
      }
    });
  });

  describe('starter variant [13.3.3]', () => {
    it('has exactly the STARTER_TABS sheets, each with an example row and a first-cell note', async () => {
      const service = new TemplateService(makeRepo(fakeSchool()));
      const { buffer } = await service.build(TENANT_ID, 'en', 'starter');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      const tabSheets = workbook.worksheets
        .map((ws) => ws.name)
        .filter((n) => (EXPECTED_TABS as readonly string[]).includes(n));
      expect(tabSheets).toEqual([...STARTER_TABS]);

      for (const name of STARTER_TABS) {
        const sheet = workbook.getWorksheet(name)!;
        expect(String(sheet.getRow(2).getCell(1).value)).toBe('SAMPLE');
        expect(JSON.stringify(sheet.getRow(1).getCell(1).note)).toContain('SAMPLE');
      }
    });

    it('STARTER_TABS are all real EXPECTED_TABS names', () => {
      for (const name of STARTER_TABS) expect(EXPECTED_TABS).toContain(name);
    });
  });
});
