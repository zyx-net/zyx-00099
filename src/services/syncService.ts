import {
  Issue, Conflict, SyncQueueItem, Template, Store, MigrationRecord,
  ReviewPlan, PlanConflict, PlanSyncStatus, User, History,
  HandoverPackage, HandoverValidationResult, HandoverPlanItem, HandoverConflictType,
} from '@/types';
import { generateId } from '@/utils/helpers';
import { buildExportPayload, generateCSVWithVersions, diffTemplateVersions } from './templateVersionService';
import { canCreatePlan, canEditPlan } from '@/utils/permissions';

const mockServerDB: Record<string, Issue> = {};
const mockServerPlanDB: Record<string, ReviewPlan> = {};

export interface SyncResult {
  success: boolean;
  conflict?: boolean;
  remoteVersion?: Issue;
  error?: string;
  templateVersionMismatch?: {
    localVersion: string;
    remoteVersion: string;
  };
}

export async function syncToServer(issue: Issue, simulateConflict = false): Promise<SyncResult> {
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

  const existing = mockServerDB[issue.id];

  if (existing) {
    const localTplVer = issue.templateVersion || '1.0';
    const remoteTplVer = existing.templateVersion || '1.0';
    if (localTplVer !== remoteTplVer) {
      return {
        success: false,
        conflict: true,
        remoteVersion: { ...existing },
        templateVersionMismatch: {
          localVersion: localTplVer,
          remoteVersion: remoteTplVer,
        },
      };
    }
  }

  if (simulateConflict || (existing && existing.version > issue.version)) {
    return {
      success: false,
      conflict: true,
      remoteVersion: existing || { ...issue, version: issue.version + 1, title: issue.title + '（远程修改）' }
    };
  }

  const version = existing ? existing.version + 1 : 1;
  mockServerDB[issue.id] = { ...issue, version };
  return { success: true };
}

export function createConflict(
  localVersion: Issue,
  remoteVersion: Issue,
  templates?: Template[]
): Conflict {
  let templateVersionConflict: Conflict['templateVersionConflict'] | undefined;

  const localTplVer = localVersion.templateVersion || '1.0';
  const remoteTplVer = remoteVersion.templateVersion || '1.0';

  if (localTplVer !== remoteTplVer && templates) {
    const localTpl = templates.find(t => t.id === localVersion.templateId);
    const remoteTpl = templates.find(t => t.id === remoteVersion.templateId);
    if (localTpl && remoteTpl) {
      const diff = diffTemplateVersions(localTpl, remoteTpl, [localVersion, remoteVersion]);
      templateVersionConflict = {
        localTemplateVersion: localTplVer,
        remoteTemplateVersion: remoteTplVer,
        diff,
      };
    } else {
      templateVersionConflict = {
        localTemplateVersion: localTplVer,
        remoteTemplateVersion: remoteTplVer,
      };
    }
  }

  return {
    id: generateId(),
    issueId: localVersion.id,
    localVersion: { ...localVersion },
    remoteVersion: { ...remoteVersion },
    status: 'pending',
    detectedAt: new Date().toISOString(),
    templateVersionConflict,
  };
}

export function createSyncQueueItem(issue: Issue, action: 'create' | 'update' | 'delete'): SyncQueueItem {
  return {
    id: generateId(),
    issueId: issue.id,
    action,
    status: 'pending',
    retryCount: 0,
    payload: { ...issue },
    templateVersionAtSync: issue.templateVersion || '1.0',
    entityType: 'issue',
  };
}

export interface PlanSyncResult {
  success: boolean;
  conflict?: boolean;
  remotePlan?: ReviewPlan;
  error?: string;
}

export async function syncPlanToServer(plan: ReviewPlan, simulateConflict = false): Promise<PlanSyncResult> {
  await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));

  const existing = mockServerPlanDB[plan.id];

  if (simulateConflict || (existing && existing.version > plan.version)) {
    return {
      success: false,
      conflict: true,
      remotePlan: existing || {
        ...plan,
        version: plan.version + 1,
        reviewTime: new Date(Date.now() + 86400000).toISOString(),
        assigneeId: plan.assigneeId + '-remote-changed',
        assigneeName: '远程修改的责任人',
        rectificationNote: plan.rectificationNote + '（远程已修改）',
      }
    };
  }

  const version = existing ? existing.version + 1 : 1;
  mockServerPlanDB[plan.id] = { ...plan, version };
  return { success: true };
}

