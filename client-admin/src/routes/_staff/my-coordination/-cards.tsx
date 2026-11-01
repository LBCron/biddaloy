/**
 * [83.4.1] One card per coordinated class (or class + subject), three blocks (Epic 83 D22–D24):
 * Today's attendance (one 44 px row per section, links to the register), Marks pending
 * (links to the grid, read-only for a coordinator) and Teachers. The server already filters a
 * subject coordinator's grids and teachers to their subject.
 */
import { Button, StatusBadge } from '@biddaloy/ui/components';
import type { CoordinationClass } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, MegaphoneIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const ROW =
  'flex min-h-11 items-center gap-3 px-4 py-2 no-underline hover:bg-muted focus-visible:bg-muted md:px-5';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle">
      <h3 className="px-4 pt-3 pb-1 text-label text-text-secondary md:px-5">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-3 text-text-secondary md:px-5">{children}</p>;
}

export function ClassCard({
  cls,
  date,
  onNotify,
}: {
  cls: CoordinationClass;
  date: string;
  onNotify?: (() => void) | undefined;
}) {
  const { t } = useTranslation('coordination');
  const kind = cls.subject_id ? 'subjectCoordinator' : 'classCoordinator';

  return (
    <article
      aria-labelledby={`coord-${cls.class_id}-${cls.subject_id ?? 'all'}`}
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 p-4 md:px-5">
        <div className="min-w-0">
          <h2 id={`coord-${cls.class_id}-${cls.subject_id ?? 'all'}`} className="text-h2">
            {cls.class_name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-text-secondary">
            <StatusBadge tone={cls.subject_id ? 'info' : 'success'} label={t(`kinds.${kind}`)} />
            {cls.subject_name && <span>{t('cardSubject', { subject: cls.subject_name })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/students"
            search={{ class_id: cls.class_id }}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t('seeStudents')}
          </Link>
          {onNotify && cls.teachers.length > 0 && (
            <Button type="button" variant="outline" onClick={onNotify}>
              <MegaphoneIcon aria-hidden="true" />
              {t('notify')}
            </Button>
          )}
        </div>
      </header>

      <Block title={t('blocks.todayAttendance')}>
        {cls.sections.length === 0 ? (
          <Empty>{t('blockEmpty.todayAttendance')}</Empty>
        ) : (
          <ul>
            {cls.sections.map((s) => (
              <li key={s.section_id}>
                <Link
                  to="/attendance/$sectionId"
                  params={{ sectionId: s.section_id }}
                  search={{ date }}
                  className={ROW}
                >
                  <span className="w-16 shrink-0 font-medium">{s.section_name}</span>
                  <StatusBadge
                    tone={s.attendance_taken ? 'success' : 'warning'}
                    label={t(s.attendance_taken ? 'rows.taken' : 'rows.notTaken')}
                  />
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    {s.attendance_taken && s.taken_by_name
                      ? t('rows.byWhom', { name: s.taken_by_name })
                      : s.class_teacher_name
                        ? t('rows.classTeacher', { name: s.class_teacher_name })
                        : t('rows.noClassTeacher')}
                  </span>
                  <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('blocks.marksPending')}>
        {cls.pending_grids.length === 0 ? (
          <Empty>{t('blockEmpty.marksPending')}</Empty>
        ) : (
          <ul>
            {cls.pending_grids.map((g) => (
              <li key={`${g.exam_id}-${g.section_id}-${g.subject_id}`}>
                <Link
                  to="/marks/$examId/$sectionId/$subjectId"
                  params={{ examId: g.exam_id, sectionId: g.section_id, subjectId: g.subject_id }}
                  className={ROW}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {t('rows.gridLine', {
                        exam: g.exam_name,
                        subject: g.subject_name ?? '—',
                        section: g.section_name,
                      })}
                    </span>
                    <span className="block truncate text-caption text-text-secondary">
                      {g.teacher_name ?? t('rows.noTeacher')}
                    </span>
                  </span>
                  <StatusBadge tone="warning" label={t('rows.pending')} />
                  <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('blocks.teachers')}>
        {cls.teachers.length === 0 ? (
          <Empty>{t('blockEmpty.teachers')}</Empty>
        ) : (
          <ul className="pb-2">
            {cls.teachers.map((teacher) => (
              <li
                key={teacher.user_id}
                className="flex min-h-11 flex-col justify-center px-4 md:px-5"
              >
                <span className="font-medium">{teacher.full_name}</span>
                <span className="text-caption text-text-secondary">
                  {t('rows.teacherLine', {
                    sections: teacher.section_names.join(', '),
                    subjects: teacher.subject_names.join(', ') || '—',
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </article>
  );
}
