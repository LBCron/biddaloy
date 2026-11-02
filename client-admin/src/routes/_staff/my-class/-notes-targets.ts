/**
 * [70.5.x] What a section's remarks can be written for: the class's final result plus the year's
 * exams. The year is the current one among the class's exams (else the newest exam's), because
 * `/my-class/sections` carries no year.
 */
import { examsQueryOptions, useFinalResults, type ReportCardNotesTarget } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';

export interface NotesTargetOption {
  /** The `?for=` value: an exam id, or `final`. */
  key: string;
  label: string | null;
  target: ReportCardNotesTarget;
  published: boolean;
}

export function useNotesTargets(classId: string | undefined) {
  const exams = useQuery({
    ...examsQueryOptions({ class_id: classId ?? '', limit: 100 }),
    enabled: Boolean(classId),
  });
  const all = exams.data?.data ?? [];
  const newestFirst = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const yearId = (newestFirst.find((e) => e.academic_year?.is_current) ?? newestFirst[0])
    ?.academic_year_id;
  const finals = useFinalResults(yearId);
  const finalItem = finals.data?.find((f) => f.class.id === classId && f.final_result_id);

  const options: NotesTargetOption[] = [];
  if (finalItem?.final_result_id) {
    options.push({
      key: 'final',
      label: null,
      target: { final_result_id: finalItem.final_result_id },
      published: finalItem.status === 'PUBLISHED',
    });
  }
  for (const e of newestFirst.filter((x) => x.academic_year_id === yearId)) {
    options.push({
      key: e.id,
      label: e.name,
      target: { exam_id: e.id },
      published: e.status === 'PUBLISHED',
    });
  }
  return {
    options,
    isPending: !classId || exams.isPending || (yearId !== undefined && finals.isPending),
    // The exam targets stay usable when only the final lookup fails; that one has its own flag.
    isError: exams.isError,
    finalError: !exams.isError && finals.isError,
    refetch: () => {
      void exams.refetch();
      void finals.refetch();
    },
  };
}