export function createPlanConflict(
  localPlan: ReviewPlan,
  remotePlan: ReviewPlan,
): PlanConflict {
  return {
    id: generateId(),
    planId: localPlan.id,
    issueId: localPlan.issueId,
    localPlan: { ...localPlan },
    remotePlan: { ...remotePlan },
    status: 'pending',
    detectedAt: new Date().toISOString(),
  };
}

export function createPlanSyncQueueItem(
  plan: ReviewPlan,
  action: 'create' | 'update' | 'delete'
): SyncQueueItem {
  const dummyIssue: Issue = {
    id: plan.issueId,
    title: '',
    storeId: '',
    templateId: '',
    templateVersion: '1.0',
    creatorId: plan.creatorId,
    status: 'submitted',
    data: {},
    version: 1,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    synced: false,
  };
  return {
    id: generateId(),
    issueId: plan.issueId,
    action,
    status: 'pending',
    retryCount: 0,
    payload: dummyIssue,
    entityType: 'review_plan',
    planPayload: { ...plan },
  };
}

export function diffReviewPlans(
  localPlan: ReviewPlan,
  remotePlan: ReviewPlan
): Array<{ field: string; local: any; remote: any; label: string }> {
  const diffs: Array<{ field: string; local: any; remote: any; label: string }> = [];
  const fieldLabels: Record<string, string> = {
    reviewTime: '复查时间',
    assigneeId: '责任人',
    assigneeName: '责任人姓名',
    rectificationNote: '整改说明',
    attachments: '附件',
  };
  const compareFields = ['reviewTime', 'assigneeId', 'assigneeName', 'rectificationNote', 'attachments'];
  for (const field of compareFields) {
    const localVal = (localPlan as any)[field];
    const remoteVal = (remotePlan as any)[field];
    if (JSON.stringify(localVal) !== JSON.stringify(remoteVal)) {
      diffs.push({
        field,
        local: localVal,
        remote: remoteVal,
        label: fieldLabels[field] || field,
      });
    }
  }
  return diffs;
}

