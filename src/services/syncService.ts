import { Issue, Conflict, SyncQueueItem, Template, Store, MigrationRecord } from '@/types';
import { generateId } from '@/utils/helpers';
import { buildExportPayload, generateCSVWithVersions, diffTemplateVersions } from './templateVersionService';

const mockServerDB: Record<string, Issue> = {};

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
  };
}

export function exportToJSON(
  data: {
    issues: Issue[];
    stores: Store[];
    templates: Template[];
    migrations?: MigrationRecord[];
    unresolvedConflicts?: Conflict[];
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
    data.exportedBy as any
  );
  return JSON.stringify(payload, null, 2);
}

export function exportToCSV(
  issues: Issue[],
  stores: { id: string; name: string }[],
  templates: Template[],
  migrations: MigrationRecord[] = []
): string {
  return generateCSVWithVersions(issues, stores, templates, migrations);
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
