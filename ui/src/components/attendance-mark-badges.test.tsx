import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RegionConfigProvider } from '../i18n';
import { REGION_BD_EN } from '../i18n/region-config';
import { renderWithProviders } from '../test';
import { formatTime } from '../utils/date';

import { AttendanceMarkBadges } from './attendance-mark-badges';
import { TooltipProvider } from './tooltip';

const SCANNED = '2026-11-02T01:55:00.000Z';

function renderBadges(props: { scanned_at?: string | null; source?: string | null }) {
  return renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <TooltipProvider>
        <div data-testid="box">
          <AttendanceMarkBadges
            {...props}
            scannedLabel={(time) => `Scanned ${time}`}
            scannedHint="A card reader marked this row"
            fromSheetLabel="From sheet"
            fromSheetHint="Uploaded from a sheet"
          />
        </div>
      </TooltipProvider>
    </RegionConfigProvider>,
    { locale: 'en' },
  );
}

describe('AttendanceMarkBadges', () => {
  it('shows the scanned badge with the time through formatTime, focusable', () => {
    renderBadges({ scanned_at: SCANNED, source: 'MANUAL' });
    const badge = screen.getByText(`Scanned ${formatTime(SCANNED, REGION_BD_EN)}`);
    expect(badge.getAttribute('tabindex')).toBe('0');
    expect(screen.queryByText('From sheet')).toBeNull();
  });

  it('shows the from-sheet badge for source IMPORT', () => {
    renderBadges({ scanned_at: null, source: 'IMPORT' });
    expect(screen.getByText('From sheet').getAttribute('tabindex')).toBe('0');
    expect(screen.queryByText(/Scanned/)).toBeNull();
  });

  it('renders nothing when neither applies', () => {
    renderBadges({ scanned_at: null, source: 'MANUAL' });
    expect(screen.getByTestId('box').childElementCount).toBe(0);
  });
});
