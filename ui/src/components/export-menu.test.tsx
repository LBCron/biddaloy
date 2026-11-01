import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportTooLargeError } from '../hooks/reports';
import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';
import { RegionConfigProvider } from '../i18n/region-config-provider';
import { expectKeyboardOperable } from '../test/a11y';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { ExportMenu, type ExportMenuProps } from './export-menu';
import { HelpProvider, type HelpIndex } from './help-hint';

afterEach(async () => {
  await cleanupTestState();
});

function renderMenu(props: Partial<ExportMenuProps> = {}, locale: 'en' | 'bn' = 'en') {
  const onExportAll = vi.fn<ExportMenuProps['onExportAll']>(() => Promise.resolve());
  const onExportSelected = vi.fn<NonNullable<ExportMenuProps['onExportSelected']>>();
  const result = renderWithProviders(
    <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
      <ExportMenu
        totalCount={1234}
        selectedCount={0}
        canExportAll
        unit="people"
        onExportAll={onExportAll}
        onExportSelected={onExportSelected}
        {...props}
      />
    </RegionConfigProvider>,
    { locale },
  );
  return { ...result, onExportAll, onExportSelected };
}

describe('ExportMenu', () => {
  it('shows one button that says what it downloads and how many, and is axe clean', async () => {
    const { container } = renderMenu();
    const button = await screen.findByRole('button', { name: /Download to Excel/ });
    expect(button.textContent).toContain('1,234 people');
    await expect(container).toHaveNoViolations();
  });

  it('downloads everything as Excel in one click, without opening the menu', async () => {
    const { user, onExportAll } = renderMenu();
    await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
    expect(onExportAll).toHaveBeenCalledExactlyOnceWith('xlsx');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the CSV for other software from the arrow, and the menu is axe clean', async () => {
    const { user, onExportAll, baseElement } = renderMenu();
    await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
    await expect(baseElement).toHaveNoViolations();
    await user.click(await screen.findByRole('menuitem', { name: 'For other software (CSV)' }));
    expect(onExportAll).toHaveBeenCalledExactlyOnceWith('csv');
  });

  it('shows the ticked-rows item only when rows are ticked, and runs it', async () => {
    const { user, onExportSelected, rerender } = renderMenu({ selectedCount: 0 });
    await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
    expect(screen.queryByRole('menuitem', { name: /you ticked/ })).toBeNull();
    await user.keyboard('{Escape}');
    rerender(
      <RegionConfigProvider value={REGION_BD_EN}>
        <ExportMenu
          totalCount={1234}
          selectedCount={3}
          canExportAll
          onExportAll={() => Promise.resolve()}
          onExportSelected={onExportSelected}
        />
      </RegionConfigProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'More ways to download' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Only the 3 you ticked' }));
    expect(onExportSelected).toHaveBeenCalledTimes(1);
  });

  it('hides every "everything" item without permission, keeping the ticked-rows download', async () => {
    const { user, onExportSelected } = renderMenu({ canExportAll: false, selectedCount: 2 });
    expect(screen.queryByRole('button', { name: /Download to Excel/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More ways to download' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Only the 2 you ticked' }));
    expect(onExportSelected).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without permission and without ticked rows', () => {
    const { container } = renderMenu({ canExportAll: false, selectedCount: 0 });
    expect(container.textContent).toBe('');
  });

  it('shows counts in Bangla digits with grouping under bn', async () => {
    renderMenu({ selectedCount: 3 }, 'bn');
    const button = await screen.findByRole('button', { name: /Excel-এ নামান/ });
    expect(button.textContent).toContain('১,২৩৪ জন');
    expect(button.textContent).not.toMatch(/[0-9]/);
  });

  it('writes the ticked count in Bangla digits under bn', async () => {
    const { user } = renderMenu({ selectedCount: 3 }, 'bn');
    await user.click(await screen.findByRole('button', { name: 'আরও নামানোর উপায়' }));
    expect(
      await screen.findByRole('menuitem', { name: 'যে ৩টি বেছেছেন শুধু সেগুলো' }),
    ).toBeTruthy();
  });

  it('counts things, not people, for a list of items', async () => {
    renderMenu({ unit: 'items', totalCount: 1 });
    expect(
      (await screen.findByRole('button', { name: /Download to Excel/ })).textContent,
    ).toContain('1 item');
  });

  it('disables the downloads when nothing matches', async () => {
    renderMenu({ totalCount: 0 });
    const button = await screen.findByRole('button', { name: /Download to Excel/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the narrow-by-class sentence inline when the file is too large', async () => {
    const tooLarge = Object.assign(new Error('x'), { code: 'EXPORT_TOO_LARGE', rows: 5000 });
    const { user } = renderMenu({
      totalCount: 12400,
      narrowByClass: true,
      onExportAll: () => Promise.reject(tooLarge),
    });
    await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot download more than 5,000 people at once yet. Narrow it by class or section.',
    );
  });

  it("recognises the hooks' real ExportTooLargeError, by its code and row cap", async () => {
    const { user } = renderMenu({
      narrowByClass: true,
      onExportAll: () => Promise.reject(new ExportTooLargeError(5000)),
    });
    await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot download more than 5,000 people at once yet. Narrow it by class or section.',
    );
  });

  it.each([
    ['people', 'Cannot download more than 5,000 people at once yet. Narrow the filters.'],
    ['items', 'Cannot download more than 5,000 items at once yet. Narrow the filters.'],
  ] as const)('says "narrow the filters" for %s without a class filter', async (unit, text) => {
    const { user } = renderMenu({
      unit,
      onExportAll: () =>
        Promise.reject(Object.assign(new Error('x'), { code: 'EXPORT_TOO_LARGE' })),
    });
    await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(text);
  });

  it('shows a retry sentence for any other failure, and clears it on the next try', async () => {
    const onExportAll = vi
      .fn<ExportMenuProps['onExportAll']>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const { user } = renderMenu({ onExportAll });
    await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The file could not be downloaded. Try again.',
    );
    await user.click(screen.getByRole('button', { name: /Download to Excel/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('sends one request however fast it is double-clicked', async () => {
    let resolve: () => void = () => undefined;
    const onExportAll = vi.fn<ExportMenuProps['onExportAll']>(
      () => new Promise<void>((r) => (resolve = r)),
    );
    const { user } = renderMenu({ onExportAll });
    const button = await screen.findByRole('button', { name: /Download to Excel/ });
    await user.dblClick(button);
    expect(onExportAll).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    resolve();
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBeNull());
  });

  describe('keep as a report [8.15.52]', () => {
    it('shows no such item without the prop', async () => {
      const { user } = renderMenu();
      await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
      await screen.findByRole('menu');
      expect(screen.queryByRole('menuitem', { name: 'Keep this as a report' })).toBeNull();
    });

    it('adds the item to the arrow menu, below the CSV, and calls the handler once', async () => {
      const onKeepAsReport = vi.fn();
      const { user, baseElement } = renderMenu({ onKeepAsReport });
      await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
      await expect(baseElement).toHaveNoViolations();
      const items = await screen.findAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual([
        'For other software (CSV)',
        'Keep this as a report',
      ]);
      await user.click(items[1]!);
      expect(onKeepAsReport).toHaveBeenCalledTimes(1);
    });

    it('is operable from the keyboard in the arrow menu', async () => {
      const onKeepAsReport = vi.fn();
      const { user } = renderMenu({ onKeepAsReport });
      screen.getByRole('button', { name: 'More ways to download' }).focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('menu');
      await user.keyboard('{ArrowDown}{Enter}');
      expect(onKeepAsReport).toHaveBeenCalledTimes(1);
    });

    it('stays reachable without the download permission (the overdue-only dues view)', async () => {
      const onKeepAsReport = vi.fn();
      const { user, container } = renderMenu({ canExportAll: false, onKeepAsReport });
      expect(screen.queryByRole('button', { name: /Download to Excel/ })).toBeNull();
      await expect(container).toHaveNoViolations();
      await user.click(await screen.findByRole('button', { name: 'Keep this as a report' }));
      expect(onKeepAsReport).toHaveBeenCalledTimes(1);
    });

    it('sits beside the ticked-rows download when both are all there is', async () => {
      const { onExportSelected } = renderMenu({
        canExportAll: false,
        selectedCount: 2,
        onKeepAsReport: () => undefined,
      });
      expect(await screen.findByRole('button', { name: 'Only the 2 you ticked' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Keep this as a report' })).toBeTruthy();
      expect(onExportSelected).not.toHaveBeenCalled();
    });

    it('says it in Bangla under bn', async () => {
      renderMenu({ canExportAll: false, onKeepAsReport: () => undefined }, 'bn');
      expect(await screen.findByRole('button', { name: 'রিপোর্ট হিসেবে রাখুন' })).toBeTruthy();
    });
  });

  it('is reachable and operable from the keyboard', async () => {
    const { onExportAll } = renderMenu();
    const button = await screen.findByRole('button', { name: /Download to Excel/ });
    await expectKeyboardOperable(button, { keys: ['Enter', 'Space'] });
    expect(onExportAll).toHaveBeenCalled();
  });

  it('opens the arrow menu with the keyboard and picks an item with Enter', async () => {
    const { user, onExportAll } = renderMenu();
    screen.getByRole('button', { name: 'More ways to download' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Enter}');
    expect(onExportAll).toHaveBeenCalledExactlyOnceWith('csv');
  });
});

describe('ExportMenu (?) help', () => {
  const index: HelpIndex = {
    'reports.hub.action.downloadExcel': {
      title: { bn: 'সব রিপোর্ট', en: 'All reports' },
      summary: { bn: 'Excel-এ নামান', en: 'Download to Excel' },
      path: 'reports/hub',
      anchor: 'task-download',
      knownIssues: 0,
    },
  };
  const withIndex = (props: Partial<ExportMenuProps>) =>
    renderWithProviders(
      <HelpProvider index={index} lang="en" baseUrl="https://guide.test">
        <ExportMenu
          totalCount={5}
          canExportAll
          onExportAll={() => Promise.resolve()}
          helpId="reports.hub.action.downloadExcel"
          {...props}
        />
      </HelpProvider>,
      { locale: 'en' },
    );

  it('puts a (?) right after the download button when the id resolves', async () => {
    const { container } = withIndex({});
    await screen.findByRole('button', { name: 'Help: All reports' });
    const hint = container.querySelector('[data-help-id="reports.hub.action.downloadExcel"]');
    const group = container.querySelector('[role="group"]');
    expect(hint).not.toBeNull();
    expect(group?.nextElementSibling).toBe(hint);
  });

  it('shows no (?) without permission to download, so none is left alone', () => {
    const { container } = withIndex({ canExportAll: false, onKeepAsReport: () => undefined });
    expect(container.querySelector('[data-help-id]')).toBeNull();
  });

  it('keeps its DOM when no (?) resolves', () => {
    const { container } = renderMenu({ helpId: 'reports.hub.action.downloadExcel' });
    expect(container.querySelector('[data-help-id]')).toBeNull();
    expect(container.querySelector('[role="group"]')?.parentElement?.className).toContain(
      'flex-col',
    );
  });
});
