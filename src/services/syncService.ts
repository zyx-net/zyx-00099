import {
  Issue, Conflict, SyncQueueItem, Template, Store, MigrationRecord,
  ReviewPlan, PlanConflict, PlanDelayRecord, PlanSyncStatus, User, History,
  HandoverPackage, HandoverValidationResult, HandoverPlanItem, HandoverConflictType,
  HandoverPrecheckGroup, HandoverImportBatch, HandoverImportPrecheckResult,
  Material, MaterialStockBatch, MaterialBorrowForm, MaterialRecord, MaterialSyncQueueItem,
  MaterialBackupWarning, MaterialBackupWarningType, MaterialImportValidationResult, MaterialExportPayload,
  SyncAction,
} from '@/types';
import { generateId } from '@/utils/helpers';
import { buildExportPayload, generateCSVWithVersions, diffTemplateVersions } from './templateVersionService';
import { canCreatePlan, canEditPlan } from '@/utils/permissions';

const mockServerDB: Record<string, Issue> = {};
const mockServerPlanDB: Record<string, ReviewPlan> = {};
const mockMaterialDB: Record<string, Material> = {};
const mockMaterialBorrowDB: Record<string, MaterialBorrowForm> = {};

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

export async function syncMaterialToServer(
  material: Material,
  simulateConflict = false
): Promise<{ success: boolean; conflict?: boolean; remoteMaterial?: Material; error?: string }> {
  await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));

  const existing = mockMaterialDB[material.id];

  if (simulateConflict || (existing && (existing as any).version > (material as any).version)) {
    return {
      success: false,
      conflict: true,
      remoteMaterial: existing || {
        ...material,
        name: material.name + '（远程修改）',
        totalStock: material.totalStock + 10,
        availableStock: material.availableStock + 10,
      }
    };
  }

  mockMaterialDB[material.id] = { ...material };
  return { success: true };
}

export async function syncMaterialBorrowFormToServer(
  form: MaterialBorrowForm,
  simulateConflict = false
): Promise<{ success: boolean; conflict?: boolean; remoteForm?: MaterialBorrowForm; error?: string }> {
  await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));

  const existing = mockMaterialBorrowDB[form.id];

  if (simulateConflict || (existing && (existing as any).version > (form as any).version)) {
    return {
      success: false,
      conflict: true,
      remoteForm: existing || {
        ...form,
        status: form.status === 'borrowed' ? 'returned' : form.status,
        actualReturnDate: new Date().toISOString(),
        handbackCondition: '远程已归还',
      }
    };
  }

  mockMaterialBorrowDB[form.id] = { ...form };
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

