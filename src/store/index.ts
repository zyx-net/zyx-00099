import { create } from 'zustand';
import {
  User, Issue, Store, Template, History, Conflict, SyncQueueItem,
  IssueStatus, UserRole, ToastMessage, HistoryAction
} from '@/types';
import * as db from '@/lib/db';
import { generateId } from '@/utils/helpers';
import {
  syncToServer, createConflict, createSyncQueueItem,
  exportToJSON, exportToCSV, downloadFile, validateRequiredFields
} from '@/services/syncService';

interface AppState {
  currentUser: User | null;
  isOnline: boolean;
  stores: Store[];
  templates: Template[];
  issues: Issue[];
  syncQueue: SyncQueueItem[];
  conflicts: Conflict[];
  histories: History[];
  toasts: ToastMessage[];
  isLoading: boolean;

  init: () => Promise<void>;
  setCurrentUser: (user: User | null) => void;
  setOnline: (online: boolean) => void;
  toggleOnline: () => void;

  importStores: (stores: Store[]) => Promise<void>;
  importTemplates: (templates: Template[]) => Promise<void>;

  createIssue: (issue: Omit<Issue, 'version' | 'createdAt' | 'updatedAt' | 'synced'> & { id?: string }) => Promise<{ success: boolean; error?: string; issue?: Issue }>;
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<void>;
  updateIssueStatus: (id: string, status: IssueStatus, operatorId: string, remark?: string) => Promise<{ success: boolean; error?: string }>;

  addToSyncQueue: (issue: Issue, action: 'create' | 'update' | 'delete') => Promise<void>;
  processSyncQueue: (simulateConflict?: boolean) => Promise<void>;
  retrySyncItem: (itemId: string) => Promise<void>;
  clearCompletedSync: () => Promise<void>;

  resolveConflict: (conflictId: string, resolution: 'local' | 'remote' | 'merge') => Promise<void>;

  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;

  exportData: (format: 'json' | 'csv') => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  isOnline: true,
  stores: [],
  templates: [],
  issues: [],
  syncQueue: [],
  conflicts: [],
  histories: [],
  toasts: [],
  isLoading: false,

