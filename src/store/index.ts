import { create } from 'zustand';
import {
  User, Issue, Store, Template, History, Conflict, SyncQueueItem,
  IssueStatus, UserRole, ToastMessage, HistoryAction, MigrationOption,
  FieldMapping, MigrationRecord, ImportValidationResult, TemplateDiff,
  ReviewPlan, PlanConflict, PlanAttachment, PlanSyncStatus, PlanHistoryDetail,
  SyncEntityType,
} from '@/types';
import * as db from '@/lib/db';
import { generateId } from '@/utils/helpers';
import {
  syncToServer, createConflict, createSyncQueueItem,
  exportToJSON, exportToCSV, downloadFile, validateRequiredFields,
  syncPlanToServer, createPlanConflict, createPlanSyncQueueItem,
  diffReviewPlans, mergeReviewPlans,
} from '@/services/syncService';
import {
  canManageIssue, canUpgradeTemplate, hasPermission,
  canCreatePlan, canEditPlan, canViewPlan, canResolvePlanConflict,
} from '@/utils/permissions';
import {
  diffTemplateVersions,
  applyTemplateUpgrade,
  validateTemplateImport,
  parseExportPayload,
  isNewerVersion,
} from '@/services/templateVersionService';

export interface PendingTemplateUpgrade {
  existing: Template;
  incoming: Template;
  diff: TemplateDiff;
  selectedOption: MigrationOption;
  customMappings: FieldMapping[];
}

interface AppState {
  currentUser: User | null;
  isOnline: boolean;
  stores: Store[];
  templates: Template[];
  issues: Issue[];
  syncQueue: SyncQueueItem[];
  conflicts: Conflict[];
  histories: History[];
  migrations: MigrationRecord[];
  reviewPlans: ReviewPlan[];
  planConflicts: PlanConflict[];
  toasts: ToastMessage[];
  isLoading: boolean;
  pendingUpgrades: PendingTemplateUpgrade[];
  lastImportValidation: ImportValidationResult | null;

  init: () => Promise<void>;
  setCurrentUser: (user: User | null) => void;
  setOnline: (online: boolean) => void;
  toggleOnline: () => void;

  importStores: (stores: Store[]) => Promise<void>;
  importTemplates: (templates: Template[]) => Promise<ImportValidationResult>;
  importBackup: (rawData: any) => Promise<{ success: boolean; warnings: string[]; errors: string[] }>;

  previewTemplateUpgrade: (existingId: string, incoming: Template) => TemplateDiff;
  setUpgradeOption: (existingId: string, option: MigrationOption) => void;
  setUpgradeMappings: (existingId: string, mappings: FieldMapping[]) => void;
  confirmTemplateUpgrades: () => Promise<{ upgraded: number; migrated: number; kept: number }>;
  cancelPendingUpgrades: () => void;

  createIssue: (issue: Omit<Issue, 'version' | 'createdAt' | 'updatedAt' | 'synced' | 'templateVersion'> & { id?: string; templateVersion?: string }) => Promise<{ success: boolean; error?: string; issue?: Issue }>;
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<void>;
  updateIssueStatus: (id: string, status: IssueStatus, operatorId: string, remark?: string) => Promise<{ success: boolean; error?: string }>;

  addToSyncQueue: (issue: Issue, action: 'create' | 'update' | 'delete') => Promise<void>;
  processSyncQueue: (simulateConflict?: boolean) => Promise<void>;
  forceConflictSync: () => Promise<void>;
  retrySyncItem: (itemId: string) => Promise<void>;
  clearCompletedSync: () => Promise<void>;

  resolveConflict: (conflictId: string, resolution: 'local' | 'remote' | 'merge') => Promise<void>;

  createReviewPlan: (data: {
    issueId: string;
    reviewTime: string;
    assigneeId: string;
    assigneeName?: string;
    assigneeRole?: UserRole;
    rectificationNote: string;
    attachments?: PlanAttachment[];
  }) => Promise<{ success: boolean; error?: string; plan?: ReviewPlan }>;
  updateReviewPlan: (planId: string, updates: Partial<ReviewPlan>) => Promise<{ success: boolean; error?: string }>;
  deleteReviewPlan: (planId: string) => Promise<{ success: boolean; error?: string }>;
  addPlanToSyncQueue: (plan: ReviewPlan, action: 'create' | 'update' | 'delete') => Promise<void>;
  resolvePlanConflict: (planConflictId: string, resolution: 'local' | 'remote' | 'merge') => Promise<{ success: boolean; error?: string }>;
  getReviewPlansForIssue: (issueId: string) => ReviewPlan[];
  getReviewPlansForCurrentUser: () => ReviewPlan[];

  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;