export function createMaterialSyncQueueItem(
  entity: Material | MaterialStockBatch | MaterialBorrowForm | MaterialRecord,
  entityType: MaterialSyncQueueItem['entityType'],
  action: SyncAction
): MaterialSyncQueueItem {
  return {
    id: generateId(),
    entityType,
    entityId: entity.id,
    action,
    status: 'pending',
    retryCount: 0,
    payload: { ...entity },
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

export function detectTimeConflict(
  localPlan: ReviewPlan,
  remotePlan: ReviewPlan
): { hasConflict: boolean; localReviewTime: string; remoteReviewTime: string } {
  const hasConflict = localPlan.reviewTime !== remotePlan.reviewTime;
  return {
    hasConflict,
    localReviewTime: localPlan.reviewTime,
    remoteReviewTime: remotePlan.reviewTime,
  };
}

export function mergePlanRemark(
  localPlan: ReviewPlan,
  remotePlan: ReviewPlan
): { reviewTime: string; rectificationNote: string } {
  const localNote = localPlan.rectificationNote || '';
  const remoteNote = remotePlan.rectificationNote || '';
  let mergedNote = '';
  if (localNote && remoteNote && localNote !== remoteNote) {
    mergedNote = [localNote, `--- 远端备注 ---\n${remoteNote}`].join('\n\n');
  } else {
    mergedNote = localNote || remoteNote;
  }
  return {
    reviewTime: remotePlan.reviewTime || localPlan.reviewTime,
    rectificationNote: mergedNote,
  };
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
    planDelayRecords?: PlanDelayRecord[];
    handoverImportBatches?: HandoverImportBatch[];
    handoverPrecheckResults?: HandoverImportPrecheckResult[];
    materials?: Material[];
    materialBatches?: MaterialStockBatch[];
    materialBorrowForms?: MaterialBorrowForm[];
    materialRecords?: MaterialRecord[];
    materialSyncQueue?: MaterialSyncQueueItem[];
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
    data.planDelayRecords || [],
    data.handoverImportBatches || [],
    data.handoverPrecheckResults || [],
    data.materials || [],
    data.materialBatches || [],
    data.materialBorrowForms || [],
    data.materialRecords || [],
    data.materialSyncQueue || [],
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

export function groupHandoverPlansForPrecheck(
  planItems: HandoverPlanItem[],
): Record<HandoverPrecheckGroup, HandoverPlanItem[]> {
  const groups: Record<HandoverPrecheckGroup, HandoverPlanItem[]> = {
    direct_import: [],
    needs_merge: [],
    no_permission: [],
    issue_not_found: [],
    version_behind: [],
  };

  for (const item of planItems) {
    if (item.conflictTypes.includes('issue_not_found')) {
      groups.issue_not_found.push(item);
      continue;
    }
    if (item.conflictTypes.includes('no_permission')) {
      groups.no_permission.push(item);
      continue;
    }
    if (item.conflictTypes.includes('version_behind')) {
      groups.version_behind.push(item);
      continue;
    }
    if (item.conflictTypes.length > 0) {
      groups.needs_merge.push(item);
      continue;
    }
    groups.direct_import.push(item);
  }

  return groups;
}

export function precheckHandoverImport(
  rawPkg: any,
  existingPlans: ReviewPlan[],
  currentUser: User,
  issues: Issue[],
  stores: Store[],
): {
  batch: HandoverImportBatch;
  precheckResult: HandoverImportPrecheckResult;
} {
  const now = new Date();
  const batchId = `batch-${now.getTime().toString(36)}`;
  const precheckId = `precheck-${now.getTime().toString(36)}`;

  if (!isHandoverPackage(rawPkg)) {
    throw new Error('文件不是有效的交接包格式');
  }

  const pkg = rawPkg as HandoverPackage;
  const issue = issues.find(i => i.id === pkg.issueId);
  const issuePlans = existingPlans.filter(p => p.issueId === pkg.issueId);
  const validation = validateHandoverImport(rawPkg, issuePlans, currentUser, issue);

  const grouped = groupHandoverPlansForPrecheck(validation.plans);

  const defaultStrategies: Record<string, 'keep_local' | 'adopt_import' | 'merge'> = {};
  for (const item of validation.plans) {
    if (!item.canImport) continue;
    if (item.conflictTypes.includes('version_behind')) {
      defaultStrategies[item.plan.id] = 'keep_local';
    } else if (item.conflictTypes.includes('local_exists')) {
      defaultStrategies[item.plan.id] = 'adopt_import';
    } else {
      defaultStrategies[item.plan.id] = 'adopt_import';
    }
  }

  const impactSummary = {
    totalPlans: validation.plans.length,
    directImportCount: grouped.direct_import.filter(p => p.canImport).length,
    needsMergeCount: grouped.needs_merge.filter(p => p.canImport).length,
    noPermissionCount: grouped.no_permission.length,
    issueNotFoundCount: grouped.issue_not_found.length,
    versionBehindCount: grouped.version_behind.length,
    newCount: validation.plans.filter(p => !p.localPlan && p.canImport).length,
    updateCount: validation.plans.filter(p => p.localPlan && p.canImport).length,
  };

  const pkgWithSchema = {
    ...pkg,
    schemaVersion: pkg.schemaVersion || '1.0',
  };

  const visibleToUserIds = [currentUser.id];
  if (currentUser.role === 'manager' && issue) {
    const sameStoreManagers = stores
      .filter(s => s.id === issue.storeId)
      .map(() => currentUser.id);
    sameStoreManagers.forEach(id => { if (!visibleToUserIds.includes(id)) visibleToUserIds.push(id); });
  }

  const batch: HandoverImportBatch = {
    id: batchId,
    sourceHandoverPackage: pkgWithSchema,
    precheckResultId: precheckId,
    status: 'prechecked',
    importedPlanIds: [],
    undoPlanSnapshots: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: currentUser.id,
    createdByRole: currentUser.role,
    createdByName: currentUser.name,
    strategies: defaultStrategies,
    hasUndo: false,
    schemaVersion: '2.0',
  };

  const precheckResult: HandoverImportPrecheckResult = {
    id: precheckId,
    batchId,
    handoverPackage: pkgWithSchema,
    groupedPlans: Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, v.map(p => ({
        ...p,
        batchId,
        precheckGroup: k as HandoverPrecheckGroup,
        selectedResolution: defaultStrategies[p.plan.id],
      }))])
    ) as any,
    selectedStrategies: defaultStrategies,
    impactSummary,
    warnings: validation.warnings,
    visibleToUserIds,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: currentUser.id,
    createdByRole: currentUser.role,
  };

  return { batch, precheckResult };
}

