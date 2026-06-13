import { IssueStatus, IssuePriority, SyncStatus, HistoryAction, UserRole, PlanSyncStatus, PlanDueStatus, ReviewPlan, PlanDelayRecord, MaterialBorrowStatus, MaterialRecordType, MaterialStatus, MaterialBorrowForm, MaterialRecord, Material } from '@/types';

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

export const DUE_SOON_DAYS = 3;

export function computePlanDueStatus(plan: ReviewPlan, now: Date = new Date()): PlanDueStatus {
  if (plan.pendingDelayRequest && plan.pendingDelayRequest.status === 'pending') {
    return 'delay_requested';
  }
  const lastApprovedDelay = [...(plan.delayRecords || [])]
    .sort((a, b) => new Date(b.approvedAt || b.requestedAt).getTime() - new Date(a.approvedAt || a.requestedAt).getTime())
    .find(r => r.status === 'approved');
  if (lastApprovedDelay) {
    const approvedAt = new Date(lastApprovedDelay.approvedAt || lastApprovedDelay.requestedAt);
    if ((now.getTime() - approvedAt.getTime()) < 7 * 86400000) {
      return 'delay_approved';
    }
  }
  const lastRejectedDelay = [...(plan.delayRecords || [])]
    .sort((a, b) => new Date(b.rejectedAt || b.requestedAt).getTime() - new Date(a.rejectedAt || a.requestedAt).getTime())
    .find(r => r.status === 'rejected');
  if (lastRejectedDelay) {
    const rejectedAt = new Date(lastRejectedDelay.rejectedAt || lastRejectedDelay.requestedAt);
    if ((now.getTime() - rejectedAt.getTime()) < 3 * 86400000) {
      return 'delay_rejected';
    }
  }
  const reviewTime = new Date(plan.reviewTime);
  const diffMs = reviewTime.getTime() - now.getTime();
  const diffDays = diffMs / 86400000;
  if (diffMs < 0) return 'overdue';
  if (diffDays <= DUE_SOON_DAYS) return 'due_soon';
  return 'normal';
}

export const DUE_STATUS_LABELS: Record<PlanDueStatus, string> = {
  normal: '正常',
  due_soon: '即将到期',
  overdue: '已逾期',
  delay_requested: '已申请延期',
  delay_approved: '已批准延期',
  delay_rejected: '延期被驳回',
};

export const DUE_STATUS_COLORS: Record<PlanDueStatus, string> = {
  normal: 'bg-green-100 text-green-700',
  due_soon: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  delay_requested: 'bg-orange-100 text-orange-700',
  delay_approved: 'bg-blue-100 text-blue-700',
  delay_rejected: 'bg-purple-100 text-purple-700',
};

export function getPlanLastDelayReason(plan: ReviewPlan): string {
  const approved = [...(plan.delayRecords || [])]
    .sort((a, b) => new Date(b.approvedAt || b.requestedAt).getTime() - new Date(a.approvedAt || a.requestedAt).getTime())
    .find(r => r.status === 'approved');
  if (approved) return approved.reason;
  return plan.lastDelayReason || '';
}

export function getPlanLastApproverName(plan: ReviewPlan): string {
  const approved = [...(plan.delayRecords || [])]
    .sort((a, b) => new Date(b.approvedAt || b.requestedAt).getTime() - new Date(a.approvedAt || a.requestedAt).getTime())
    .find(r => r.status === 'approved');
  if (approved) return approved.approverName || approved.approverId || '';
  return plan.lastApproverName || '';
}

export function normalizeReviewPlanDefaults(p: Partial<ReviewPlan> & { id: string; issueId: string; reviewTime: string; assigneeId: string; rectificationNote: string; attachments: any[]; creatorId: string; creatorRole: UserRole; version: number; status: PlanSyncStatus; synced: boolean; createdAt: string; updatedAt: string }): ReviewPlan {
  return {
    ...p,
    originalReviewTime: p.originalReviewTime || p.reviewTime,
    delayCount: p.delayCount ?? 0,
    delayRecords: p.delayRecords || [],
    pendingDelayRequest: p.pendingDelayRequest || undefined,
    lastDelayReason: p.lastDelayReason || '',
    lastApproverId: p.lastApproverId || '',
    lastApproverName: p.lastApproverName || '',
    dueStatus: p.dueStatus || 'normal',
    hasTimeConflict: p.hasTimeConflict ?? false,
    timeConflictInfo: p.timeConflictInfo || undefined,
  };
}

export function buildDelayHistoryRemark(record: PlanDelayRecord, action: 'request' | 'approve' | 'reject'): string {
  const oldStr = formatDate(record.oldReviewTime);
  const newStr = formatDate(record.newReviewTime);
  if (action === 'request') {
    return `申请延期：${oldStr} → ${newStr}，原因：${record.reason || '未填写'}，附件摘要：${record.attachmentSummary || '无'}`;
  }
  if (action === 'approve') {
    return `批准延期：${oldStr} → ${newStr}，申请人：${record.requesterName || record.requesterId}，审批备注：${record.approvalRemark || '无'}`;
  }
  return `驳回延期：${oldStr} → ${newStr}，申请人：${record.requesterName || record.requesterId}，驳回理由：${record.approvalRemark || '未说明'}`;
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

export const PLAN_SYNC_STATUS_LABELS: Record<PlanSyncStatus, string> = {
  draft: '草稿',
  pending: '待同步',
  syncing: '同步中',
  failed: '同步失败',
  completed: '已完成'
};

export const PLAN_SYNC_STATUS_COLORS: Record<PlanSyncStatus, string> = {
  draft: 'bg-gray-500',
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
  migrate: '迁移',
  plan_create: '创建复查计划',
  plan_update: '更新复查计划',
  plan_delete: '删除复查计划',
  plan_conflict_resolve: '解决复查计划冲突',
  plan_sync: '复查计划同步成功',
  plan_sync_fail: '复查计划同步失败',
  plan_handover_export: '导出交接包',
  plan_handover_import: '导入交接包',
  plan_handover_import_undo: '撤销交接包导入',
  plan_handover_import_batch: '批量导入交接包',
  plan_delay_request: '申请延期',
  plan_delay_approve: '批准延期',
  plan_delay_reject: '驳回延期',
  plan_time_conflict_mark: '标记时间冲突',
  plan_time_conflict_resolve: '解决时间冲突',
};

export function getRoleName(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    inspector: '巡检员',
    manager: '店长',
    supervisor: '督导'
  };
  return labels[role];
}

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  active: '启用',
  inactive: '停用',
  discontinued: '已淘汰'
};

