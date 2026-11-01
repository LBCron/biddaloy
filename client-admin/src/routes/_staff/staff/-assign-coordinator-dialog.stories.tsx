import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { AssignCoordinatorDialog } from './-assign-coordinator-dialog';

/** [83.3.3] "Assign coordinator": empty, prefilled teacher, and a duplicate error on Save. */
const paged = <T,>(data: T[]) => ({ data, total: data.length, page: 1, limit: 100, totalPages: 1 });
const reference = [
  http.get('/api/v1/teachers', () =>
    HttpResponse.json(
      paged([
        {
          id: 'teacher-1',
          employee_id: 'EMP-001',
          user: { id: 'u1', full_name: 'Rahim Uddin' },
        },
      ]),
    ),
  ),
  http.get('/api/v1/classes', () =>
    HttpResponse.json(
      paged([
        { id: 'k6', name: 'Class 6' },
        { id: 'k7', name: 'Class 7' },
        { id: 'k8', name: 'Class 8' },
      ]),
    ),
  ),
  http.get('/api/v1/subjects', () =>
    HttpResponse.json(paged([{ id: 'm1', name_en: 'Mathematics', name_bn: 'গণিত', code: 'MATH' }])),
  ),
];

const meta: Meta<typeof AssignCoordinatorDialog> = {
  title: 'Staff/AssignCoordinatorDialog',
  component: AssignCoordinatorDialog,
  args: { open: true, onOpenChange: () => undefined },
  parameters: { msw: { handlers: reference } },
};
export default meta;
type Story = StoryObj<typeof AssignCoordinatorDialog>;

export const Empty: Story = {};

export const Filled: Story = { args: { teacherId: 'teacher-1' } };

export const DuplicateError: Story = {
  args: { teacherId: 'teacher-1' },
  parameters: {
    msw: {
      handlers: [
        ...reference,
        http.post('/api/v1/coordinators', () =>
          HttpResponse.json(
            { statusCode: 409, message: 'This coordinator assignment already exists.' },
            { status: 409 },
          ),
        ),
      ],
    },
  },
};
