import { UserRole, User, Issue, ReviewPlan, HandoverImportBatch, HandoverImportPrecheckResult, MaterialBorrowForm, CheckIn } from '@/types';

export const PERMISSIONS: Record<UserRole, string[]> = {
  inspector: [
    'issue:create',
    'issue:edit_own',
    'issue:view_own',
    'sync:view',
    'history:view',
    'plan:view_own',
    'plan:delay_request_own',
    'material:view',
    'material:borrow_own',
    'material:return_own',
    'material:view_own_borrow',
    'patrol:checkin',
    'patrol:view_own_checkin',
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
    'handover:precheck_view_store',
    'plan:delay_request_store',
    'plan:delay_approve_store',
    'material:view',
    'material:view_store_occupancy',
    'material:view_store_borrow',
    'material:borrow_store',
    'material:return_store',
    'patrol:view_store_checkin',
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
    'handover:precheck_view_all',
    'handover:import_confirm',
    'handover:import_undo',
    'handover:strategy_select',
    'plan:delay_request_all',
    'plan:delay_approve_all',
    'plan:time_conflict_resolve_all',
    'material:view_all',
    'material:manage',
    'material:stock_manage',
    'material:loss_report',
    'material:borrow_all',
    'material:return_all',
    'material:export',
    'patrol:route_manage',
    'patrol:view_all_checkin',
    'patrol:export',
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
  inspector: '创建并提交巡检问题，查看分配给自己的复查计划，领取和归还巡检物资',
  manager: '查看门店问题，核实后关闭问题，安排复查整改计划，导出记录，查看本门店物资占用情况',
  supervisor: '导入配置，升级模板，驳回问题，解决冲突，管理同步，全局安排复查计划，维护物资目录和库存'
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

export function canViewHandoverPrecheck(
  user: User | null | undefined,
  precheckResult: HandoverImportPrecheckResult | undefined,
  issue?: Issue,
): boolean {
  if (!user || !precheckResult) return false;
  if (hasPermission(user.role, 'handover:precheck_view_all')) return true;
  if (hasPermission(user.role, 'handover:precheck_view_store') && issue) {
    return user.storeId === issue.storeId;
  }
  return precheckResult.visibleToUserIds?.includes(user.id) || false;
}

export function canConfirmHandoverImport(
  user: User | null | undefined,
  precheckResult: HandoverImportPrecheckResult | undefined,
  issue?: Issue,
): boolean {
  if (!user || !precheckResult) return false;
  if (!hasPermission(user.role, 'handover:import_confirm')) return false;
  return true;
}

export function canUndoHandoverImport(
  user: User | null | undefined,
  batch: HandoverImportBatch | undefined,
): boolean {
  if (!user || !batch) return false;
  if (!hasPermission(user.role, 'handover:import_undo')) return false;
  return batch.status === 'imported' && !batch.hasUndo;
}

export function canSelectHandoverStrategy(
  user: User | null | undefined,
  precheckResult: HandoverImportPrecheckResult | null | undefined,
  issue?: Issue,
): boolean {
  if (!user || !precheckResult) return false;
  if (hasPermission(user.role, 'handover:strategy_select')) return true;
  return false;
}

export function canPrecheckHandoverImport(
  user: User | null | undefined,
): boolean {
  if (!user) return false;
  return hasPermission(user.role, 'handover:import') 
    || hasPermission(user.role, 'handover:precheck_view_all')
    || hasPermission(user.role, 'handover:precheck_view_store');
}

export function canManageMaterial(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'material:manage');
}

export function canManageStock(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'material:stock_manage');
}

export function canReportLoss(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'material:loss_report');
}

export function canViewMaterial(user: User | null | undefined, storeId?: string): boolean {
  if (!user) return false;
  if (hasPermission(user.role, 'material:view_all')) return true;
  if (hasPermission(user.role, 'material:view')) {
    if (!storeId) return true;
    if (user.role === 'manager') return user.storeId === storeId;
    return true;
  }
  return false;
}

export function canBorrowMaterial(user: User | null | undefined, storeId?: string): boolean {
  if (!user) return false;
  if (hasPermission(user.role, 'material:borrow_all')) return true;
  if (hasPermission(user.role, 'material:borrow_store')) {
    if (!storeId) return true;
    return user.storeId === storeId;
  }
  if (hasPermission(user.role, 'material:borrow_own')) return true;
  return false;
}

export function canReturnMaterial(user: User | null | undefined, form?: MaterialBorrowForm): boolean {
  if (!user) return false;
  if (hasPermission(user.role, 'material:return_all')) return true;
  if (hasPermission(user.role, 'material:return_store')) {
    if (!form) return true;
    return user.storeId === form.storeId;
  }
  if (hasPermission(user.role, 'material:return_own')) {
    if (!form) return true;
    return user.id === form.borrowerId;
  }
  return false;
}

export function canViewStoreOccupancy(user: User | null | undefined, storeId?: string): boolean {
  if (!user) return false;
  if (!hasPermission(user.role, 'material:view_store_occupancy')) return false;
  if (!storeId) return true;
  return user.storeId === storeId;
}

export function canExportMaterial(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'material:export');
}

export function canManagePatrolRoute(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'patrol:route_manage');
}

export function canCheckInPatrol(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'patrol:checkin');
}

export function canViewPatrolCheckIn(user: User | null | undefined, checkIn?: CheckIn): boolean {
  if (!user) return false;
  if (hasPermission(user.role, 'patrol:view_all_checkin')) return true;
  if (hasPermission(user.role, 'patrol:view_store_checkin') && checkIn) {
    return user.storeId === checkIn.storeId;
  }
  if (hasPermission(user.role, 'patrol:view_own_checkin') && checkIn) {
    return user.id === checkIn.inspectorId;
  }
  return false;
}

export function canExportPatrol(user: User | null | undefined): boolean {
  return hasPermission(user?.role, 'patrol:export');
}