export function normalizeHandoverPrecheckResultDefaults(
  partial: Partial<HandoverImportPrecheckResult>,
): HandoverImportPrecheckResult {
  const p = partial || {};
  const emptyGroups: Record<HandoverPrecheckGroup, any[]> = {
    direct_import: [],
    needs_merge: [],
    no_permission: [],
    issue_not_found: [],
    version_behind: [],
  };
  return {
    id: p.id || generateId(),
    batchId: p.batchId || '',
    handoverPackage: p.handoverPackage || ({} as HandoverPackage),
    groupedPlans: p.groupedPlans || emptyGroups,
    selectedStrategies: p.selectedStrategies || {},
    impactSummary: p.impactSummary || {
      totalPlans: 0, directImportCount: 0, needsMergeCount: 0,
      noPermissionCount: 0, issueNotFoundCount: 0, versionBehindCount: 0,
      newCount: 0, updateCount: 0,
    },
    warnings: p.warnings || [],
    visibleToUserIds: p.visibleToUserIds || [],
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    createdBy: p.createdBy || '',
    createdByRole: p.createdByRole || 'supervisor',
  };
}

export function normalizeHandoverBatchDefaults(
  partial: Partial<HandoverImportBatch>,
): HandoverImportBatch {
  const p = partial || {};
  return {
    id: p.id || generateId(),
    sourceHandoverPackage: p.sourceHandoverPackage || ({} as HandoverPackage),
    precheckResultId: p.precheckResultId || '',
    status: p.status || 'prechecked',
    importedPlanIds: p.importedPlanIds || [],
    undoPlanSnapshots: p.undoPlanSnapshots || [],
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    createdBy: p.createdBy || '',
    createdByRole: p.createdByRole || 'supervisor',
    createdByName: p.createdByName || '',
    strategies: p.strategies || {},
    hasUndo: p.hasUndo || false,
    schemaVersion: p.schemaVersion || '2.0',
  };
}

