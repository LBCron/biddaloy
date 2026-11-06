import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { AttendanceDevice } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { AttendanceDevicesSection } from './AttendanceDevicesSection';

/** [76.5.02] Settings › Attendance machines. Needs ATTENDANCE_DEVICE_MANAGE, so the loader sets ADMIN. */
const device = (over: Partial<AttendanceDevice>): AttendanceDevice => ({
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

const withDevices = (rows: AttendanceDevice[]) => ({
  msw: { handlers: [http.get('/api/v1/attendance/devices', () => HttpResponse.json(rows))] },
});

const meta: Meta<typeof AttendanceDevicesSection> = {
  title: 'Settings/AttendanceDevices',
  component: AttendanceDevicesSection,
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof AttendanceDevicesSection>;

export const Empty: Story = { parameters: withDevices([]) };

export const TwoMachines: Story = {
  parameters: withDevices([
    device({}),
    device({
      id: 'd-2',
      name: 'Library card reader',
      kind: 'RFID',
      last_seen_at: '2026-11-05T08:30:00.000Z',
    }),
  ]),
};

export const AddDialogOpen: Story = {
  args: { openAdd: true },
  parameters: withDevices([device({})]),
};
