/**
 * [21.9.1] D11: the builder's change-request queue. Accepting or
 * rejecting a request never edits the routine — the copy says so
 * explicitly, because the actual grid edit (if any) usually reshuffles
 * other slots too and is done deliberately through the grid builder
 * (`$sectionId.tsx`), not as a side effect of this list.
 *
 * [31.4] A compact `DataTable`; accept/reject open one small dialog that
 * holds the optional note, instead of a textarea per row.
 */
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelpHint,
  Label,
  Textarea,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useResolveChangeRequest, type RoutineChangeRequest } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface ChangeRequestSlotDescription {
  when: string;
  what: string;
  section: string;
}

export interface ChangeRequestListProps {
  routineId: string;
  requests: RoutineChangeRequest[];
  describeSlot: (slotId: string) => ChangeRequestSlotDescription;
  requesterLabel: (userId: string) => string;
}

export function ChangeRequestList({
  routineId,
  requests,
  describeSlot,
  requesterLabel,
}: ChangeRequestListProps) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const resolve = useResolveChangeRequest(routineId);
  const [resolving, setResolving] = React.useState<{
    request: RoutineChangeRequest;
    state: 'ACCEPTED' | 'REJECTED';
  } | null>(null);
  const [note, setNote] = React.useState('');

  const open = requests.filter((request) => request.state === 'OPEN');

  function close() {
    setResolving(null);
    setNote('');
  }

  function handleResolve() {
    if (!resolving) return;
    const trimmed = note.trim();
    const { request, state } = resolving;
    resolve.mutate(
      { id: request.id, input: trimmed ? { state, resolution_note: trimmed } : { state } },
      {
        onSuccess: () => {
          toast.success(t('changeRequestList.resolvedToast'));
          close();
        },
        onError: () => toast.error(t('changeRequestList.errorToast')),
      },
    );
  }

  const columns: DataTableColumn<RoutineChangeRequest>[] = [
    {
      id: 'period',
      header: t('changeRequestList.periodColumn'),
      card: 'title',
      accessorFn: (request) => {
        const slot = describeSlot(request.routine_slot_id);
        return (
          <>
            <span className="font-medium">{slot.when}</span>
            <span className="block text-caption text-text-secondary">{slot.what}</span>
          </>
        );
      },
    },
    {
      id: 'section',
      header: t('changeRequestList.sectionColumn'),
      card: 'subtitle',
      accessorFn: (request) => describeSlot(request.routine_slot_id).section,
    },
    {
      id: 'requester',
      header: t('changeRequestList.requesterColumn'),
      card: 'field',
      accessorFn: (request) => (
        <>
          {requesterLabel(request.requested_by)}
          <span className="block text-caption text-text-secondary">
            {formatDate(request.created_at, config)}
          </span>
        </>
      ),
    },
    {
      id: 'note',
      header: t('changeRequestList.noteColumn'),
      card: 'field',
      accessorFn: (request) => request.note,
    },
  ];

  const resolvingSlot = resolving ? describeSlot(resolving.request.routine_slot_id) : null;

  return (
    <>
      <DataTable
        tableId="routine-change-requests"
        caption={t('changeRequestList.caption')}
        columns={columns}
        data={open}
        getRowId={(request) => request.id}
        sorting={null}
        onSortingChange={() => {}}
        paginated={false}
        totalCount={open.length}
        rowActions={(request) => [
          {
            intent: 'approve',
            label: t('changeRequestList.accept'),
            onClick: () => setResolving({ request, state: 'ACCEPTED' }),
          },
          {
            intent: 'reject',
            label: t('changeRequestList.reject'),
            onClick: () => setResolving({ request, state: 'REJECTED' }),
          },
        ]}
        emptyState={{
          title: t('changeRequestList.emptyTitle'),
          explanation: t('changeRequestList.empty'),
        }}
      />

      <Dialog open={resolving !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent size="sm">
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>
                {resolving?.state === 'REJECTED'
                  ? t('changeRequestList.rejectTitle')
                  : t('changeRequestList.acceptTitle')}
              </DialogTitle>
              <HelpHint helpId="academics.routineReview.action.resolveRequest" />
            </div>
            <DialogDescription>
              {resolving && resolvingSlot
                ? t('changeRequestList.resolveDescription', {
                    slot: `${resolvingSlot.when} · ${resolvingSlot.what}`,
                    name: requesterLabel(resolving.request.requested_by),
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="change-request-resolution-note">
              {t('changeRequestList.resolutionNoteLabel')}
            </Label>
            <Textarea
              id="change-request-resolution-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('changeRequestList.cancel')}
            </Button>
            <Button type="button" loading={resolve.isPending} onClick={handleResolve}>
              {resolving?.state === 'REJECTED'
                ? t('changeRequestList.reject')
                : t('changeRequestList.accept')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
