import '@biddaloy/ui/test';

import type { AttendanceDevice } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { AttendanceDevicesSection } from './AttendanceDevicesSection';

const device = (over: Partial<AttendanceDevice> = {}): AttendanceDevice => ({
  id: 'd-1',
  name: 'Gate machine',
  kind: 'BIOMETRIC',
  token_last4: 'ab12',
  section_id: null,
  roster_access: false,
  status: 'ACTIVE',
  last_seen_at: null,
  ...over,
});

const list = (rows: AttendanceDevice[]) => {
  server.use(
    http.get('/api/v1/attendance/devices', () => HttpResponse.json(rows)),
    http.get('/api/v1/classes', () => HttpResponse.json({ data: [], total: 0 })),
  );
};

const render = (props: { openAdd?: boolean } = {}, role = 'ADMIN') =>
  renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <AttendanceDevicesSection {...props} />
    </RegionConfigProvider>,
    { locale: 'en', role, tenantId: 'school-1' },
  );

describe('AttendanceDevicesSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists a machine with last seen "Never" and whole school', async () => {
    list([device()]);
    render();
    await waitFor(() => expect(screen.getByText('Gate machine')).toBeTruthy());
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.getByText('Whole school')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    list([]);
    render();
    await waitFor(() => expect(screen.getByText('No attendance machine yet')).toBeTruthy());
  });

  it('add shows the key once, and not again after close', async () => {
    list([]);
    server.use(
      http.post('/api/v1/attendance/devices', () =>
        HttpResponse.json({ device: device(), key: 'secret-key-1' }, { status: 201 }),
      ),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('No attendance machine yet')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Add machine' }));
    await user.type(screen.getByLabelText('Name'), 'Gate machine');
    await user.click(screen.getByRole('button', { name: 'Add machine', hidden: false }));
    await waitFor(() => expect(screen.getByDisplayValue('secret-key-1')).toBeTruthy());

    // Closing without copying asks first; the key stays until confirmed.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Yes, I copied it' }));
    await waitFor(() => expect(screen.queryByDisplayValue('secret-key-1')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Add machine' }));
    expect(screen.queryByDisplayValue('secret-key-1')).toBeNull();
  });

  it('rotate shows a new key', async () => {
    list([device()]);
    server.use(
      http.post('/api/v1/attendance/devices/d-1/rotate', () =>
        HttpResponse.json({ device: device(), key: 'rotated-key-2' }),
      ),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Gate machine')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Make new key' }));
    await user.click(screen.getByRole('button', { name: 'Make new key', hidden: false }));
    await waitFor(() => expect(screen.getByDisplayValue('rotated-key-2')).toBeTruthy());
  });

  it('revoke confirms, then the machine leaves the list', async () => {
    let revoked = false;
    server.use(
      http.get('/api/v1/attendance/devices', () =>
        HttpResponse.json(revoked ? [device({ status: 'REVOKED' })] : [device()]),
      ),
      http.get('/api/v1/classes', () => HttpResponse.json({ data: [], total: 0 })),
      http.delete('/api/v1/attendance/devices/d-1', () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Gate machine')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByText('Revoke this machine?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Revoke', hidden: false }));
    await waitFor(() => expect(screen.queryByText('Gate machine')).toBeNull());
  });

  it('opens the add dialog when arriving with ?devices=new', async () => {
    list([device()]);
    render({ openAdd: true });
    await waitFor(() => expect(screen.getByText('Add attendance machine')).toBeTruthy());
  });

  it('renders nothing and sends no request without the permission', async () => {
    let requested = false;
    server.use(
      http.get('/api/v1/attendance/devices', () => {
        requested = true;
        return HttpResponse.json([device()]);
      }),
      http.get('/api/v1/classes', () => HttpResponse.json({ data: [], total: 0 })),
    );
    const { container } = render({}, 'TEACHER');
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe('');
    expect(requested).toBe(false);
  });
});
