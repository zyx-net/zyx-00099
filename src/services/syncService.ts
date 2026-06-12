import {
  Issue, Conflict, SyncQueueItem, Template, Store, MigrationRecord,
  ReviewPlan, PlanConflict, PlanSyncStatus, User
} from '@/types';
import { generateId } from '@/utils/helpers';
import { buildExportPayload, generateCSVWithVersions, diffTemplateVersions } from './templateVersionService';

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