  exportData: (format: 'json' | 'csv') => void;

  getTemplateForIssue: (issue: Issue) => Template | undefined;
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
  migrations: [],
  reviewPlans: [],
  planConflicts: [],
  toasts: [],
  isLoading: false,
  pendingUpgrades: [],
  lastImportValidation: null,

  init: async () => {
    set({ isLoading: true });
    try {
      const [
        stores, templates, issues, syncQueue, conflicts, histories, migrations,
        reviewPlans, planConflicts, currentUser
      ] = await Promise.all([
        db.getAllStores(),
        db.getAllTemplates(),
        db.getAllIssues(),
        db.getAllSyncQueue(),
        db.getAllConflicts(),
        db.getAllHistories(),
        db.getAllMigrations(),
        db.getAllReviewPlans(),
        db.getAllPlanConflicts(),
        db.getCurrentUser()
      ]);

      const normalizedIssues = issues.map(issue => ({
        ...issue,
        templateVersion: issue.templateVersion || '1.0',
      }));

      set({
        stores, templates, issues: normalizedIssues, syncQueue, conflicts,
        histories, migrations, reviewPlans, planConflicts, currentUser,
        isLoading: false
      });

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
    const { currentUser, templates: existingTemplates } = get();

    const validation = validateTemplateImport(templates, existingTemplates, currentUser?.role || 'inspector');
    set({ lastImportValidation: validation });

    if (!validation.valid) {
      for (const err of validation.errors) {
        get().addToast('error', err);
      }
      return validation;
    }

    for (const warn of validation.warnings) {
      get().addToast(warn.type === 'permission_denied' ? 'error' : 'warning', warn.message);
    }

    if (validation.templatesToImport.length > 0) {
      await db.addTemplates(validation.templatesToImport);
      get().addToast('success', `成功导入 ${validation.templatesToImport.length} 个新模板`);
    }

    if (validation.templatesToUpgrade.length > 0) {
      const pending: PendingTemplateUpgrade[] = [];
      const { issues: allIssues } = get();
      for (const { existing, incoming } of validation.templatesToUpgrade) {
        const affectedIssues = allIssues.filter(
          i => i.templateId === existing.id && i.templateVersion === existing.version
        );
        const diff = diffTemplateVersions(existing, incoming, affectedIssues);
        pending.push({
          existing,
          incoming,
          diff,
          selectedOption: 'migrate',
          customMappings: [],
        });
      }
      set({ pendingUpgrades: pending });
      get().addToast('warning', `检测到 ${pending.length} 个模板可升级，请在升级确认页面选择迁移策略`);
    }

    const allTemplates = await db.getAllTemplates();
    set({ templates: allTemplates });

    return validation;
  },

  importBackup: async (rawData) => {
    const parsed = parseExportPayload(rawData);
    const warnings = [...parsed.warnings];
    const errors = [...parsed.errors];

    if (!parsed.valid || !parsed.payload) {
      for (const err of errors) get().addToast('error', err);
      return { success: false, warnings, errors };
    }

    const { payload } = parsed;
    const { currentUser } = get();

    if (payload.stores?.length) {
      await db.addStores(payload.stores);
      warnings.push(`已导入 ${payload.stores.length} 个门店`);
    }

    const existingTemplates = await db.getAllTemplates();
    const validation = validateTemplateImport(payload.templates || [], existingTemplates, currentUser?.role || 'inspector');
    for (const w of validation.warnings) warnings.push(w.message);
    for (const e of validation.errors) errors.push(e);

    if (validation.templatesToImport.length > 0) {
      await db.addTemplates(validation.templatesToImport);
      warnings.push(`已导入 ${validation.templatesToImport.length} 个模板`);
    }
    if (validation.templatesToUpgrade.length > 0) {
      warnings.push(`检测到 ${validation.templatesToUpgrade.length} 个模板升级，需要督导手动确认`);
    }

    if (payload.migrations?.length) {
      for (const mig of payload.migrations) {
        try { await db.addMigration(mig); } catch { /* dedup silently */ }
      }
      warnings.push(`已恢复 ${payload.migrations.length} 条迁移记录`);
    }

    if (payload.issues?.length) {
      const existingIds = new Set((await db.getAllIssues()).map(i => i.id));
      let imported = 0, skipped = 0;
      for (const issue of payload.issues) {
        if (existingIds.has(issue.id)) {
          skipped++;
          warnings.push(`跳过重复问题 ${issue.id}`);
          continue;
        }
        const normalized: Issue = {
          ...issue,
          templateVersion: issue.templateVersion || '1.0',
        };
        await db.addIssue(normalized);
        imported++;
      }
      warnings.push(`已导入 ${imported} 条问题（跳过 ${skipped} 条重复）`);
    }

    if (payload.unresolvedConflicts?.length) {
      const existingIds = new Set((await db.getAllConflicts()).map(c => c.id));
      let imported = 0;
      for (const c of payload.unresolvedConflicts) {
        if (existingIds.has(c.id)) continue;
        await db.addConflict(c);
        imported++;
      }
      warnings.push(`已恢复 ${imported} 条冲突记录`);
    }

    if (payload.reviewPlans?.length) {
      const existingPlanIds = new Set((await db.getAllReviewPlans()).map(p => p.id));
      const allIssues = await db.getAllIssues();
      const issueMap = new Map(allIssues.map(i => [i.id, i]));
      let planImported = 0, planSkipped = 0;
      for (const plan of payload.reviewPlans) {
        if (existingPlanIds.has(plan.id)) {
          planSkipped++;
          warnings.push(`[复查计划] 跳过重复计划 ${plan.id}`);
          continue;
        }
        if (!plan.assigneeId) {
          warnings.push(`[复查计划] 计划 ${plan.id} 缺少责任人，已标记需补全`);
        }
        const planIssue = issueMap.get(plan.issueId);
        if (currentUser && planIssue && !canCreatePlan(currentUser, planIssue)) {
          warnings.push(`[复查计划] 当前用户无权为问题 ${plan.issueId} 创建/修改计划，已标记为草稿`);
          plan.status = 'draft';
        }
        if ((plan.attachments || []).some((a: any) => a.placeholder)) {
          warnings.push(`[复查计划] 计划 ${plan.id} 包含占位附件，需重新上传`);
        }
        await db.addReviewPlan(plan);
        planImported++;
      }
      warnings.push(`已导入 ${planImported} 条复查计划（跳过 ${planSkipped} 条重复）`);
    }

    if (payload.unresolvedPlanConflicts?.length) {
      const existingPcIds = new Set((await db.getAllPlanConflicts()).map(c => c.id));
      let pcImported = 0;
      for (const pc of payload.unresolvedPlanConflicts) {
        if (existingPcIds.has(pc.id)) continue;
        await db.addPlanConflict(pc);
        pcImported++;
      }
      warnings.push(`已恢复 ${pcImported} 条复查计划冲突记录`);
    }

    const [stores, templates, issues, conflicts, migrations, reviewPlans, planConflicts] = await Promise.all([
      db.getAllStores(),
      db.getAllTemplates(),
      db.getAllIssues(),
      db.getAllConflicts(),
      db.getAllMigrations(),
      db.getAllReviewPlans(),
      db.getAllPlanConflicts(),
    ]);
    set({ stores, templates, issues, conflicts, migrations, reviewPlans, planConflicts });

    for (const w of warnings) get().addToast('info', w);
    for (const e of errors) get().addToast('error', e);

    return { success: errors.length === 0, warnings, errors };
  },

  previewTemplateUpgrade: (existingId, incoming) => {
    const { templates, issues } = get();
    const existing = templates.find(t => t.id === existingId);
    if (!existing) throw new Error('模板不存在');
    const affectedIssues = issues.filter(
      i => i.templateId === existing.id && i.templateVersion === existing.version
    );
    return diffTemplateVersions(existing, incoming, affectedIssues);
  },

  setUpgradeOption: (existingId, option) => {
    set(state => ({
      pendingUpgrades: state.pendingUpgrades.map(p =>
        p.existing.id === existingId ? { ...p, selectedOption: option } : p
      )
    }));
  },

  setUpgradeMappings: (existingId, mappings) => {
    set(state => ({
      pendingUpgrades: state.pendingUpgrades.map(p =>
        p.existing.id === existingId ? { ...p, customMappings: mappings } : p
      )
    }));
  },

  confirmTemplateUpgrades: async () => {
    const { pendingUpgrades, issues: allIssues, currentUser } = get();
    let upgradedCount = 0, migratedCount = 0, keptCount = 0;

    if (!currentUser || !canUpgradeTemplate(currentUser)) {
      get().addToast('error', '仅督导可确认模板升级');
      return { upgraded: 0, migrated: 0, kept: 0 };
    }

    const now = new Date().toISOString();

    for (const upgrade of pendingUpgrades) {
      const { existing, incoming, diff, selectedOption, customMappings } = upgrade;

      const result = applyTemplateUpgrade(
        allIssues,
        existing,
        incoming,
        diff,
        selectedOption,
        customMappings.length > 0 ? customMappings : undefined
      );

      await db.putTemplate({
        ...incoming,
        parentId: existing.id,
      });

      const deprecatedExisting: Template = {
        ...existing,
        deprecated: true,
        supersededBy: incoming.id,
      };
      await db.putTemplate(deprecatedExisting);

      if (result.migratedIssues.length > 0) {
        await db.updateIssues(result.migratedIssues);
        migratedCount += result.migratedIssues.length;
      }
      keptCount += result.keptIssues.length;

      const migrationRecord: MigrationRecord = {
        id: generateId(),
        ...result.migrationRecord,
        operatorId: currentUser.id,
        operatorRole: currentUser.role,
        createdAt: now,
        remark: `模板升级：由督导 ${currentUser.name} 执行，策略=${selectedOption}`,
      };
      await db.addMigration(migrationRecord);

      const historyRecords = result.histories.map(h => ({
        id: generateId(),
        timestamp: now,
        ...h,
        operatorId: currentUser.id,
        operatorRole: currentUser.role as UserRole,
      } as History));
      await db.addHistories(historyRecords);

      upgradedCount++;
    }

    const [templates, issues, migrations, histories] = await Promise.all([
      db.getAllTemplates(),
      db.getAllIssues(),
      db.getAllMigrations(),
      db.getAllHistories(),
    ]);
    set({
      templates,
      issues,
      migrations,
      histories,
      pendingUpgrades: [],
      lastImportValidation: null,
    });

    get().addToast('success', `已升级 ${upgradedCount} 个模板，迁移 ${migratedCount} 条问题，保留 ${keptCount} 条旧草稿`);

    return { upgraded: upgradedCount, migrated: migratedCount, kept: keptCount };
  },

  cancelPendingUpgrades: () => {
    set({ pendingUpgrades: [], lastImportValidation: null });
    get().addToast('info', '已取消待处理的模板升级');
  },

  createIssue: async (issueData) => {
    const { currentUser, templates } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const template = templates.find(t => t.id === issueData.templateId);
    if (!template) return { success: false, error: '所选模板不存在' };

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
    const templateVersion = issueData.templateVersion || template?.version || '1.0';

    const issue: Issue = {
      ...issueData,
      id: issueData.id || generateId(),
      templateVersion,
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
      timestamp: now,
      templateVersion,
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

    const { currentUser, templates } = get();
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
      const template = templates.find(t => t.id === issue.templateId);
      const history: History = {
        id: generateId(),
        issueId: id,
        action: 'update',
        operatorId: currentUser.id,
        operatorRole: currentUser.role,
        timestamp: now,
        templateVersion: template?.version || issue.templateVersion,
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

    const { currentUser, stores } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    if (status === 'closed') {
      if (!canManageIssue(currentUser, issue, 'close')) {
        const store = stores.find(s => s.id === issue.storeId);
        const userStore = stores.find(s => s.id === currentUser.storeId);
        if (currentUser.role === 'manager') {
          return {
            success: false,
            error: `无权关闭问题：该问题属于「${store?.name || issue.storeId}」，您仅可关闭「${userStore?.name || '未知门店'}」的问题`
          };
        }
        return { success: false, error: '无权关闭问题，仅店长和督导可操作' };
      }
    }

    if (status === 'rejected') {
      if (!canManageIssue(currentUser, issue, 'reject')) {
        return { success: false, error: '无权驳回问题，仅督导可操作' };
      }
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
      remark,
      templateVersion: issue.templateVersion,
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
    const { syncQueue: currentSyncQueue, isOnline, templates, currentUser } = get();
    if (!isOnline) {
      get().addToast('warning', '当前离线，无法同步');
      return;
    }

    const pendingItems = currentSyncQueue.filter(i => i.status === 'pending' || i.status === 'failed');

    for (const item of pendingItems) {
      await db.updateSyncQueueItem({ ...item, status: 'syncing', lastAttempt: new Date().toISOString() });
      set({ syncQueue: (await db.getAllSyncQueue()) });

      if (item.entityType === 'review_plan' && item.planPayload) {
        const plan = item.planPayload;
        const planResult = await syncPlanToServer(plan, simulateConflict && Math.random() > 0.7);

        if (planResult.success) {
          await db.updateReviewPlan({ ...plan, synced: true, status: 'completed' });
          await db.updateSyncQueueItem({ ...item, status: 'completed' });

          if (currentUser) {
            const h: History = {
              id: generateId(),
              issueId: plan.issueId,
              action: 'plan_sync',
              operatorId: currentUser.id,
              operatorRole: currentUser.role,
              timestamp: new Date().toISOString(),
              planId: plan.id,
              remark: '复查计划同步成功',
            };
            await db.addHistory(h);
          }
        } else if (planResult.conflict && planResult.remotePlan) {
          const pc = createPlanConflict(plan, planResult.remotePlan);
          await db.addPlanConflict(pc);
          const errorMsg = '复查计划版本冲突：本地与远程复查时间或责任人不一致，需人工处理';
          await db.updateSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: errorMsg,
          });
          await db.updateReviewPlan({ ...plan, lastSyncError: errorMsg, lastSyncAttempt: new Date().toISOString() });
          get().addToast('error', `复查计划同步冲突：${errorMsg}`);

          if (currentUser) {
            const h: History = {
              id: generateId(),
              issueId: plan.issueId,
              action: 'plan_sync_fail',
              operatorId: currentUser.id,
              operatorRole: currentUser.role,
              timestamp: new Date().toISOString(),
              planId: plan.id,
              remark: '复查计划同步失败：版本冲突',
            };
            await db.addHistory(h);
          }
        } else {
          const errMsg = planResult.error || '复查计划同步失败';
          await db.updateSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: errMsg,
          });
          await db.updateReviewPlan({
            ...plan,
            status: 'failed',
            lastSyncError: errMsg,
            lastSyncAttempt: new Date().toISOString(),
          });
        }
      } else {
        const result = await syncToServer(item.payload, simulateConflict && Math.random() > 0.7);

        if (result.success) {
          await db.updateIssue({ ...item.payload, synced: true, version: item.payload.version + 1 });
          await db.updateSyncQueueItem({ ...item, status: 'completed' });
        } else if (result.conflict && result.remoteVersion) {
          const conflict = createConflict(item.payload, result.remoteVersion, templates);
          await db.addConflict(conflict);
          const errorMsg = result.templateVersionMismatch
            ? `模板版本冲突：本地 v${result.templateVersionMismatch.localVersion} vs 远端 v${result.templateVersionMismatch.remoteVersion}`
            : '版本冲突，需要人工处理';
          await db.updateSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: errorMsg,
          });
          get().addToast('error', `同步冲突：「${item.payload.title}」${errorMsg}`);
        } else {
          await db.updateSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: result.error || '同步失败'
          });
        }
      }
    }

    const [issues, updatedSyncQueue, conflicts, reviewPlans, planConflicts, histories] = await Promise.all([
      db.getAllIssues(),
      db.getAllSyncQueue(),
      db.getAllConflicts(),
      db.getAllReviewPlans(),
      db.getAllPlanConflicts(),
      db.getAllHistories(),
    ]);
    set({ issues, syncQueue: updatedSyncQueue, conflicts, reviewPlans, planConflicts, histories });

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

  forceConflictSync: async () => {
    const { syncQueue: currentSyncQueue, isOnline, templates, planConflicts: existingPlanConflicts } = get();
    if (!isOnline) {
      get().addToast('warning', '当前离线，无法同步');
      return;
    }

    const pendingItems = currentSyncQueue.filter(i => i.status === 'pending' || i.status === 'failed');
    if (pendingItems.length === 0) {
      get().addToast('info', '没有待同步的项目');
      return;
    }

    for (const item of pendingItems) {
      await db.updateSyncQueueItem({ ...item, status: 'syncing', lastAttempt: new Date().toISOString() });
      set({ syncQueue: (await db.getAllSyncQueue()) });

      if (item.entityType === 'review_plan' && item.planPayload) {
        const planResult = await syncPlanToServer(item.planPayload, true);
        if (planResult.conflict && planResult.remotePlan) {
          const existingPc = existingPlanConflicts.find(
            c => c.planId === item.planPayload!.id && c.status === 'pending'
          );
          if (!existingPc) {
            const pc = createPlanConflict(item.planPayload, planResult.remotePlan);
            await db.addPlanConflict(pc);
          }
          await db.updateSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: '复查计划冲突：本地与远程不一致',
          });
        }
      } else {
        const result = await syncToServer(item.payload, true);

        if (result.conflict && result.remoteVersion) {
          const existingConflict = get().conflicts.find(
            c => c.issueId === item.issueId && c.status === 'pending'
          );
          if (!existingConflict) {
            const conflict = createConflict(item.payload, result.remoteVersion, templates);
            await db.addConflict(conflict);
          }
          const errorMsg = result.templateVersionMismatch
            ? `模板版本冲突：本地 v${result.templateVersionMismatch.localVersion} vs 远端 v${result.templateVersionMismatch.remoteVersion}`
            : '版本冲突：本地与远程内容不一致，需人工处理';
          await db.updateSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: errorMsg,
          });
        }
      }
    }

    const [issues, updatedSyncQueue, conflicts, reviewPlans, planConflicts] = await Promise.all([
      db.getAllIssues(),
      db.getAllSyncQueue(),
      db.getAllConflicts(),
      db.getAllReviewPlans(),
      db.getAllPlanConflicts(),
    ]);
    set({ issues, syncQueue: updatedSyncQueue, conflicts, reviewPlans, planConflicts });

    const conflictCount = updatedSyncQueue.filter(
      i => i.status === 'failed' && i.errorMessage?.includes('冲突')
    ).length;
    if (conflictCount > 0) {
      get().addToast('error', `${conflictCount} 项同步冲突，请到问题详情或冲突列表处理`);
    }
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

    const { currentUser } = get();
    if (currentUser && !hasPermission(currentUser.role, 'conflict:resolve')) {
      get().addToast('error', '仅督导可解决同步冲突');
      return;
    }

    let resolvedIssue: Issue;
    if (resolution === 'local') {
      resolvedIssue = {
        ...conflict.localVersion,
        version: conflict.remoteVersion.version + 1,
        templateVersion: conflict.localVersion.templateVersion || '1.0',
      };
    } else if (resolution === 'remote') {
      resolvedIssue = {
        ...conflict.remoteVersion,
        templateVersion: conflict.remoteVersion.templateVersion || '1.0',
      };
    } else {
      const chosenTemplateVersion = isNewerVersion(
        conflict.remoteVersion.templateVersion || '1.0',
        conflict.localVersion.templateVersion || '1.0'
      )
        ? conflict.remoteVersion.templateVersion
        : conflict.localVersion.templateVersion;

      resolvedIssue = {
        ...conflict.localVersion,
        version: conflict.remoteVersion.version + 1,
        data: { ...conflict.remoteVersion.data, ...conflict.localVersion.data },
        title: `${conflict.localVersion.title} (合并)`,
        templateVersion: chosenTemplateVersion || '1.0',
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

  createReviewPlan: async (data) => {
    const { currentUser, issues } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const issue = issues.find(i => i.id === data.issueId);
    if (!issue) return { success: false, error: '问题不存在' };

    if (issue.status !== 'rejected' && issue.status !== 'submitted') {
      return { success: false, error: '仅已驳回或已提交（待处理）的问题可安排复查计划' };
    }

    if (!canCreatePlan(currentUser, issue)) {
      if (currentUser.role === 'manager') {
        return { success: false, error: '无权为其他门店的问题创建复查计划' };
      }
      return { success: false, error: '仅店长和督导可创建复查计划' };
    }

    if (!data.reviewTime) return { success: false, error: '请选择复查时间' };
    if (!data.assigneeId) return { success: false, error: '请指定复查责任人' };

    const now = new Date().toISOString();
    const plan: ReviewPlan = {
      id: generateId(),
      issueId: data.issueId,
      reviewTime: data.reviewTime,
      assigneeId: data.assigneeId,
      assigneeName: data.assigneeName,
      assigneeRole: data.assigneeRole,
      rectificationNote: data.rectificationNote || '',
      attachments: data.attachments || [],
      creatorId: currentUser.id,
      creatorRole: currentUser.role,
      version: 1,
      status: currentUser.role === 'inspector' ? 'draft' : 'pending',
      synced: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.addReviewPlan(plan);

    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_create',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId: plan.id,
      remark: `创建复查计划，责任人：${data.assigneeName || data.assigneeId}，复查时间：${data.reviewTime}`,
    };
    await db.addHistory(history);

    const [reviewPlans, histories] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
    ]);
    set({ reviewPlans, histories });

    if (plan.status !== 'draft') {
      await get().addPlanToSyncQueue(plan, 'create');
    }

    get().addToast('success', '复查计划已创建');
    return { success: true, plan };
  },

  updateReviewPlan: async (planId, updates) => {
    const { currentUser, issues, reviewPlans } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const plan = reviewPlans.find(p => p.id === planId);
    if (!plan) return { success: false, error: '复查计划不存在' };

    const issue = issues.find(i => i.id === plan.issueId);
    if (!canEditPlan(currentUser, plan, issue)) {
      return { success: false, error: '无权修改此复查计划，仅创建人或督导可编辑' };
    }

    const now = new Date().toISOString();
    const updated: ReviewPlan = {
      ...plan,
      ...updates,
      version: plan.version + 1,
      updatedAt: now,
      synced: false,
      status: plan.status === 'draft' && currentUser.role !== 'inspector' ? 'pending' : plan.status,
    };

    await db.updateReviewPlan(updated);

    const changeFields = Object.keys(updates).join(', ');
    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_update',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId: plan.id,
      remark: `更新复查计划字段：${changeFields}`,
      planDetail: {
        field: changeFields,
      },
    };
    await db.addHistory(history);

    const [updatedPlans, histories] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
    ]);
    set({ reviewPlans: updatedPlans, histories });

    if (updated.status !== 'draft') {
      await get().addPlanToSyncQueue(updated, 'update');
    }

    get().addToast('success', '复查计划已更新');
    return { success: true };
  },

  deleteReviewPlan: async (planId) => {
    const { currentUser, issues, reviewPlans } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const plan = reviewPlans.find(p => p.id === planId);
    if (!plan) return { success: false, error: '复查计划不存在' };

    const issue = issues.find(i => i.id === plan.issueId);
    if (!canEditPlan(currentUser, plan, issue)) {
      return { success: false, error: '无权删除此复查计划' };
    }

    const now = new Date().toISOString();
    await db.deleteReviewPlan(plan.id);

    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_delete',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId: plan.id,
      remark: '删除复查计划',
    };
    await db.addHistory(history);

    const [updatedPlans, histories] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
    ]);
    set({ reviewPlans: updatedPlans, histories });

    await get().addPlanToSyncQueue(plan, 'delete');
    get().addToast('success', '复查计划已删除');
    return { success: true };
  },

  addPlanToSyncQueue: async (plan, action) => {
    const item = createPlanSyncQueueItem(plan, action);
    await db.addSyncQueueItem(item);
    const syncQueue = await db.getAllSyncQueue();
    set({ syncQueue });

    if (get().isOnline) {
      get().processSyncQueue();
    }
  },

  resolvePlanConflict: async (planConflictId, resolution) => {
    const { planConflicts, currentUser, issues, reviewPlans } = get();
    const pc = planConflicts.find(c => c.id === planConflictId);
    if (!pc) return { success: false, error: '冲突记录不存在' };

    const issue = issues.find(i => i.id === pc.issueId);
    if (!canResolvePlanConflict(currentUser, pc.localPlan, issue)) {
      return { success: false, error: '无权解决此复查计划冲突' };
    }

    let resolvedPlan: ReviewPlan;
    if (resolution === 'local') {
      resolvedPlan = {
        ...pc.localPlan,
        version: Math.max(pc.localPlan.version, pc.remotePlan.version) + 1,
      };
    } else if (resolution === 'remote') {
      resolvedPlan = {
        ...pc.remotePlan,
        id: pc.localPlan.id,
        version: Math.max(pc.localPlan.version, pc.remotePlan.version) + 1,
      };
    } else {
      resolvedPlan = mergeReviewPlans(pc.localPlan, pc.remotePlan);
    }

    const now = new Date().toISOString();
    await db.updateReviewPlan(resolvedPlan);
    await db.updatePlanConflict({
      ...pc,
      status: 'resolved',
      resolution,
      resolvedAt: now,
      resolvedBy: currentUser?.id,
      resolvedByRole: currentUser?.role,
    });

    const history: History = {
      id: generateId(),
      issueId: pc.issueId,
      action: 'plan_conflict_resolve',
      operatorId: currentUser?.id || 'system',
      operatorRole: currentUser?.role || 'supervisor',
      timestamp: now,
      planId: pc.planId,
      remark: `解决复查计划冲突，采用：${resolution === 'local' ? '本地版本' : resolution === 'remote' ? '远程版本' : '合并版本'}`,
      planDetail: {
        conflictResolution: resolution,
        localVersion: pc.localPlan,
        remoteVersion: pc.remotePlan,
      },
    };
    await db.addHistory(history);

    const pendingItem = get().syncQueue.find(
      i => i.entityType === 'review_plan' && i.planPayload?.id === pc.planId
    );
    if (pendingItem) {
      await db.updateSyncQueueItem({ ...pendingItem, status: 'pending', planPayload: resolvedPlan });
    }

    const [updatedPlans, updatedConflicts, updatedSyncQueue, histories] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllPlanConflicts(),
      db.getAllSyncQueue(),
      db.getAllHistories(),
    ]);
    set({ reviewPlans: updatedPlans, planConflicts: updatedConflicts, syncQueue: updatedSyncQueue, histories });

    const labels = { local: '本地版本', remote: '远程版本', merge: '合并版本' };
    get().addToast('success', `复查计划冲突已解决，采用${labels[resolution]}`);

    if (get().isOnline) {
      get().processSyncQueue();
    }
    return { success: true };
  },

  getReviewPlansForIssue: (issueId) => {
    const { reviewPlans, currentUser, issues } = get();
    const issue = issues.find(i => i.id === issueId);
    return reviewPlans.filter(p =>
      p.issueId === issueId && canViewPlan(currentUser, p, issue)
    );
  },

  getReviewPlansForCurrentUser: () => {
    const { reviewPlans, currentUser, issues } = get();
    if (!currentUser) return [];
    return reviewPlans.filter(p => {
      const issue = issues.find(i => i.id === p.issueId);
      return canViewPlan(currentUser, p, issue);
    });
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
    const { issues, stores, templates, migrations, conflicts, currentUser, reviewPlans, planConflicts } = get();
    const timestamp = new Date().toISOString().slice(0, 10);
    const unresolvedConflicts = conflicts.filter(c => c.status === 'pending');
    const unresolvedPlanConflicts = planConflicts.filter(c => c.status === 'pending');

    if (format === 'json') {
      const data = {
        issues,
        stores,
        templates,
        migrations,
        unresolvedConflicts,
        reviewPlans,
        unresolvedPlanConflicts,
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser,
      };
      downloadFile(exportToJSON(data), `inspection-export-${timestamp}.json`, 'application/json');
    } else {
      downloadFile(exportToCSV(issues, stores, templates, migrations, reviewPlans), `inspection-export-${timestamp}.csv`, 'text/csv');
    }
    get().addToast('success',
      `数据导出成功（含 ${migrations.length} 条迁移，${unresolvedConflicts.length} 条问题冲突，` +
      `${reviewPlans.length} 条复查计划，${unresolvedPlanConflicts.length} 条计划冲突）`
    );
  },

  getTemplateForIssue: (issue) => {
    const { templates } = get();
    return templates.find(
      t => t.id === issue.templateId && t.version === issue.templateVersion
    ) || templates.find(t => t.id === issue.templateId);
  },
}));
