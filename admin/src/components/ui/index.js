/**
 * Shared UI primitive barrel for the admin panel.
 *
 * Phase 1 of ADMIN_UI_OPTIMIZATION_PLAN.md (§1.1). All page-level refactors
 * import from this single entry point so we have one consistent surface.
 */

export { default as PageHeader } from './PageHeader';
export { default as MetricCard } from './MetricCard';
export { default as MetricGrid } from './MetricGrid';
export { default as Toolbar } from './Toolbar';
export { default as DataTable } from './DataTable';
export { default as EmptyState } from './EmptyState';
export { default as LoadingState, Skeleton, SkeletonText, SkeletonCard, SkeletonTable, Spinner } from './LoadingState';
export { default as ErrorState } from './ErrorState';
export { default as ConfirmDialog } from './ConfirmDialog';
export { default as Drawer } from './Drawer';
export { default as StatusBadge, STATUS_TONE, TONE_CLASSES } from './StatusBadge';
export { default as Tabs } from './Tabs';
export { default as KeyValueList, KeyValueRow } from './KeyValueList';
export {
  Money,
  DateTime,
  RelativeTime,
  formatMoney,
  formatNumber,
  formatDateTime,
  formatDate,
  formatTime,
  formatRelativeTime,
} from './format';