export function validateMaterialBackupImport(
  rawData: any,
  existingMaterials: Material[],
  currentUser: User | null
): MaterialImportValidationResult {
  const warnings: MaterialBackupWarning[] = [];
  const errors: string[] = [];
  const materialsToImport: Material[] = [];
  const batchesToImport: MaterialStockBatch[] = [];
  const borrowFormsToImport: MaterialBorrowForm[] = [];
  const recordsToImport: MaterialRecord[] = [];

  if (!rawData || typeof rawData !== 'object') {
    return {
      valid: false,
      warnings,
      errors: ['导入文件不是有效的 JSON 对象'],
      materialsToImport: [],
      batchesToImport: [],
      borrowFormsToImport: [],
      recordsToImport: [],
    };
  }

  const rawMaterials: Material[] = Array.isArray(rawData.materials) ? rawData.materials : [];
  const rawBatches: MaterialStockBatch[] = Array.isArray(rawData.materialBatches) ? rawData.materialBatches : [];
  const rawBorrowForms: MaterialBorrowForm[] = Array.isArray(rawData.materialBorrowForms) ? rawData.materialBorrowForms : [];
  const rawRecords: MaterialRecord[] = Array.isArray(rawData.materialRecords) ? rawData.materialRecords : [];

  if (rawMaterials.length === 0 && rawBatches.length === 0 && rawBorrowForms.length === 0 && rawRecords.length === 0) {
    warnings.push({
      type: 'material_missing_abnormal',
      message: '导入文件中未检测到任何物资相关数据。',
    });
  }

  const existingMaterialCodeSet = new Set(existingMaterials.map(m => m.code));
  const now = new Date().toISOString();

  for (let i = 0; i < rawMaterials.length; i++) {
    const mat: any = { ...rawMaterials[i] };
    const missingFields: string[] = [];
    const appliedDefaults: Record<string, any> = {};

    if (!mat.code || mat.code.toString().trim() === '') {
      missingFields.push('code');
      const defaultCode = `IMP-${Date.now()}-${i}`;
      mat.code = defaultCode;
      appliedDefaults.code = defaultCode;
    }

    if (!mat.storeId || mat.storeId.toString().trim() === '') {
      missingFields.push('storeId');
    }

    if (!mat.operatorId || mat.operatorId.toString().trim() === '') {
      missingFields.push('operatorId');
      if (currentUser) {
        mat.operatorId = currentUser.id;
        appliedDefaults.operatorId = currentUser.id;
      }
    }

    if (typeof mat.totalStock !== 'number' || isNaN(mat.totalStock)) {
      missingFields.push('totalStock');
      mat.totalStock = 0;
      appliedDefaults.totalStock = 0;
    }

    if (typeof mat.availableStock !== 'number' || isNaN(mat.availableStock)) {
      missingFields.push('availableStock');
      mat.availableStock = 0;
      appliedDefaults.availableStock = 0;
    }

    if (mat.abnormalRecord && mat.abnormalRecord.toString().trim() !== '') {
      warnings.push({
        type: 'material_missing_abnormal',
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        message: `物资「${mat.name || mat.code || mat.id || '未知'}」存在异常记录：${mat.abnormalRecord}，请注意复核。`,
      });
    }

    if (missingFields.length > 0) {
      warnings.push({
        type: missingFields.includes('code') ? 'material_missing_code' : missingFields.includes('storeId') ? 'material_missing_store' : missingFields.includes('operatorId') ? 'material_missing_operator' : 'material_invalid_quantity',
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        message: `物资「${mat.name || mat.code || mat.id || '未知'}」缺少字段：${missingFields.join('、')}，${Object.keys(appliedDefaults).length > 0 ? '已应用默认值：' + Object.entries(appliedDefaults).map(([k, v]) => `${k}=${v}`).join('、') : '请手动补全。'}`,
        missingFields,
        appliedDefaults,
      });
    }

    if (!mat.id) mat.id = generateId();
    if (!mat.name) {
      mat.name = '未命名物资';
      appliedDefaults.name = mat.name;
    }
    if (!mat.category) {
      mat.category = '未分类';
      appliedDefaults.category = mat.category;
    }
    if (!mat.unit) {
      mat.unit = '件';
      appliedDefaults.unit = mat.unit;
    }
    if (!mat.status) {
      mat.status = 'active';
      appliedDefaults.status = mat.status;
    }
    if (!mat.createdAt) mat.createdAt = now;
    if (!mat.updatedAt) mat.updatedAt = now;
    if (typeof mat.synced !== 'boolean') {
      mat.synced = false;
      appliedDefaults.synced = false;
    }

    if (existingMaterialCodeSet.has(mat.code)) {
      warnings.push({
        type: 'material_unknown_category',
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        message: `物资编号 ${mat.code} 已存在，导入时将跳过或需要合并处理。`,
      });
    }

    materialsToImport.push(mat as Material);
  }

  for (let i = 0; i < rawBatches.length; i++) {
    const batch: any = { ...rawBatches[i] };
    const missingFields: string[] = [];
    const appliedDefaults: Record<string, any> = {};

    if (!batch.id) batch.id = generateId();
    if (!batch.materialId) {
      missingFields.push('materialId');
    }
    if (!batch.storeId) {
      missingFields.push('storeId');
    }
    if (!batch.batchNumber || batch.batchNumber.toString().trim() === '') {
      missingFields.push('batchNumber');
      batch.batchNumber = `BATCH-${Date.now()}-${i}`;
      appliedDefaults.batchNumber = batch.batchNumber;
    }
    if (typeof batch.quantity !== 'number' || isNaN(batch.quantity)) {
      batch.quantity = 0;
      appliedDefaults.quantity = 0;
    }
    if (!batch.receivedDate) batch.receivedDate = now;
    if (typeof batch.synced !== 'boolean') batch.synced = false;

    if (missingFields.length > 0) {
      warnings.push({
        type: missingFields.includes('batchNumber') ? 'material_missing_batch' : 'material_missing_code',
        message: `库存批次「${batch.batchNumber || batch.id || '未知'}」缺少字段：${missingFields.join('、')}，${Object.keys(appliedDefaults).length > 0 ? '已应用默认值：' + Object.entries(appliedDefaults).map(([k, v]) => `${k}=${v}`).join('、') : '请手动补全。'}`,
        missingFields,
        appliedDefaults,
      });
    }

    batchesToImport.push(batch as MaterialStockBatch);
  }

  for (let i = 0; i < rawBorrowForms.length; i++) {
    const form: any = { ...rawBorrowForms[i] };
    const missingFields: string[] = [];
    const appliedDefaults: Record<string, any> = {};

    if (!form.id) form.id = generateId();
    if (!form.formNumber) {
      form.formNumber = `BRW-${Date.now()}-${i}`;
      appliedDefaults.formNumber = form.formNumber;
    }
    if (!form.materialId) {
      missingFields.push('materialId');
    }
    if (!form.storeId) {
      missingFields.push('storeId');
    }
    if (!form.borrowerId) {
      missingFields.push('borrowerId');
    }
    if (typeof form.quantity !== 'number' || isNaN(form.quantity)) {
      form.quantity = 0;
      appliedDefaults.quantity = 0;
    }
    if (!form.status) {
      form.status = 'borrowed';
      appliedDefaults.status = form.status;
    }
    if (!form.createdAt) form.createdAt = now;
    if (!form.updatedAt) form.updatedAt = now;
    if (typeof form.synced !== 'boolean') form.synced = false;

    if (missingFields.length > 0) {
      warnings.push({
        type: missingFields.includes('borrowerId') ? 'material_missing_operator' : 'material_missing_code',
        formId: form.id,
        message: `借用单「${form.formNumber || form.id || '未知'}」缺少字段：${missingFields.join('、')}，${Object.keys(appliedDefaults).length > 0 ? '已应用默认值：' + Object.entries(appliedDefaults).map(([k, v]) => `${k}=${v}`).join('、') : '请手动补全。'}`,
        missingFields,
        appliedDefaults,
      });
    }

    borrowFormsToImport.push(form as MaterialBorrowForm);
  }

  for (let i = 0; i < rawRecords.length; i++) {
    const rec: any = { ...rawRecords[i] };
    const missingFields: string[] = [];
    const appliedDefaults: Record<string, any> = {};

    if (!rec.id) rec.id = generateId();
    if (!rec.materialId) {
      missingFields.push('materialId');
    }
    if (!rec.storeId) {
      missingFields.push('storeId');
    }
    if (!rec.operatorId) {
      missingFields.push('operatorId');
      if (currentUser) {
        rec.operatorId = currentUser.id;
        appliedDefaults.operatorId = currentUser.id;
      }
    }
    if (!rec.type) {
      rec.type = 'in';
      appliedDefaults.type = rec.type;
    }
    if (typeof rec.quantity !== 'number' || isNaN(rec.quantity)) {
      rec.quantity = 0;
      appliedDefaults.quantity = 0;
    }
    if (typeof rec.beforeStock !== 'number' || isNaN(rec.beforeStock)) {
      rec.beforeStock = 0;
      appliedDefaults.beforeStock = 0;
    }
    if (typeof rec.afterStock !== 'number' || isNaN(rec.afterStock)) {
      rec.afterStock = 0;
      appliedDefaults.afterStock = 0;
    }
    if (!rec.timestamp) rec.timestamp = now;
    if (typeof rec.synced !== 'boolean') rec.synced = false;

    if (missingFields.length > 0) {
      warnings.push({
        type: missingFields.includes('operatorId') ? 'material_missing_operator' : 'material_missing_code',
        message: `物资记录「${rec.id || '未知'}」缺少字段：${missingFields.join('、')}，${Object.keys(appliedDefaults).length > 0 ? '已应用默认值：' + Object.entries(appliedDefaults).map(([k, v]) => `${k}=${v}`).join('、') : '请手动补全。'}`,
        missingFields,
        appliedDefaults,
      });
    }

    recordsToImport.push(rec as MaterialRecord);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    materialsToImport,
    batchesToImport,
    borrowFormsToImport,
    recordsToImport,
  };
}

