import { UserRole, User, Issue } from '@/types';

export const PERMISSIONS: Record<UserRole, string[]> = {
  inspector: [
    'issue:create',
    'issue:edit_own',
    'issue:view_own',
    'sync:view',
    'history:view'
  ],
  manager: [
    'issue:view_all',
    'issue:close',
    'export:data',
    'sync:view',
    'history:view'
  ],
  supervisor: [
    'issue:view_all',
    'issue:reject',
    'config:import',
    'export:data',
    'sync:manage',
    'conflict:resolve',
    'history:view'
  ]
};

export function hasPermission(role: UserRole | undefined, permission: string): boolean {
  if (!role) return false;
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  inspector: '巡检员',
  manager: '店长',
  supervisor: '督导'
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  inspector: '创建并提交巡检问题，管理自己的草稿',
  manager: '查看门店问题，核实后关闭问题，导出记录',
  supervisor: '导入配置，驳回问题，解决冲突，管理同步'
};

export function canManageIssue(user: User | null | undefined, issue: Issue | undefined, action: 'close' | 'reject'): boolean {
  if (!user || !issue) return false;

  if (action === 'close' && !hasPermission(user.role, 'issue:close')) return false;
  if (action === 'reject' && !hasPermission(user.role, 'issue:reject')) return false;

  if (user.role === 'supervisor') return true;

  if (user.role === 'manager') {
    return user.storeId === issue.storeId;
  }

  return false;
}
