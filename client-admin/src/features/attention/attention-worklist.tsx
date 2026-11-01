/**
 * [67.2.05] The "Alerts & notifications" worklist: a To-do tab (open and
 * closed-for-now items, each with its action) and a History tab (fixed and
 * expired items, plus this device's recent toasts). Shared by the staff route
 * and the portal route (67.2.06); `scope` only changes which filters show.
 */
import { AlertCategory, AlertRecipientState, AlertSeverity, UserRole } from '@biddaloy/shared';
import type { AlertItem } from '@biddaloy/shared';
import { markAllNotificationsRead, markNotificationRead } from '@biddaloy/ui/api';
import {
  AlertSeverityBadge,
  AlertSnoozeMenu,
  AttentionNoticeItem,
  Button,
  Card,
  DataTable,
  NotificationList,
  RowActions,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  NOTICE_IMPORTANT,
  NOTICE_SMS_APPROVAL,
  isNoticeAlert,
  noticeIdOf,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  useActiveRole,
  attentionKeys,
  useAllClasses,
  useAttentionItems,
  useClassSections,
  useHideAttentionItem,
  myStudentsQueryOptions,
  useNotifications,
  useSnoozeAttentionItem,
  useUnreadNotificationCount,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  useListShellState,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon, CheckCheckIcon, InfoIcon } from 'lucide-react';
import * as React from 'react';

import { useAcknowledgeNotice } from '../notices/read/use-my-notices';

export type WorklistTab = 'active' | 'history';

export interface AttentionWorklistProps {
  scope: 'staff' | 'portal';
  tab: WorklistTab;
  onTabChange: (tab: WorklistTab) => void;
}

const CATEGORIES = Object.values(AlertCategory);

