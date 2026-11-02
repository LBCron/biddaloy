/**
 * [70.5.3] Setup tab states: draft with two exams, a total that is not 100, best of, and the
 * published (read-only) card. `SetupForm` takes the exams as props; the class's subjects (for
 * the "share per subject" table) come from the MSW handler below.
 */
import type { FinalResultSummary } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';

import { SetupForm } from './-setup-panel';

const exams = [
  { id: 'e1', name: 'Half Yearly', kind: 'TERM' },
  { id: 'e2', name: 'Annual', kind: 'TERM' },
  { id: 'e3', name: 'March Test', kind: 'MONTHLY' },
];

const base: FinalResultSummary = {
  id: 'fr-1',
  class: { id: 'c7', name: 'Class 7' },
  academic_year: { id: 'y1', name: '2026' },
  status: 'DRAFT',
  mode: 'WEIGHTED',
  best_of_count: null,
  rounding: 'WHOLE',
  fail_if_any_exam_fails: false,
  weights: [
    { exam_id: 'e1', subject_id: null, share_percent: 40 },
    { exam_id: 'e2', subject_id: null, share_percent: 60 },
  ],
  published_at: null,
  counts: { students: 0, failed: 0 },
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const meta = {
  title: 'client-admin/results/final/SetupForm',
  component: SetupForm,
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="p-4">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { summary: base, exams },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/classes/c7/subjects', () =>
          HttpResponse.json([
            {
              id: 'cs1',
              subject_id: 's1',
              subject: { id: 's1', name_en: 'Maths', name_bn: 'গণিত' },
            },
            {
              id: 'cs2',
              subject_id: 's2',
              subject: { id: 's2', name_en: 'English', name_bn: 'ইংরেজি' },
            },
          ]),
        ),
      ],
    },
  },
} satisfies Meta<typeof SetupForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};

/** 40 + 50 = 90: the line turns red and Save is off. */
export const TotalNotHundred: Story = {
  args: {
    summary: {
      ...base,
      weights: [
        { exam_id: 'e1', subject_id: null, share_percent: 40 },
        { exam_id: 'e2', subject_id: null, share_percent: 50 },
      ],
    },
  },
};

export const BestOf: Story = {
  args: { summary: { ...base, mode: 'BEST_OF', best_of_count: 2 } },
};

export const Published: Story = {
  args: { summary: { ...base, status: 'PUBLISHED', published_at: '2026-11-01T10:00:00Z' } },
};

export const NoPublishedExams: Story = { args: { exams: [] } };
