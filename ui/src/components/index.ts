/**
 * Public component surface — one wrapper per vendored primitive. SPAs import from here and never reach into `primitives/`.
 *
 * `Placeholder` exists only to prove the `@biddaloy/ui` import boundary
 * works end to end for [8.1.4]'s scaffold check. Real components arrived
 * with [8.6.2]'s core wrappers below — `Placeholder` can be deleted now
 * that something real proves the boundary, but that deletion is left for a
 * human to action rather than done here (see this PR's Notes section).
 */
export { Placeholder } from './placeholder';

export { Button, type ButtonProps } from './button';
export {
  HelpHint,
  HelpProvider,
  useHelp,
  type HelpEntry,
  type HelpIndex,
  type HelpHintProps,
  type ResolvedHelp,
} from './help-hint';
export { Input, type InputProps } from './input';
export { Textarea, type TextareaProps } from './textarea';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  type TableBodyProps,
  type TableCaptionProps,
  type TableCellProps,
  type TableFooterProps,
  type TableHeadProps,
  type TableHeaderProps,
  type TableProps,
  type TableRowProps,
} from './table';
export { Label, type LabelProps } from './label';
export { Checkbox, type CheckboxProps } from './checkbox';
export { Switch, type SwitchProps } from './switch';
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from './form-field';
export { Field, FieldGrid, type FieldProps, type FieldGridProps } from './field-grid';
export { MoneyInput, type MoneyInputProps } from './money-input';
export { PhoneInput, formatValidPhone, type PhoneInputProps } from './phone-input';
export { DatePicker, Calendar, type DatePickerProps } from './date-picker';
export { Combobox, type ComboboxOption, type ComboboxProps } from './combobox';
export { MultiCombobox, type MultiComboboxOption, type MultiComboboxProps } from './multi-combobox';
export { Timeline, type TimelineItem, type TimelineProps } from './timeline';
export {
  RoutineGrid,
  routineCellKey,
  type RoutineGridProps,
  type RoutineGridPeriodRow,
  type RoutineGridCell,
} from './routine-grid';
export { FileUpload, type FileUploadItem, type FileUploadProps } from './file-upload';
export {
  BulkUploadPreview,
  type BulkUploadPreviewProps,
  type BulkUploadPreviewController,
} from './bulk-upload-preview';
export { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';
export {
  RowActions,
  type RowAction,
  type RowActionIntent,
  type RowActionsProps,
} from './row-actions';
export { TableCount, type TableCountProps } from './table-count';
export { FilterSheet, type FilterSheetProps } from './filter-sheet';
export { MonthHeader, type MonthHeaderProps } from './month-header';
export { MonthPicker, type MonthPickerProps } from './month-picker';
export { TimeInput, type TimeInputProps } from './time-input';
export { DayPanel, type DayPanelProps } from './calendar/day-panel';
export { AuthLayout, type AuthLayoutProps } from './auth-layout';
export { BulkImportErrorTable, type BulkImportErrorTableProps } from './bulk-import-error-table';
export {
  DataTable,
  type DataTableCardRole,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from './data-table';
export {
  MarksGrid,
  cellKey,
  type MarksGridCell,
  type MarksGridCellValue,
  type MarksGridComponent,
  type MarksGridProps,
  type MarksGridStatus,
  type MarksGridStudent,
} from './marks-grid';
export { MarksStepper, type MarksStepperProps } from './marks-stepper';
export {
  RadioGroup,
  RadioGroupItem,
  type RadioGroupProps,
  type RadioGroupItemProps,
} from './radio';
export {
  LessonStatusGroup,
  type LessonDeliveryStatus,
  type LessonStatusGroupProps,
} from './lesson-status-group';
export { RadioRows, type RadioRowOption, type RadioRowsProps } from './radio-rows';
export { ChoiceCards, type ChoiceCardOption, type ChoiceCardsProps } from './choice-cards';
export { SchoolPicker, type SchoolPickerOption, type SchoolPickerProps } from './school-picker';
export { TenantBar } from './tenant-bar';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectProps,
  type SelectTriggerProps,
  type SelectContentProps,
  type SelectItemProps,
  type SelectValueProps,
  type SelectGroupProps,
  type SelectLabelProps,
  type SelectSeparatorProps,
} from './select';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogProps,
  type DialogTriggerProps,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogFooterProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogCloseProps,
  VisuallyHidden,
} from './dialog';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
  type TooltipProviderProps,
} from './tooltip';
export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  type MenuProps,
  type MenuTriggerProps,
  type MenuContentProps,
  type MenuItemProps,
  type MenuCheckboxItemProps,
  type MenuRadioGroupProps,
  type MenuRadioItemProps,
  type MenuLabelProps,
  type MenuSeparatorProps,
  type MenuShortcutProps,
  type MenuGroupProps,
  type MenuSubProps,
  type MenuSubTriggerProps,
  type MenuSubContentProps,
} from './menu';
export { ExportMenu, type ExportMenuFormat, type ExportMenuProps } from './export-menu';
export {
  ReportPrompts,
  PromptSummary,
  defaultPromptValues,
  missingPrompts,
  promptParams,
  sanitizePromptValues,
  withDefaults,
  NO_CHOICES,
  type PromptChoices,
  type PromptDateRange,
  type PromptParameter,
  type PromptSummaryProps,
  type PromptValue,
  type PromptValues,
  type ReportPromptsProps,
} from './report-prompts';
// [8.15.29] The report renderers: the runner picks one by the definition's layout type.
export {
  ReportTable,
  ReportGrouped,
  type ReportLayoutProps,
  type ReportRunResult,
} from './report-view';
export { ReportCrosstab } from './report-view/report-crosstab';
export { ReportChart } from './report-view/report-chart';
// [8.15.42] Colour rules and drill-through: the screen resolves a cell to a link, the renderers draw it.
export { DrillLink } from './report-view/report-table';
export {
  drillQuery,
  resolveDrill,
  type DrillContext,
  type DrillLinks,
  type DrillTarget,
  type ReportDrilling,
} from './report-view/drill';
export {
  describeRule,
  toneFor,
  type ReportFormatting,
  type RuleSentence,
} from './report-view/format-cell';
// [8.15.39] The report designer's building blocks (field picker, filters, layout, colour rules).
export * from './report-designer';
export {
  StatusBadge,
  humanizeStatus,
  statusLabelKey,
  type StatusBadgeProps,
  type StatusTone,
  type AttendanceLowStatus,
  ALERT_SEVERITY_ICON,
} from './status-badge';
export {
  AttendanceStatusControl,
  type AttendanceStatusControlProps,
  type AttendanceStatusControlVariant,
} from './attendance-status-control';
export {
  AttendanceMonthGrid,
  type AttendanceDayCell,
  type AttendanceMonthGridProps,
} from './attendance-month-grid';
export { Card, type CardProps } from './card';
export { SessionList, type Session, type SessionListProps } from './session-list';
export {
  PushNotificationSettings,
  type PushNotificationSettingsProps,
  type PushSubscriptionRow,
} from './push-notification-settings';
export { PushOptInCard, type PushOptInCardProps } from './push-opt-in-card';
export { BottomNav, type BottomNavProps } from './bottom-nav';
export { Breadcrumbs, type BreadcrumbItem, type BreadcrumbsProps } from './breadcrumbs';
export { EmptyState, type EmptyStateKind, type EmptyStateProps } from './empty-state';
export { StudentPicker, type StudentPickerProps, type StudentPickerItem } from './student-picker';
export { ErrorState, type ErrorStateProps } from './error-state';
export { RecordNotFoundState, type RecordNotFoundStateProps } from './record-not-found-state';
export { RouteStatusState, type RouteStatusStateProps } from './route-status-state';
export { AccessDeniedState, type AccessDeniedStateProps } from './access-denied-state';
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  type PopoverProps,
  type PopoverAnchorProps,
  type PopoverContentProps,
  type PopoverDescriptionProps,
  type PopoverHeaderProps,
  type PopoverTitleProps,
  type PopoverTriggerProps,
} from './popover';
export {
  NotificationBell,
  type NotificationBellAttention,
  type NotificationBellProps,
} from './notification-bell';
export { NotificationList, type NotificationListProps } from './notification-list';
export {
  isOfflineRouteError,
  RouteErrorFallback,
  type RouteErrorFallbackProps,
} from './route-error-boundary';
export { Toaster, toast } from './toast';
export {
  Skeleton,
  SkeletonFieldList,
  type SkeletonFieldListProps,
  SkeletonTable,
  type SkeletonTableProps,
  SkeletonText,
  type SkeletonTextProps,
} from './skeleton';
export { Pagination, type PaginationProps } from './pagination';
export { LocaleSwitcher, type LocaleSwitcherProps } from './locale-switcher';
export { ThemeToggle } from './theme-toggle';
export {
  AppShell,
  APP_HEADER_HEIGHT_VAR,
  APP_SHELL_MAIN_ID,
  useAppShellDrawer,
  type AppShellProps,
  type AppShellNavItem,
  type AppShellNavGroup,
  type AppShellDrawerValue,
} from './app-shell';
export { AppHeader, type AppHeaderProps } from './app-header';
export { DemoRibbon, type DemoRibbonProps } from './demo-ribbon';
export { UserMenu, type UserMenuProps } from './user-menu';
export { SkipLink, type SkipLinkProps } from './skip-link';
export { RouteAnnouncer, type RouteAnnouncerProps } from './route-announcer';
export {
  ROUTE_PENDING_ATTR,
  RoutePending,
  type RoutePendingProps,
  type RoutePendingVariant,
} from './route-pending';
export { RouteProgress, type RouteProgressProps } from './route-progress';
export {
  CommandPalette,
  type CommandPaletteProps,
  type CommandPaletteTab,
  type CommandPaletteTabId,
  type GlobalSearchGroup,
  type GlobalSearchResult,
} from './command-palette';
export { ShortcutsSheet, type ShortcutsSheetProps } from './shortcuts-sheet';
export {
  SignInForm,
  type SignInCredentials,
  type SignInFormError,
  type SignInFormProps,
} from './sign-in-form';
export {
  FormPasswordChecklist,
  PasswordChecklist,
  type PasswordChecklistProps,
  weakPasswordRules,
  passwordTooLong,
} from './password-checklist';
export { SetPasswordForm, type SetPasswordFormProps } from './set-password-form';
export { OtpInput, type OtpInputProps } from './otp-input';
export {
  OtpSignInForm,
  type OtpSignInFormProps,
  type OtpSignInCredentials,
} from './otp-sign-in-form';
// 12.5: the login page's password/OTP tabs are the first consumer of Tabs
// outside `ui/` itself — re-exported here since `@biddaloy/ui` has no
// `./primitives` package export for client apps to reach `ui/src/primitives`
// directly.
export { Tabs, TabsList, TabsTrigger, TabsContent } from '../primitives/tabs';
export { CachedDataNotice, type CachedDataNoticeProps } from './cached-data-notice';
export { SyncStatus, SyncStatusIndicator, type SyncStatusProps } from './sync-status';
export {
  ProfileForm,
  type ProfileFormProps,
  type ProfileFormServerError,
  type ProfileFormSubmitValues,
  type ProfileFormValues,
} from './profile-form';
export {
  GuardianContactForm,
  type GuardianContactFormProps,
  type GuardianContactFormServerError,
  type GuardianContactFormSubmitValues,
  type GuardianContactFormValues,
  type GuardianPreferredCommunication,
} from './guardian-contact-form';
export {
  ContactChangeDialog,
  type ContactChangeDialogProps,
  type ContactChangeField,
} from './contact-change-dialog';
export {
  ChangePasswordForm,
  type ChangePasswordFormProps,
  type ChangePasswordFormServerError,
  type ChangePasswordFormValues,
} from './change-password-form';
export { IssuerHeader, type IssuerHeaderProps, type IssuerSnapshot } from './print/issuer-header';
export {
  InvoiceReceipt,
  type InvoiceReceiptData,
  type InvoiceReceiptProps,
  type InvoiceReceiptStudent,
} from './print/invoice-receipt';
export { A4Document, type A4DocumentProps } from './print/a4-document';
export { DocumentCard, type DocumentCardProps } from './document-card';
export {
  ReportCard,
  type ReportCardComponent,
  type ReportCardData,
  type ReportCardLegendRow,
  type ReportCardProps,
  type ReportCardSubject,
} from './print/report-card';
export * from './print/exam-documents';
export { EventTypeBadge, type EventTypeBadgeProps } from './calendar/event-type-badge';
export {
  MonthGrid,
  type MonthGridEvent,
  type MonthGridProps,
  type MonthGridTermBand,
} from './calendar/month-grid';
export { AgendaList, type AgendaEvent, type AgendaListProps } from './calendar/agenda-list';
export {
  MilestoneChecklist,
  type MilestoneChecklistItem,
  type MilestoneChecklistProps,
} from './programs/milestone-checklist';
export { ProgressBar, type ProgressBarProps } from './programs/progress-bar';
export {
  SummaryCard,
  type SummaryCardFigure,
  type SummaryCardProps,
} from './performance/summary-card';
export { BarWidget, type BarWidgetBar, type BarWidgetProps } from './performance/bar-widget';
export { SwipeRow, type SwipeRowProps } from './performance/swipe-row';
export {
  BUNDLED_PRINT_FONTS,
  layoutPages,
  orderSides,
  TemplateRenderer,
  type PrintFont,
  type PrinterSetup,
  type Sheet,
  type TemplateRendererProps,
} from './print/template-renderer';
export {
  buildCalibrationDocument,
  buildPrintDocument,
  fetchAsDataUrl,
  openPrintWindow,
  type BlobFetcher,
  type BuildPrintDocumentInput,
  type PrintCalibration,
} from './print/print-document';
export {
  RepeatableRowForm,
  type RepeatableRowField,
  type RepeatableRowFieldType,
  type RepeatableRowFormProps,
  type RepeatableRowValue,
} from './repeatable-row-form/repeatable-row-form';
export { SocialButtons, type SocialButtonsProps } from './social-buttons';
export { NoticeBar, type NoticeBarProps, type NoticeBarTone } from './notice-bar';
export { AttentionBar, type AttentionBarProps } from './attention/attention-bar';
export { AttentionModal, type AttentionModalProps } from './attention/attention-modal';
export { AlertItemCard, type AlertItemCardProps } from './attention/alert-item-card';
export { AlertSnoozeMenu, type AlertSnoozeMenuProps } from './attention/alert-snooze-menu';
export { AlertSeverityBadge, type AlertSeverityBadgeProps } from './attention/alert-severity-badge';
export { StudentAlertStrip, type StudentAlertStripProps } from './attention/student-alert-strip';
export {
  Stepper,
  StepIndicator,
  type StepperProps,
  type StepIndicatorProps,
} from './step-indicator';
export { ReorderButtons, type ReorderButtonsProps } from './reorder-buttons';
export {
  ExamMarkerRow,
  ExamMarkerLine,
  type ExamMarkerRowProps,
  type ExamMarkerLineProps,
} from './exam-marker-row';
export { SchoolInvitesCard, type SchoolInvitesCardProps } from './school-invites-card';
export * from './dashboard/index';
