import type { Meta, StoryObj } from '@storybook/react-vite';

import { AttendanceSection } from './AttendanceSection';

/**
 * Attendance policy settings card, focused on the "Who marks daily
 * attendance" radio (76.5.01). Same "client-admin isn't globbed into a
 * running Storybook yet" gap the sibling section stories note.
 */
const meta: Meta<typeof AttendanceSection> = {
  component: AttendanceSection,
  args: { schoolId: 'school-1' },
};
export default meta;

type Story = StoryObj<typeof AttendanceSection>;

const BASE = {
  weeklyOffDays: [5],
  lateAfter: '09:00',
  absentAfter: '09:30',
  correctionWindowDays: 3,
  lowAttendanceThresholdPercent: 75,
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: true,
  allowFutureDates: false,
  percentageDenominator: 'WORKING_DAYS' as const,
  autoAbsentNotification: { enabled: false, cutoffTime: '10:00' },
};

export const AnyTeacher: Story = { args: { attendance: { ...BASE, dailySource: 'ANY' } } };
export const ClassTeacher: Story = {
  args: { attendance: { ...BASE, dailySource: 'CLASS_TEACHER' } },
};
export const FirstPeriod: Story = {
  args: { attendance: { ...BASE, dailySource: 'FIRST_PERIOD' } },
};
export const Device: Story = { args: { attendance: { ...BASE, dailySource: 'DEVICE' } } };