export function exportMaterialToJSON(
  data: {
    materials: Material[];
    materialBatches: MaterialStockBatch[];
    materialBorrowForms: MaterialBorrowForm[];
    materialRecords: MaterialRecord[];
    materialSyncQueue: MaterialSyncQueueItem[];
    exportedBy?: User;
  }
): string {
  const payload = buildMaterialExportPayload(
    data.materials,
    data.materialBatches,
    data.materialBorrowForms,
    data.materialRecords,
    data.materialSyncQueue,
    data.exportedBy,
  );
  return JSON.stringify(payload, null, 2);
}

export function buildMaterialExportPayload(
  materials: Material[],
  batches: MaterialStockBatch[],
  borrowForms: MaterialBorrowForm[],
  records: MaterialRecord[],
  syncQueue: MaterialSyncQueueItem[],
  exportedBy?: User
): MaterialExportPayload {
  return {
    materials,
    materialBatches: batches,
    materialBorrowForms: borrowForms,
    materialRecords: records,
    materialSyncQueue: syncQueue,
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy
      ? { id: exportedBy.id, role: exportedBy.role, name: exportedBy.name }
      : undefined,
    schemaVersion: '1.0',
  };
}

export function parseMaterialBackupPayload(
  raw: any
): { valid: boolean; payload?: MaterialExportPayload; warnings: MaterialBackupWarning[]; errors: string[] } {
  const warnings: MaterialBackupWarning[] = [];
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      warnings,
      errors: ['备份数据不是有效的 JSON 对象'],
    };
  }

  const currentVersion = '1.0';
  const declaredVersion: string = raw.schemaVersion || '';

  if (!declaredVersion) {
    warnings.push({
      type: 'material_missing_abnormal',
      message: `备份文件未指定 schemaVersion，当前支持版本 v${currentVersion}，已启用兼容模式。`,
    });
  } else if (declaredVersion !== currentVersion) {
    warnings.push({
      type: 'material_missing_abnormal',
      message: `备份 schema 版本为 v${declaredVersion}，当前支持版本 v${currentVersion}，已启用兼容模式。`,
    });
  }

  const payload: any = {
    schemaVersion: currentVersion,
    exportedAt: raw.exportedAt || new Date().toISOString(),
    exportedBy: raw.exportedBy || undefined,
  };

  const requiredArrays = [
    { key: 'materials', label: '物资台账' },
    { key: 'materialBatches', label: '库存批次' },
    { key: 'materialBorrowForms', label: '借用单' },
    { key: 'materialRecords', label: '出入库记录' },
  ];

  for (const { key, label } of requiredArrays) {
    if (!Array.isArray(raw[key])) {
      warnings.push({
        type: 'material_missing_abnormal',
        message: `备份文件缺少 ${label} 数组（${key}），已使用空数组代替。`,
      });
      (payload as any)[key] = [];
    } else {
      (payload as any)[key] = raw[key];
    }
  }

  if (!Array.isArray(raw.materialSyncQueue)) {
    payload.materialSyncQueue = [];
  } else {
    payload.materialSyncQueue = raw.materialSyncQueue;
  }

  return {
    valid: errors.length === 0,
    payload: payload as MaterialExportPayload,
    warnings,
    errors,
  };
}

