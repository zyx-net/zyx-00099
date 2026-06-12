import { IssueStatus, IssuePriority, SyncStatus, HistoryAction, UserRole } from '@/types';

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const STATUS_LABELS: Record<IssueStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  rejected: '已驳回',
  closed: '已关闭'
};

export const STATUS_COLORS: Record<IssueStatus, string> = {
  draft: 'bg-gray-500',
  submitted: 'bg-blue-500',
  rejected: 'bg-red-500',
  closed: 'bg-green-500'
};

export const STATUS_TEXT_COLORS: Record<IssueStatus, string> = {
  draft: 'text-gray-600',
  submitted: 'text-blue-600',
  rejected: 'text-red-600',
  closed: 'text-green-600'
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: '低',
  medium: '中',
  high: '高'
};

export const PRIORITY_COLORS: Record<IssuePriority, string> = {
  low: 'bg-gray-200 text-gray-700',
  medium: 'bg-yellow-200 text-yellow-700',
  high: 'bg-red-200 text-red-700'
};

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  pending: '待同步',
  syncing: '同步中',
  failed: '同步失败',
  completed: '已完成'
};

export const SYNC_STATUS_COLORS: Record<SyncStatus, string> = {
  pending: 'bg-yellow-500',
  syncing: 'bg-blue-500',
  failed: 'bg-red-500',
  completed: 'bg-green-500'
};

export const ACTION_LABELS: Record<HistoryAction, string> = {
  create: '创建',
  update: '更新',
  submit: '提交',
  reject: '驳回',
  close: '关闭',
  reopen: '重新打开',
  migrate: '迁移'
};

export function getRoleName(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    inspector: '巡检员',
    manager: '店长',
    supervisor: '督导'
  };
  return labels[role];
}