  init: async () => {
    set({ isLoading: true });
    try {
      const [stores, templates, issues, syncQueue, conflicts, histories, currentUser] = await Promise.all([
        db.getAllStores(),
        db.getAllTemplates(),
        db.getAllIssues(),
        db.getAllSyncQueue(),
        db.getAllConflicts(),
        db.getAllHistories(),
        db.getCurrentUser()
      ]);
      set({ stores, templates, issues, syncQueue, conflicts, histories, currentUser, isLoading: false });

      const handleOnline = () => {
        set({ isOnline: true });
        get().addToast('info', '网络已恢复，将自动同步');
        get().processSyncQueue();
      };
      const handleOffline = () => {
        set({ isOnline: false });
        get().addToast('warning', '网络已断开，数据将保存在本地');
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      set({ isOnline: navigator.onLine });
    } catch (error) {
      console.error('Init failed:', error);
      set({ isLoading: false });
    }
  },

  setCurrentUser: (user) => {
    set({ currentUser: user });
    db.saveCurrentUser(user);
  },

  setOnline: (online) => set({ isOnline: online }),
  toggleOnline: () => {
    const newOnline = !get().isOnline;
    set({ isOnline: newOnline });
    if (newOnline) {
      get().addToast('info', '已切换到在线模式');
      get().processSyncQueue();
    } else {
      get().addToast('warning', '已切换到离线模式');
    }
  },

  importStores: async (stores) => {
    await db.addStores(stores);
    const allStores = await db.getAllStores();
    set({ stores: allStores });
    get().addToast('success', `成功导入 ${stores.length} 个门店`);
  },

  importTemplates: async (templates) => {
    await db.addTemplates(templates);
    const allTemplates = await db.getAllTemplates();
    set({ templates: allTemplates });
    get().addToast('success', `成功导入 ${templates.length} 个模板`);
  },

  createIssue: async (issueData) => {
    const { currentUser, templates } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const template = templates.find(t => t.id === issueData.templateId);
    if (template) {
      const requiredKeys = template.fields.filter(f => f.required).map(f => f.key);
      const validation = validateRequiredFields(issueData.data, requiredKeys);
      if (!validation.valid) {
        return { success: false, error: `缺少必填项: ${validation.missing.join(', ')}` };
      }
    }

    const existingIds = get().issues.map(i => i.id);
    if (existingIds.includes(issueData.id || '')) {
      return { success: false, error: '问题编号已存在，请重新生成' };
    }

    const now = new Date().toISOString();
    const issue: Issue = {
      ...issueData,
      id: issueData.id || generateId(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      synced: false
    };

    await db.addIssue(issue);

    const history: History = {
      id: generateId(),
      issueId: issue.id,
      action: 'create',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      toStatus: issue.status,
      timestamp: now
    };
    await db.addHistory(history);

    const issues = await db.getAllIssues();
    const histories = await db.getAllHistories();
    set({ issues, histories });

    if (issue.status !== 'draft') {
      await get().addToSyncQueue(issue, 'create');
    }

    get().addToast('success', issue.status === 'draft' ? '草稿已保存' : '问题已提交');
    return { success: true, issue };
  },

  updateIssue: async (id, updates) => {
    const issue = get().issues.find(i => i.id === id);
    if (!issue) return;

    const { currentUser } = get();
    const now = new Date().toISOString();
    const updated: Issue = {
      ...issue,
      ...updates,
      version: issue.version + 1,
      updatedAt: now,
      synced: false
    };

    await db.updateIssue(updated);

    if (currentUser) {
      const history: History = {
        id: generateId(),
        issueId: id,
        action: 'update',
        operatorId: currentUser.id,
        operatorRole: currentUser.role,
        timestamp: now
      };
      await db.addHistory(history);
    }

    const issues = await db.getAllIssues();
    const histories = await db.getAllHistories();
    set({ issues, histories });

    if (updated.status !== 'draft') {
      await get().addToSyncQueue(updated, 'update');
    }
  },

  updateIssueStatus: async (id, status, operatorId, remark) => {
    const issue = get().issues.find(i => i.id === id);
    if (!issue) return { success: false, error: '问题不存在' };

    const { currentUser } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    if (status === 'closed' && currentUser.role !== 'manager' && currentUser.role !== 'supervisor') {
      return { success: false, error: '无权关闭问题，仅店长和督导可操作' };
    }

    if (status === 'rejected' && currentUser.role !== 'supervisor') {
      return { success: false, error: '无权驳回问题，仅督导可操作' };
    }

    const now = new Date().toISOString();
    const fromStatus = issue.status;
    const updated: Issue = {
      ...issue,
      status,
      version: issue.version + 1,
      updatedAt: now,
      synced: false
    };

    await db.updateIssue(updated);

    const actionMap: Record<IssueStatus, HistoryAction> = {
      draft: 'update',
      submitted: 'submit',
      rejected: 'reject',
      closed: 'close'
    };

    const history: History = {
      id: generateId(),
      issueId: id,
      action: actionMap[status],
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      fromStatus,
      toStatus: status,
      timestamp: now,
      remark
    };
    await db.addHistory(history);

    const issues = await db.getAllIssues();
    const histories = await db.getAllHistories();
    set({ issues, histories });

    await get().addToSyncQueue(updated, 'update');

    const statusLabels: Record<IssueStatus, string> = {
      draft: '草稿',
      submitted: '已提交',
      rejected: '已驳回',
      closed: '已关闭'
    };
    get().addToast('success', `状态已更新为「${statusLabels[status]}」`);
    return { success: true };
  },

  addToSyncQueue: async (issue, action) => {
    const item = createSyncQueueItem(issue, action);
    await db.addSyncQueueItem(item);
    const syncQueue = await db.getAllSyncQueue();
    set({ syncQueue });

    if (get().isOnline) {
      get().processSyncQueue();
    }
  },

  processSyncQueue: async (simulateConflict = false) => {
    const { syncQueue: currentSyncQueue, isOnline } = get();
    if (!isOnline) {
      get().addToast('warning', '当前离线，无法同步');
      return;
    }

    const pendingItems = currentSyncQueue.filter(i => i.status === 'pending' || i.status === 'failed');

    for (const item of pendingItems) {
      await db.updateSyncQueueItem({ ...item, status: 'syncing', lastAttempt: new Date().toISOString() });
      set({ syncQueue: (await db.getAllSyncQueue()) });

      const result = await syncToServer(item.payload, simulateConflict && Math.random() > 0.7);

      if (result.success) {
        await db.updateIssue({ ...item.payload, synced: true, version: item.payload.version + 1 });
        await db.updateSyncQueueItem({ ...item, status: 'completed' });
      } else if (result.conflict && result.remoteVersion) {
        const conflict = createConflict(item.payload, result.remoteVersion);
        await db.addConflict(conflict);
        await db.updateSyncQueueItem({
          ...item,
          status: 'failed',
          retryCount: item.retryCount + 1,
          errorMessage: '版本冲突，需要人工处理'
        });
        get().addToast('error', `同步冲突：「${item.payload.title}」需要处理`);
      } else {
        await db.updateSyncQueueItem({
          ...item,
          status: 'failed',
          retryCount: item.retryCount + 1,
          errorMessage: result.error || '同步失败'
        });
      }
    }

    const [issues, updatedSyncQueue, conflicts] = await Promise.all([
      db.getAllIssues(),
      db.getAllSyncQueue(),
      db.getAllConflicts()
    ]);
    set({ issues, syncQueue: updatedSyncQueue, conflicts });

    const completedCount = updatedSyncQueue.filter(i => i.status === 'completed').length;
    const failedCount = updatedSyncQueue.filter(i => i.status === 'failed').length;
    if (completedCount > 0) {
      get().addToast('success', `成功同步 ${completedCount} 项`);
    }
    if (failedCount > 0) {
      get().addToast('error', `${failedCount} 项同步失败`);
    }
  },

  retrySyncItem: async (itemId) => {
    const item = get().syncQueue.find(i => i.id === itemId);
    if (!item) return;

    await db.updateSyncQueueItem({ ...item, status: 'pending', retryCount: 0 });
    const syncQueue = await db.getAllSyncQueue();
    set({ syncQueue });
    get().processSyncQueue();
  },

  clearCompletedSync: async () => {
    const completed = get().syncQueue.filter(i => i.status === 'completed');
    for (const item of completed) {
      await db.deleteSyncQueueItem(item.id);
    }
    const syncQueue = await db.getAllSyncQueue();
    set({ syncQueue });
    get().addToast('info', `已清除 ${completed.length} 条已完成记录`);
  },

  resolveConflict: async (conflictId, resolution) => {
    const conflict = get().conflicts.find(c => c.id === conflictId);
    if (!conflict) return;

    let resolvedIssue: Issue;
    if (resolution === 'local') {
      resolvedIssue = { ...conflict.localVersion, version: conflict.remoteVersion.version + 1 };
    } else if (resolution === 'remote') {
      resolvedIssue = { ...conflict.remoteVersion };
    } else {
      resolvedIssue = {
        ...conflict.localVersion,
        version: conflict.remoteVersion.version + 1,
        data: { ...conflict.remoteVersion.data, ...conflict.localVersion.data },
        title: `${conflict.localVersion.title} (合并)`
      };
    }

    await db.updateIssue(resolvedIssue);
    await db.updateConflict({ ...conflict, status: 'resolved', resolution });

    const pendingItem = get().syncQueue.find(i => i.issueId === conflict.issueId);
    if (pendingItem) {
      await db.updateSyncQueueItem({ ...pendingItem, status: 'pending', payload: resolvedIssue });
    }

    const [issues, conflicts, syncQueue] = await Promise.all([
      db.getAllIssues(),
      db.getAllConflicts(),
      db.getAllSyncQueue()
    ]);
    set({ issues, conflicts, syncQueue });

    const resolutionLabels = { local: '本地版本', remote: '远程版本', merge: '合并版本' };
    get().addToast('success', `冲突已解决，采用${resolutionLabels[resolution]}`);

    if (get().isOnline) {
      get().processSyncQueue();
    }
  },

  addToast: (type, message) => {
    const id = generateId();
    set(state => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => get().removeToast(id), 3000);
  },

  removeToast: (id) => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
  },

  exportData: (format) => {
    const { issues, stores, templates } = get();
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      const data = { issues, stores, templates, exportedAt: new Date().toISOString() };
      downloadFile(exportToJSON(data), `inspection-export-${timestamp}.json`, 'application/json');
    } else {
      downloadFile(exportToCSV(issues, stores, templates), `inspection-export-${timestamp}.csv`, 'text/csv');
    }
    get().addToast('success', '数据导出成功');
  }
}));