export function normalizeMaterialBackupDefaults(partial: any, type: string): any {
  const now = new Date().toISOString();
  const p = partial || {};

  switch (type) {
    case 'material':
      return {
        id: p.id || generateId(),
        code: p.code || '',
        name: p.name || '未命名物资',
        category: p.category || '未分类',
        unit: p.unit || '件',
        storeId: p.storeId || '',
        operatorId: p.operatorId || '',
        totalStock: typeof p.totalStock === 'number' ? p.totalStock : 0,
        availableStock: typeof p.availableStock === 'number' ? p.availableStock : 0,
        status: p.status || 'active',
        abnormalRecord: p.abnormalRecord || '',
        remark: p.remark || '',
        createdAt: p.createdAt || now,
        updatedAt: p.updatedAt || now,
        synced: typeof p.synced === 'boolean' ? p.synced : false,
      };
    case 'material_batch':
      return {
        id: p.id || generateId(),
        materialId: p.materialId || '',
        storeId: p.storeId || '',
        batchNumber: p.batchNumber || '',
        quantity: typeof p.quantity === 'number' ? p.quantity : 0,
        receivedDate: p.receivedDate || now,
        remark: p.remark || '',
        createdAt: p.createdAt || now,
        updatedAt: p.updatedAt || now,
        synced: typeof p.synced === 'boolean' ? p.synced : false,
      };
    case 'material_borrow_form':
      return {
        id: p.id || generateId(),
        formNumber: p.formNumber || '',
        materialId: p.materialId || '',
        storeId: p.storeId || '',
        borrowerId: p.borrowerId || '',
        borrowerName: p.borrowerName || '',
        quantity: typeof p.quantity === 'number' ? p.quantity : 0,
        borrowDate: p.borrowDate || now,
        expectedReturnDate: p.expectedReturnDate || '',
        actualReturnDate: p.actualReturnDate || '',
        status: p.status || 'borrowed',
        purpose: p.purpose || '',
        handbackCondition: p.handbackCondition || '',
        remark: p.remark || '',
        createdAt: p.createdAt || now,
        updatedAt: p.updatedAt || now,
        synced: typeof p.synced === 'boolean' ? p.synced : false,
      };
    case 'material_record':
      return {
        id: p.id || generateId(),
        materialId: p.materialId || '',
        storeId: p.storeId || '',
        operatorId: p.operatorId || '',
        type: p.type || 'in',
        quantity: typeof p.quantity === 'number' ? p.quantity : 0,
        beforeStock: typeof p.beforeStock === 'number' ? p.beforeStock : 0,
        afterStock: typeof p.afterStock === 'number' ? p.afterStock : 0,
        batchNumber: p.batchNumber || '',
        timestamp: p.timestamp || now,
        remark: p.remark || '',
        createdAt: p.createdAt || now,
        updatedAt: p.updatedAt || now,
        synced: typeof p.synced === 'boolean' ? p.synced : false,
      };
    default:
      return p;
  }
}