export function AttentionWorklist({ scope, tab, onTabChange }: AttentionWorklistProps) {
  const { t } = useTranslation('attention');
  const config = useTenantRegionConfig();
  const role = useActiveRole();
  const [state, actions] = useListShellState();
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  const deviceRef = React.useRef<HTMLDivElement>(null);
  const hide = useHideAttentionItem();
  const snooze = useSnoozeAttentionItem();
  const acknowledge = useAcknowledgeNotice();
  const queryClient = useQueryClient();

  const { category: categoryRaw, class_id, section_id, student_id } = state.filters;
  const category = CATEGORIES.find((c) => c === categoryRaw);
  const classesQuery = useAllClasses({ enabled: scope === 'staff' });
  const sectionsQuery = useClassSections(scope === 'staff' ? class_id : undefined);
  // `/students/mine` is parent/student only: staff would get a 403.
  const childrenQuery = useQuery({ ...myStudentsQueryOptions(), enabled: scope === 'portal' });
  const children = scope === 'portal' ? (childrenQuery.data ?? []) : [];
  // A failed hide/snooze belongs to the view it happened in.
  const resetActionErrors = () => {
    hide.reset();
    snooze.reset();
    acknowledge.reset();
  };

  const query = useAttentionItems({
    tab,
    ...(category ? { category } : {}),
    ...(scope === 'staff' && section_id ? { sectionId: section_id } : {}),
    ...(scope === 'portal' && student_id ? { studentId: student_id } : {}),
    page: state.page,
    pageSize: state.limit,
  });
  // The generated DTO types its enums as string literals; the shared enums are the same values.
  const items = (query.data?.items ?? []) as AlertItem[];
  const total = query.data?.total ?? 0;
  const busyId = hide.isPending
    ? hide.variables
    : snooze.isPending
      ? snooze.variables?.recipientId
      : undefined;

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'category',
      label: t('worklist.filterCategory'),
      allLabel: t('worklist.allCategories'),
      options: CATEGORIES.filter(
        (c) => c !== AlertCategory.PLATFORM || role === UserRole.SUPER_ADMIN,
      ).map((c) => ({ value: c, label: t(`category.${c}`) })),
    },
  ];
  if (scope === 'staff') {
    fields.push(
      {
        kind: 'select',
        key: 'class_id',
        label: t('worklist.filterClass'),
        allLabel: t('worklist.allClasses'),
        options: (classesQuery.data ?? []).map((k) => ({ value: k.id, label: k.name })),
      },
      {
        kind: 'select',
        key: 'section_id',
        label: t('worklist.filterSection'),
        allLabel: t('worklist.allSections'),
        options: (sectionsQuery.data ?? []).map((s) => ({ value: s.id, label: s.section_name })),
      },
    );
  } else if (children.length > 1) {
    fields.push({
      kind: 'select',
      key: 'student_id',
      label: t('worklist.filterChild'),
      allLabel: t('worklist.allChildren'),
      options: children.map((c) => ({ value: c.id, label: c.full_name })),
    });
  }

  function statusBadge(item: AlertItem) {
    if (item.state === AlertRecipientState.RESOLVED) {
      const time = formatDateTime(item.resolvedAt, config);
      return (
        <StatusBadge
          tone="success"
          label={
            item.resolvedByName
              ? t('item.fixedBy', { name: item.resolvedByName, time })
              : t('item.fixedAt', { time })
          }
        />
      );
    }
    if (item.state === AlertRecipientState.HIDDEN && item.snoozedUntil) {
      return (
        <StatusBadge
          tone="warning"
          label={t('item.snoozedUntil', { time: formatDateTime(item.snoozedUntil, config) })}
        />
      );
    }
    const tone = item.state === AlertRecipientState.OPEN ? 'info' : 'neutral';
    return <StatusBadge tone={tone} label={t(`state.${item.state}`)} />;
  }

  function actionsFor(item: AlertItem): RowAction[] {
    // Important notices leave through "পড়েছি", never through close (D17).
    const important = item.ruleKey === NOTICE_IMPORTANT;
    const rowActions: RowAction[] = [];
    if (item.actionUrl && item.actionLabel) {
      rowActions.push({
        intent: 'view',
        display: 'text',
        label: item.actionLabel,
        icon: <ArrowRightIcon />,
        to: item.actionUrl,
      });
    }
    if (item.closable && !important && item.state === AlertRecipientState.OPEN) {
      rowActions.push({
        intent: 'dismiss',
        label: t('item.closeNamed', { title: item.title }),
        shortLabel: t('item.close'),
        busy: busyId === item.recipientId,
        onClick: () => hide.mutate(item.recipientId),
      });
    }
    return rowActions;
  }

  const canSnooze = (item: AlertItem) =>
    item.state === AlertRecipientState.OPEN &&
    item.closable &&
    item.ruleKey !== NOTICE_IMPORTANT &&
    item.severity === AlertSeverity.WARNING;

  const columns: DataTableColumn<AlertItem>[] = [
    {
      id: 'severity',
      header: t('worklist.colSeverity'),
      accessorFn: (item) => <AlertSeverityBadge severity={item.severity} />,
      card: 'badge',
    },
    {
      id: 'title',
      header: t('worklist.colTitle'),
      accessorFn: (item) => (
        <div>
          <div className="font-medium">
            {item.ruleKey === NOTICE_SMS_APPROVAL
              ? t('notice.smsPending', { title: item.title })
              : item.title}
          </div>
          <div className="text-caption text-text-secondary">{item.why}</div>
        </div>
      ),
      card: 'title',
    },
    {
      id: 'who',
      header: t('worklist.colWho'),
      accessorFn: (item) =>
        item.studentName && item.sectionLabel
          ? t('item.about', { student: item.studentName, section: item.sectionLabel })
          : item.studentName || item.sectionLabel || '—',
      card: 'subtitle',
    },
    {
      id: 'when',
      header: t('worklist.colWhen'),
      accessorFn: (item) => formatDateTime(item.raisedAt, config),
    },
    { id: 'state', header: t('worklist.colState'), accessorFn: statusBadge },
  ];
  if (tab === 'active') {
    columns.push({
      id: 'actions',
      header: t('worklist.colActions'),
      accessorFn: (item) => (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {isNoticeAlert(item) && item.state === AlertRecipientState.OPEN ? (
            <AttentionNoticeItem
              item={item}
              busy={acknowledge.isPending && acknowledge.variables === noticeIdOf(item)}
              onAcknowledge={(id) =>
                acknowledge.mutate(id, {
                  onSuccess: () =>
                    void queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
                })
              }
            />
          ) : (
            <RowActions actions={actionsFor(item)} />
          )}
          {canSnooze(item) && (
            <AlertSnoozeMenu
              triggerVariant="icon"
              label={t('item.snoozeNamed', { title: item.title })}
              disabled={busyId === item.recipientId}
              onSelect={(choice, date) =>
                snooze.mutate({ recipientId: item.recipientId, choice, ...(date ? { date } : {}) })
              }
            />
          )}
        </div>
      ),
    });
  }

  return (
    <PageContainer size="wide">
      <PageHeader
        title={t('worklist.title')}
        subtitle={scope === 'portal' ? t('worklist.portalSubtitle') : t('worklist.subtitle')}
      />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          resetActionErrors();
          onTabChange(next as WorklistTab);
        }}
      >
        <TabsList variant="line" aria-label={t('worklist.tabsLabel')}>
          <TabsTrigger value="active">
            {tab === 'active' && query.data
              ? t('worklist.tabActive', { n: total })
              : t('worklist.tabActiveNoCount')}
          </TabsTrigger>
          <TabsTrigger value="history">{t('worklist.tabHistory')}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="space-y-4 pt-4 md:pt-6">
          {tab === 'active' && (
            <p className="flex items-center gap-2 text-caption text-text-secondary">
              <InfoIcon className="size-4 shrink-0" aria-hidden />
              {t('worklist.hiddenHint')}
            </p>
          )}
          <FilterBar
            fields={fields}
            values={state.filters}
            onChange={(patch) => {
              resetActionErrors();
              actions.setFilters({
                ...patch,
                ...('class_id' in patch ? { section_id: null } : {}),
              });
            }}
            resultCount={total}
          />
          {(hide.isError || snooze.isError || acknowledge.isError) && (
            <p role="alert" className="text-caption text-destructive">
              {t('item.actionFailed')}
            </p>
          )}
          <DataTable
            tableId={`attention-worklist-${tab}`}
            caption={t('worklist.title')}
            columns={columns}
            data={items}
            getRowId={(item) => item.recipientId}
            sorting={null}
            onSortingChange={() => undefined}
            page={state.page}
            pageSize={state.limit}
            totalCount={total}
            onPageChange={actions.setPage}
            onPageSizeChange={actions.setLimit}
            loading={query.isLoading}
            isFetching={query.isFetching}
            {...(query.isError ? { error: t('worklist.loadError') } : {})}
            emptyState={
              tab === 'active'
                ? {
                    title: t('worklist.emptyActiveTitle'),
                    explanation: t('worklist.emptyActiveBody'),
                  }
                : {
                    title: t('worklist.emptyHistoryTitle'),
                    explanation: t('worklist.emptyHistoryBody'),
                  }
            }
          />
          {query.isError && (
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('modal.retry')}
            </Button>
          )}
          {tab === 'history' && (
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-h3">{t('worklist.deviceTitle')}</h2>
                  <p className="text-text-secondary">{t('worklist.deviceBody')}</p>
                </div>
                {unreadCount > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      markAllNotificationsRead();
                      // The button unmounts now; keep keyboard focus on the list.
                      deviceRef.current?.focus();
                    }}
                  >
                    <CheckCheckIcon aria-hidden />
                    {t('worklist.markAllRead')}
                  </Button>
                )}
              </div>
              <div
                ref={deviceRef}
                tabIndex={-1}
                className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <NotificationList
                  notifications={notifications}
                  onMarkRead={markNotificationRead}
                  emptyLabel={t('worklist.deviceEmpty')}
                />
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
