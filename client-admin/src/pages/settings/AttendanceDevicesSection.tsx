/**
 * [76.5.02] Settings › Attendance machines (D10, D23). Add a machine, copy its
 * secret key once, see when it last reported, rotate or revoke it. Takes no
 * props (a device belongs to the caller's own school) and hides itself without
 * `ATTENDANCE_DEVICE_MANAGE`.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useAttendanceDevices, useHasPermission, type AttendanceDevice } from '@biddaloy/ui/hooks';
import { useRegionConfig } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';

import { useSectionOptions } from '../../features/attention/use-section-options';

import {
  AddDeviceDialog,
  KIND_FALLBACK,
  RevokeDeviceDialog,
  RotateDeviceDialog,
  useDeviceText,
} from './attendance-device-dialog';
import { SettingsSection } from './settings-layout';

export interface AttendanceDevicesSectionProps {
  /** `?devices=new` (palette action): open the add dialog on arrival. */
  openAdd?: boolean;
}

export function AttendanceDevicesSection({ openAdd = false }: AttendanceDevicesSectionProps) {
  const d = useDeviceText();
  const canManage = useHasPermission(Permission.ATTENDANCE_DEVICE_MANAGE);
  const regionConfig = useRegionConfig();
  const query = useAttendanceDevices();
  const sectionOptions = useSectionOptions();

  const [adding, setAdding] = React.useState(openAdd);
  React.useEffect(() => {
    if (openAdd) setAdding(true);
  }, [openAdd]);
  const [rotateTarget, setRotateTarget] = React.useState<AttendanceDevice | undefined>();
  const [revokeTarget, setRevokeTarget] = React.useState<AttendanceDevice | undefined>();

  if (!canManage) return null;

  const devices = (query.data ?? []).filter((x) => x.status === 'ACTIVE');
  const sectionLabel = (id: string | null) =>
    id === null
      ? d('wholeSchool', 'Whole school')
      : (sectionOptions.find((o) => o.value === id)?.label ?? '—');

  const columns: DataTableColumn<AttendanceDevice>[] = [
    { id: 'name', header: d('columns.name', 'Name'), accessorFn: (x) => x.name, card: 'title' },
    {
      id: 'kind',
      header: d('columns.kind', 'Kind'),
      accessorFn: (x) => d(`kind.${x.kind}`, KIND_FALLBACK[x.kind]),
      card: 'subtitle',
    },
    {
      id: 'section',
      header: d('columns.section', 'Section'),
      accessorFn: (x) => sectionLabel(x.section_id),
      card: 'field',
    },
    {
      id: 'lastSeen',
      header: d('columns.lastSeen', 'Last seen'),
      accessorFn: (x) =>
        x.last_seen_at === null
          ? d('never', 'Never')
          : formatDateTime(x.last_seen_at, regionConfig),
      card: 'field',
    },
    {
      id: 'status',
      header: d('columns.status', 'Status'),
      accessorFn: () => d('status.ACTIVE', 'Active'),
      card: 'field',
    },
  ];

  return (
    <SettingsSection
      id="attendance-devices-section"
      title={d('title', 'Attendance machines')}
      description={d(
        'explainer',
        'Fingerprint, face or card machines that send attendance to the school.',
      )}
      actions={
        devices.length > 0 ? (
          <Button type="button" className="w-full md:w-auto" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden="true" />
            {d('add.button', 'Add machine')}
          </Button>
        ) : undefined
      }
    >
      <div className="mt-4">
        {query.isError ? (
          <ErrorState
            message={d('loadError', 'Could not load the machines.')}
            onRetry={() => void query.refetch()}
          />
        ) : devices.length === 0 && !query.isPending ? (
          <EmptyState
            title={d('empty.title', 'No attendance machine yet')}
            explanation={d('empty.explanation', 'Add one to let it fill the daily register.')}
            action={{ label: d('add.button', 'Add machine'), onClick: () => setAdding(true) }}
          />
        ) : (
          <DataTable
            tableId="attendance-devices"
            caption={d('listCaption', 'Attendance machines')}
            paginated={false}
            data={devices}
            totalCount={devices.length}
            getRowId={(x) => x.id}
            sorting={null}
            onSortingChange={() => undefined}
            loading={query.isPending}
            columns={columns}
            // ponytail: no 'rotate'/'revoke' intents exist; 'restore' (refresh) and 'remove' are the closest icons.
            rowActions={(x) => [
              {
                intent: 'restore',
                label: d('rotate.action', 'Make new key'),
                onClick: () => setRotateTarget(x),
              },
              {
                intent: 'remove',
                label: d('revoke.action', 'Revoke'),
                onClick: () => setRevokeTarget(x),
              },
            ]}
          />
        )}
      </div>

      <AddDeviceDialog open={adding} onOpenChange={setAdding} />
      {rotateTarget ? (
        <RotateDeviceDialog
          key={rotateTarget.id}
          device={rotateTarget}
          onClose={() => setRotateTarget(undefined)}
        />
      ) : null}
      {revokeTarget ? (
        <RevokeDeviceDialog
          key={revokeTarget.id}
          device={revokeTarget}
          onClose={() => setRevokeTarget(undefined)}
        />
      ) : null}
    </SettingsSection>
  );
}
