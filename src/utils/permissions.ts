import { UserRole, User, Issue, ReviewPlan } from '@/types';

export const PERMISSIONS: Record<UserRole, string[]> = {
  inspector: [
    'issue:create',
    'issue:edit_own',
    'issue:view_own',
    'sync:view',
    'history:view',
    'plan:view_own',
    'plan:delay_request_own',
  ],
  manager: [
    'issue:view_all',
    'issue:close',
    'export:data',
    'sync:view',
    'history:view',
    'plan:create',
    'plan:edit_own',
    'plan:view_store',
    'plan_conflict:resolve_own',
    'handover:export_own',
    'plan:delay_request_store',
    'plan:delay_approve_store',
  ],
  supervisor: [
    'issue:view_all',
    'issue:reject',
    'config:import',
    'template:upgrade',
    'export:data',
    'sync:manage',
    'conflict:resolve',
    'history:view',
    'plan:create',
    'plan:edit_all',
    'plan:view_all',
    'plan_conflict:resolve_all',
    'handover:export_all',
    'handover:import',
    'plan:delay_request_all',
    'plan:delay_approve_all',
    'plan:time_conflict_resolve_all',
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
  inspector: '创建并提交巡检问题，查看分配给自己的复查计划',
  manager: '查看门店问题，核实后关闭问题，安排复查整改计划，导出记录',
  supervisor: '导入配置，升级模板，驳回问题，解决冲突，管理同步，全局安排复查计划'
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

export function canUpgradeTemplate(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'template:upgrade');
}

export function canCreatePlan(user: User | null | undefined, issue: Issue | undefined): boolean {
  if (!user || !issue) return false;
  if (!hasPermission(user.role, 'plan:create')) return false;
  if (user.role === 'supervisor') return true;
  if (user.role === 'manager') {
    return user.storeId === issue.storeId;
  }
  return false;
}

export function canEditPlan(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:edit_all')) return true;
  if (hasPermission(user.role, 'plan:edit_own') && plan.creatorId === user.id) return true;
  if (user.role === 'manager' && issue && user.storeId === issue.storeId && plan.creatorId === user.id) return true;
  return false;
}

export function canViewPlan(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:view_all')) return true;
  if (plan.assigneeId === user.id) return true;
  if (plan.creatorId === user.id) return true;
  if (hasPermission(user.role, 'plan:view_store') && issue && user.storeId === issue.storeId) return true;
  if (hasPermission(user.role, 'plan:view_own') && (plan.assigneeId === user.id || plan.creatorId === user.id)) return true;
  return false;
}

export function canResolvePlanConflict(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan_conflict:resolve_all')) return true;
  if (hasPermission(user.role, 'plan_conflict:resolve_own') && plan.creatorId === user.id) return true;
  if (user.role === 'manager' && issue && user.storeId === issue.storeId) return true;
  return false;
}

export function canExportHandover(user: User | null | undefined, issue: Issue | undefined): boolean {
  if (!user || !issue) return false;
  if (hasPermission(user.role, 'handover:export_all')) return true;
  if (hasPermission(user.role, 'handover:export_own') && user.storeId === issue.storeId) return true;
  return false;
}

export function canImportHandover(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'handover:import');
}

export function canRequestDelay(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:delay_request_all')) return true;
  if (hasPermission(user.role, 'plan:delay_request_store') && issue && user.storeId === issue.storeId) return true;
  if (hasPermission(user.role, 'plan:delay_request_own') &&
      (plan.assigneeId === user.id || plan.creatorId === user.id)) return true;
  return false;
}

export function canApproveDelay(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:delay_approve_all')) return true;
  if (hasPermission(user.role, 'plan:delay_approve_store') && issue && user.storeId === issue.storeId) {
    return true;
  }
  return false;
}

export function canDirectlyChangeReviewTime(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  return canEditPlan(user, plan, issue);
}

export function canResolveTimeConflict(user: User | null | undefined, plan: ReviewPlan | undefined, issue?: Issue): boolean {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:time_conflict_resolve_all')) return true;
  return canEditPlan(user, plan, issue);
}