export const MATERIAL_STATUS_COLORS: Record<MaterialStatus, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-600',
  discontinued: 'bg-red-100 text-red-700'
};

export const MATERIAL_RECORD_TYPE_LABELS: Record<MaterialRecordType, string> = {
  borrow: '借出',
  return: '归还',
  loss: '报损',
  restock: '入库',
  adjust: '库存调整'
};

export const MATERIAL_RECORD_TYPE_COLORS: Record<MaterialRecordType, string> = {
  borrow: 'bg-orange-100 text-orange-700',
  return: 'bg-blue-100 text-blue-700',
  loss: 'bg-red-100 text-red-700',
  restock: 'bg-green-100 text-green-700',
  adjust: 'bg-purple-100 text-purple-700'
};

export const MATERIAL_BORROW_STATUS_LABELS: Record<MaterialBorrowStatus, string> = {
  draft: '草稿',
  pending: '待领取',
  borrowed: '已借出',
  returned: '已归还',
  lost: '已报损',
  cancelled: '已取消'
};

export const MATERIAL_BORROW_STATUS_COLORS: Record<MaterialBorrowStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-100 text-yellow-700',
  borrowed: 'bg-orange-100 text-orange-700',
  returned: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-500'
};

export const MATERIAL_CATEGORIES: string[] = ['测温设备', '标识用品', '办公文具', '清洁工具', '安全防护', '其他'];

export const LOSS_REASONS: Array<{ value: string; label: string }> = [
  { value: 'damage', label: '损坏' },
  { value: 'lost', label: '遗失' },
  { value: 'expired', label: '过期' },
  { value: 'wear', label: '正常损耗' },
  { value: 'other', label: '其他' },
];

export const MATERIAL_UNITS: string[] = ['个', '把', '台', '件', '本', '支', '卷', '盒', '箱', '套'];

function padZero(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function generateDatePrefix(): string {
  const now = new Date();
  return `${now.getFullYear()}${padZero(now.getMonth() + 1)}${padZero(now.getDate())}`;
}

function generateRandomSuffix(): string {
  return Math.random().toString(36).substr(2, 4).toUpperCase().padStart(4, '0');
}

export function generateMaterialCode(): string {
  return `MAT-${generateDatePrefix()}-${generateRandomSuffix()}`;
}

export function generateBorrowFormNumber(): string {
  return `BRW-${generateDatePrefix()}-${generateRandomSuffix()}`;
}

export function generateBatchNumber(): string {
  return `BCH-${generateDatePrefix()}-${generateRandomSuffix()}`;
}

export function normalizeMaterialDefaults(partial: Partial<Material> & { id: string; code: string; name: string; category: string; unit: string }): Material {
  return {
    ...partial,
    spec: partial.spec || '',
    description: partial.description || '',
    status: partial.status || 'active',
    totalStock: partial.totalStock ?? 0,
    availableStock: partial.availableStock ?? 0,
    minStock: partial.minStock ?? 0,
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
    synced: partial.synced ?? false,
  };
}

export function normalizeMaterialBorrowFormDefaults(partial: Partial<MaterialBorrowForm> & { id: string; formNumber: string; materialId: string; storeId: string; quantity: number; borrowerId: string; status: MaterialBorrowStatus }): MaterialBorrowForm {
  return {
    ...partial,
    borrowerName: partial.borrowerName || '',
    borrowerRole: partial.borrowerRole || undefined,
    expectedReturnDate: partial.expectedReturnDate || undefined,
    actualReturnDate: partial.actualReturnDate || undefined,
    purpose: partial.purpose || '',
    handbackCondition: partial.handbackCondition || '',
    lossReason: partial.lossReason || '',
    lossQuantity: partial.lossQuantity ?? 0,
    operatorId: partial.operatorId || '',
    operatorName: partial.operatorName || '',
    operatorRole: partial.operatorRole || undefined,
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
    synced: partial.synced ?? false,
    lastSyncError: partial.lastSyncError || undefined,
  };
}

export function normalizeMaterialRecordDefaults(partial: Partial<MaterialRecord> & { id: string; materialId: string; storeId: string; type: MaterialRecordType; quantity: number; beforeStock: number; afterStock: number; operatorId: string; timestamp: string }): MaterialRecord {
  return {
    ...partial,
    formId: partial.formId || undefined,
    operatorName: partial.operatorName || '',
    operatorRole: partial.operatorRole || undefined,
    relatedUserId: partial.relatedUserId || '',
    relatedUserName: partial.relatedUserName || '',
    batchId: partial.batchId || undefined,
    remark: partial.remark || '',
    synced: partial.synced ?? false,
  };
}
