import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HomeworkAssignmentStatus,
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
} from '@biddaloy/shared';
import { HomeworkAnalyticsService } from './homework-analytics.service';

const TENANT_ID = 'tenant-1';
const S = HomeworkSubmissionStatus;

function makeRepo(rows: unknown[]) {
  return { find: vi.fn().mockResolvedValue(rows) } as any;
}

describe('HomeworkAnalyticsService', () => {
  let assignmentRepo: any;
  let submissionRepo: any;
  let syllabusRepo: any;
  // The roster SQL (`rosterCounts`): one { assignment_id, total, completed } per assignment.
  let rosterQuery: ReturnType<typeof vi.fn>;
  let service: HomeworkAnalyticsService;

  beforeEach(() => {
    assignmentRepo = makeRepo([]);
    rosterQuery = vi.fn().mockResolvedValue([]);
    submissionRepo = { manager: { query: rosterQuery } };
    syllabusRepo = makeRepo([]);
    service = new HomeworkAnalyticsService(assignmentRepo, submissionRepo, syllabusRepo, {
      expectedForTeacher: async () => new Map(),
    } as any);
  });

  describe('getStudentRollup', () => {
    it('2 submitted, 1 defaulter (past due, not submitted) -> 66% completion', async () => {
      rosterQuery.mockResolvedValue([
        { assignment_id: 'a1', total: 1, completed: 1 },
        { assignment_id: 'a2', total: 1, completed: 1 },
        { assignment_id: 'a3', total: 1, completed: 0 },
      ]);
      assignmentRepo.find.mockResolvedValue([
        { id: 'a1', due_date: '2020-06-01' },
        { id: 'a2', due_date: '2020-06-01' },
        { id: 'a3', due_date: '2020-06-01' }, // due date already passed
      ]);

      const rollup = await service.getStudentRollup('student-1', TENANT_ID, 'UTC');

      expect(rollup).toEqual({
        totalAssignments: 3,
        completed: 2,
        defaulters: 1,
        completionPercent: 66,
      });
      // The roster query is narrowed to this one student, pads only homework due by today, and
      // counts COMPLETE_STATUSES as completed.
      const params = rosterQuery.mock.calls[0][1];
      expect(params.slice(0, 3)).toEqual([TENANT_ID, null, 'student-1']);
      expect(params[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params[4]).toEqual([S.SUBMITTED, S.PARTIAL, S.DONE]);
    });

    it('no assignments -> 0% completion, no division by zero', async () => {
      const rollup = await service.getStudentRollup('student-1', TENANT_ID);
      expect(rollup).toEqual({
        totalAssignments: 0,
        completed: 0,
        defaulters: 0,
        completionPercent: 0,
      });
      expect(assignmentRepo.find).not.toHaveBeenCalled();
    });

    it('not-yet-due, not-submitted is neither completed nor a defaulter', async () => {
      rosterQuery.mockResolvedValue([{ assignment_id: 'a1', total: 1, completed: 0 }]);
      assignmentRepo.find.mockResolvedValue([{ id: 'a1', due_date: '2999-01-01' }]);
      const rollup = await service.getStudentRollup('student-1', TENANT_ID);
      expect(rollup.completed).toBe(0);
      expect(rollup.defaulters).toBe(0);
      expect(rollup.completionPercent).toBe(0);
    });
  });

  describe('getSectionRollup', () => {
    it('rolls up the roster across every assignment targeting the section', async () => {
      assignmentRepo.find.mockResolvedValue([
        { id: 'a1', due_date: '2020-01-01', status: HomeworkAssignmentStatus.ACTIVE },
      ]);
      rosterQuery.mockResolvedValue([{ assignment_id: 'a1', total: 1, completed: 1 }]);
      const rollup = await service.getSectionRollup('section-1', TENANT_ID);
      expect(rollup.totalAssignments).toBe(1);
      expect(rollup.completed).toBe(1);
      expect(rollup.completionPercent).toBe(100);
    });

    // #3171: 3 students on the section, only one graded. The other two have no row yet but
    // are on the roster, so the rate is 1 of 3, not 1 of 1.
    it('students without a row still count in the denominator', async () => {
      assignmentRepo.find.mockResolvedValue([{ id: 'a1', due_date: '2020-01-01' }]);
      rosterQuery.mockResolvedValue([{ assignment_id: 'a1', total: 3, completed: 1 }]);
      const rollup = await service.getSectionRollup('section-1', TENANT_ID);
      expect(rollup).toEqual({
        totalAssignments: 3,
        completed: 1,
        defaulters: 2,
        completionPercent: 33,
      });
    });

    it('no assignments for the section -> zeroed rollup, no roster query', async () => {
      const rollup = await service.getSectionRollup('section-1', TENANT_ID);
      expect(rollup).toEqual({
        totalAssignments: 0,
        completed: 0,
        defaulters: 0,
        completionPercent: 0,
      });
      expect(rosterQuery).not.toHaveBeenCalled();
    });
  });

  describe('getClassRollup', () => {
    it('adds a syllabus completion percent (D29) alongside the homework rollup', async () => {
      assignmentRepo.find.mockResolvedValue([
        { id: 'a1', due_date: '2020-01-01', homework: { class_id: 'class-1' } },
      ]);
      rosterQuery.mockResolvedValue([{ assignment_id: 'a1', total: 1, completed: 1 }]);
      syllabusRepo.find.mockResolvedValue([
        { status: SyllabusTopicStatus.DONE },
        { status: SyllabusTopicStatus.DONE },
        { status: SyllabusTopicStatus.PLANNED },
      ]);

      const rollup = await service.getClassRollup('class-1', TENANT_ID);

      expect(rollup.completionPercent).toBe(100);
      expect(rollup.syllabus).toEqual({ totalTopics: 3, done: 2, completionPercent: 66 });
    });
  });
});