export function mergeReviewPlans(localPlan: ReviewPlan, remotePlan: ReviewPlan): ReviewPlan {
  return {
    ...localPlan,
    version: Math.max(localPlan.version, remotePlan.version) + 1,
    reviewTime: remotePlan.reviewTime || localPlan.reviewTime,
    assigneeId: remotePlan.assigneeId || localPlan.assigneeId,
    assigneeName: remotePlan.assigneeName || localPlan.assigneeName,
    rectificationNote: [
      localPlan.rectificationNote,
      remotePlan.rectificationNote,
    ].filter(Boolean).join('\n\n--- 合并分割线 ---\n\n'),
    attachments: [
      ...(localPlan.attachments || []),
      ...(remotePlan.attachments || []).filter(
        ra => !(localPlan.attachments || []).some(la => la.id === ra.id)
      ),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function exportToJSON(
  data: {
    issues: Issue[];
    stores: Store[];
    templates: Template[];
    migrations?: MigrationRecord[];
    unresolvedConflicts?: Conflict[];
    reviewPlans?: ReviewPlan[];
    unresolvedPlanConflicts?: PlanConflict[];
    exportedAt?: string;
    exportedBy?: { id: string; role: any; name: string };
  }
): string {
  const payload = buildExportPayload(
    data.issues,
    data.stores,
    data.templates,
    data.migrations || [],
    data.unresolvedConflicts || [],
    data.exportedBy as any,
    data.reviewPlans || [],
    data.unresolvedPlanConflicts || [],
  );
  return JSON.stringify(payload, null, 2);
}

export function exportToCSV(
  issues: Issue[],
  stores: { id: string; name: string }[],
  templates: Template[],
  migrations: MigrationRecord[] = [],
  reviewPlans: ReviewPlan[] = []
): string {
  return generateCSVWithVersions(issues, stores, templates, migrations, reviewPlans);
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function validateRequiredFields(data: Record<string, any>, requiredKeys: string[]): { valid: boolean; missing: string[] } {
  const missing = requiredKeys.filter(key => !data[key] || data[key].toString().trim() === '');
  return { valid: missing.length === 0, missing };
}

export function generateIssueNumber(storeId: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${storeId.slice(0, 3).toUpperCase()}-${dateStr}-${random}`;
}

export function buildHandoverPackage(
  issue: Issue,
  reviewPlans: ReviewPlan[],
  planConflicts: PlanConflict[],
  histories: History[],
  exportedBy: User,
  storeName?: string,
): HandoverPackage {
  const attachmentSummary = reviewPlans.map(plan => ({
    planId: plan.id,
    planReviewTime: plan.reviewTime,
    attachments: (plan.attachments || []).map(att => ({
      ...att,
      url: undefined,
      placeholder: true,
    })),
    note: plan.rectificationNote,
  }));

  const syncStatusSummary = reviewPlans.map(plan => ({
    planId: plan.id,
    status: plan.status,
    lastSyncError: plan.lastSyncError,
    lastSyncAttempt: plan.lastSyncAttempt,
  }));

  const keyHistoryActions: string[] = [
    'plan_create', 'plan_update', 'plan_delete',
    'plan_conflict_resolve', 'plan_sync', 'plan_sync_fail',
    'submit', 'reject', 'close', 'reopen',
  ];
  const keyHistories = histories
    .filter(h => h.issueId === issue.id && keyHistoryActions.includes(h.action))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20);

  const normalizedPlans = reviewPlans.map(plan => ({
    ...plan,
    attachments: (plan.attachments || []).map(att => ({
      ...att,
      url: undefined,
      placeholder: true,
    })),
  }));

  return {
    packageType: 'handover',
    schemaVersion: '1.0',
    issueId: issue.id,
    issueTitle: issue.title,
    storeId: issue.storeId,
    storeName,
    reviewPlans: normalizedPlans,
    planConflicts,
    keyHistories,
    attachmentSummary,
    syncStatusSummary,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      id: exportedBy.id,
      role: exportedBy.role,
      name: exportedBy.name,
    },
  };
}

export function exportHandoverPackage(pkg: HandoverPackage): string {
  return JSON.stringify(pkg, null, 2);
}

export function downloadHandoverPackage(pkg: HandoverPackage): void {
  const content = exportHandoverPackage(pkg);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `handover-${pkg.issueId.slice(0, 8)}-${dateStr}.json`;
  downloadFile(content, filename, 'application/json');
}

export function isHandoverPackage(raw: any): boolean {
  return raw && typeof raw === 'object' && raw.packageType === 'handover';
}

export function validateHandoverImport(
  raw: any,
  existingPlans: ReviewPlan[],
  currentUser: User | null,
  issue?: Issue,
): HandoverValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const planItems: HandoverPlanItem[] = [];

  if (!isHandoverPackage(raw)) {
    return {
      valid: false,
      issueId: '',
      plans: [],
      warnings: [],
      errors: ['文件不是有效的交接包格式'],
      summary: { totalPlans: 0, canImportCount: 0, conflictCount: 0, newPlansCount: 0 },
    };
  }

  const pkg = raw as HandoverPackage;

  if (!pkg.reviewPlans || !Array.isArray(pkg.reviewPlans)) {
    errors.push('交接包缺少复查计划数据');
    return {
      valid: false,
      issueId: pkg.issueId || '',
      plans: [],
      warnings,
      errors,
      summary: { totalPlans: 0, canImportCount: 0, conflictCount: 0, newPlansCount: 0 },
    };
  }

  if (!currentUser) {
    errors.push('请先选择身份后再导入交接包');
    return {
      valid: false,
      issueId: pkg.issueId || '',
      plans: [],
      warnings,
      errors,
      summary: { totalPlans: 0, canImportCount: 0, conflictCount: 0, newPlansCount: 0 },
    };
  }

  const existingPlanMap = new Map(existingPlans.map(p => [p.id, p]));
  let canImportCount = 0;
  let conflictCount = 0;
  let newPlansCount = 0;

  for (const plan of pkg.reviewPlans) {
    const conflictTypes: HandoverConflictType[] = [];
    const localPlan = existingPlanMap.get(plan.id);
    let canImport = true;
    let reason = '';

    if (!issue) {
      conflictTypes.push('issue_not_found');
      canImport = false;
      reason = '本地找不到对应问题，无法导入';
      warnings.push(`计划 ${plan.id.slice(0, 8)}...：${reason}`);
    }

    if (issue && !canCreatePlan(currentUser, issue)) {
      conflictTypes.push('no_permission');
      canImport = false;
      reason = '当前用户无权为该问题创建/修改复查计划';
      warnings.push(`计划 ${plan.id.slice(0, 8)}...：${reason}`);
    }

    if (localPlan) {
      conflictTypes.push('local_exists');
      conflictCount++;

      if (localPlan.version > plan.version) {
        conflictTypes.push('version_behind');
        warnings.push(`计划 ${plan.id.slice(0, 8)}...：导入版本 (v${plan.version}) 落后于本地版本 (v${localPlan.version})`);
      }

      if (localPlan.assigneeId !== plan.assigneeId) {
        conflictTypes.push('assignee_mismatch');
        warnings.push(`计划 ${plan.id.slice(0, 8)}...：责任人不一致（本地: ${localPlan.assigneeName || localPlan.assigneeId}，导入: ${plan.assigneeName || plan.assigneeId}）`);
      }

      if (issue && !canEditPlan(currentUser, localPlan, issue)) {
        conflictTypes.push('no_permission');
        canImport = false;
        reason = '无权修改本地已存在的复查计划';
        warnings.push(`计划 ${plan.id.slice(0, 8)}...：${reason}`);
      }
    } else {
      newPlansCount++;
    }

    if (canImport) {
      canImportCount++;
    }

    planItems.push({
      plan,
      conflictTypes,
      localPlan,
      canImport,
      reason,
    });
  }

  if (pkg.exportedBy) {
    warnings.push(`交接包由 ${pkg.exportedBy.name} (${pkg.exportedBy.role === 'supervisor' ? '督导' : pkg.exportedBy.role === 'manager' ? '店长' : '巡检员'}) 于 ${new Date(pkg.exportedAt).toLocaleString('zh-CN')} 导出`);
  }

  return {
    valid: errors.length === 0 && planItems.some(p => p.canImport),
    issueId: pkg.issueId,
    issueTitle: pkg.issueTitle,
    plans: planItems,
    warnings,
    errors,
    summary: {
      totalPlans: planItems.length,
      canImportCount,
      conflictCount,
      newPlansCount,
    },
  };
}

export function mergeHandoverPlan(
  localPlan: ReviewPlan,
  importPlan: ReviewPlan,
): ReviewPlan {
  const mergedAttachments = [
    ...(localPlan.attachments || []),
    ...(importPlan.attachments || []).filter(
      ia => !(localPlan.attachments || []).some(la => la.id === ia.id),
    ),
  ];

  const mergedNote = [
    localPlan.rectificationNote,
    `--- 交接包导入备注 ---\n${importPlan.rectificationNote}`,
  ].filter(Boolean).join('\n\n');

  return {
    ...localPlan,
    version: Math.max(localPlan.version, importPlan.version) + 1,
    rectificationNote: mergedNote,
    attachments: mergedAttachments,
    reviewTime: importPlan.reviewTime || localPlan.reviewTime,
    assigneeId: importPlan.assigneeId || localPlan.assigneeId,
    assigneeName: importPlan.assigneeName || localPlan.assigneeName,
    assigneeRole: importPlan.assigneeRole || localPlan.assigneeRole,
    synced: false,
    updatedAt: new Date().toISOString(),
  };
}

export function applyHandoverResolution(
  item: HandoverPlanItem,
  resolution: 'keep_local' | 'adopt_import' | 'merge',
): ReviewPlan | null {
  if (!item.canImport) return null;

  if (resolution === 'keep_local') {
    return item.localPlan || null;
  }

  if (resolution === 'adopt_import') {
    if (item.localPlan) {
      return {
        ...item.plan,
        id: item.localPlan.id,
        version: Math.max(item.localPlan.version, item.plan.version) + 1,
        synced: false,
        updatedAt: new Date().toISOString(),
        createdAt: item.localPlan.createdAt,
      };
    }
    return {
      ...item.plan,
      version: item.plan.version,
      synced: false,
      updatedAt: new Date().toISOString(),
    };
  }

  if (resolution === 'merge' && item.localPlan) {
    return mergeHandoverPlan(item.localPlan, item.plan);
  }

  return null;
}
