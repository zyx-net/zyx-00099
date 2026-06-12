import { Issue, Conflict, SyncQueueItem } from '@/types';
import { generateId } from '@/utils/helpers';

const mockServerDB: Record<string, Issue> = {};

export interface SyncResult {
  success: boolean;
  conflict?: boolean;
  remoteVersion?: Issue;
  error?: string;
}

export async function syncToServer(issue: Issue, simulateConflict = false): Promise<SyncResult> {
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

  const existing = mockServerDB[issue.id];

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

export function createConflict(localVersion: Issue, remoteVersion: Issue): Conflict {
  return {
    id: generateId(),
    issueId: localVersion.id,
    localVersion: { ...localVersion },
    remoteVersion: { ...remoteVersion },
    status: 'pending',
    detectedAt: new Date().toISOString()
  };
}

export function createSyncQueueItem(issue: Issue, action: 'create' | 'update' | 'delete'): SyncQueueItem {
  return {
    id: generateId(),
    issueId: issue.id,
    action,
    status: 'pending',
    retryCount: 0,
    payload: { ...issue }
  };
}

export function exportToJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function exportToCSV(issues: Issue[], stores: { id: string; name: string }[], templates: { id: string; name: string }[]): string {
  const storeMap = new Map(stores.map(s => [s.id, s.name]));
  const templateMap = new Map(templates.map(t => [t.id, t.name]));

  const headers = ['问题编号', '标题', '门店', '模板', '状态', '优先级', '创建时间', '更新时间', '是否同步', '版本号'];
  const rows = issues.map(issue => [
    issue.id,
    issue.title,
    storeMap.get(issue.storeId) || issue.storeId,
    templateMap.get(issue.templateId) || issue.templateId,
    issue.status,
    issue.priority || 'medium',
    issue.createdAt,
    issue.updatedAt,
    issue.synced ? '是' : '否',
    issue.version
  ]);

  return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
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
