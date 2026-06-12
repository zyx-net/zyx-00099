import { IssueStatus, IssuePriority, SyncStatus, PlanDueStatus } from '@/types';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, SYNC_STATUS_LABELS, SYNC_STATUS_COLORS, DUE_STATUS_LABELS, DUE_STATUS_COLORS } from '@/utils/helpers';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: IssueStatus;
  size?: 'sm' | 'md';
}

export function IssueStatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded font-medium text-white',
      STATUS_COLORS[status],
      sizeClasses
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full bg-white/80')} />
      {STATUS_LABELS[status]}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: IssuePriority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
      PRIORITY_COLORS[priority]
    )}>
      {PRIORITY_LABELS[priority]}优先级
    </span>
  );
}

interface SyncStatusBadgeProps {
  status: SyncStatus;
}

export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-white',
      SYNC_STATUS_COLORS[status]
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full bg-white/80')} />
      {SYNC_STATUS_LABELS[status]}
    </span>
  );
}

interface DueStatusBadgeProps {
  status: PlanDueStatus;
  size?: 'sm' | 'md';
}

export function DueStatusBadge({ status, size = 'sm' }: DueStatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  const iconClass = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded font-medium',
      DUE_STATUS_COLORS[status],
      sizeClasses
    )}>
      <span className={cn(`${iconClass} rounded-full`, status.startsWith('delay_') ? 'bg-current/50' : 'bg-white/80')} />
      {DUE_STATUS_LABELS[status]}
    </span>
  );
}
