import { create } from 'zustand';
import {
  User, Issue, Store, Template, History, Conflict, SyncQueueItem,
  IssueStatus, UserRole, ToastMessage, HistoryAction, MigrationOption,
  FieldMapping, MigrationRecord, ImportValidationResult, TemplateDiff,
  ReviewPlan, PlanConflict, PlanAttachment, PlanSyncStatus, PlanHistoryDetail,
  SyncEntityType, HandoverValidationResult, HandoverPackage,
  PlanDelayRecord, PlanDueStatus, HandoverImportBatch, HandoverImportPrecheckResult,
  HandoverPrecheckGroup, HandoverPlanItem,
  Material, MaterialStockBatch, MaterialBorrowForm, MaterialRecord,
  MaterialSyncQueueItem, MaterialBorrowStatus, MaterialRecordType,
  MaterialImportValidationResult, MaterialExportPayload,
  MaterialBackupWarning,
} from '@/types';
import * as db from '@/lib/db';
import { generateId, computePlanDueStatus, normalizeReviewPlanDefaults, buildDelayHistoryRemark, getPlanLastDelayReason, getPlanLastApproverName, generateMaterialCode, generateBorrowFormNumber, generateBatchNumber, normalizeMaterialDefaults, normalizeMaterialBorrowFormDefaults, normalizeMaterialRecordDefaults, MATERIAL_BORROW_STATUS_LABELS, MATERIAL_STATUS_LABELS } from '@/utils/helpers';
import {
  syncToServer, createConflict, createSyncQueueItem,
  exportToJSON, exportToCSV, downloadFile, validateRequiredFields,
  syncPlanToServer, createPlanConflict, createPlanSyncQueueItem,
  diffReviewPlans, mergeReviewPlans, detectTimeConflict, mergePlanRemark,
  buildHandoverPackage, downloadHandoverPackage, validateHandoverImport,
  applyHandoverResolution, isHandoverPackage,
  groupHandoverPlansForPrecheck, precheckHandoverImport,
  normalizeHandoverPrecheckResultDefaults, normalizeHandoverBatchDefaults,
  syncMaterialToServer, syncMaterialBorrowFormToServer, createMaterialSyncQueueItem,
  validateMaterialBackupImport, buildMaterialExportPayload, exportMaterialToJSON,
  parseMaterialBackupPayload, normalizeMaterialBackupDefaults,
} from '@/services/syncService';
import {
  canManageIssue, canUpgradeTemplate, hasPermission,
  canCreatePlan, canEditPlan, canViewPlan, canResolvePlanConflict,
  canExportHandover, canImportHandover,
  canRequestDelay, canApproveDelay, canDirectlyChangeReviewTime, canResolveTimeConflict,
  canViewHandoverPrecheck, canConfirmHandoverImport, canUndoHandoverImport, canSelectHandoverStrategy,
  canPrecheckHandoverImport,
  canManageMaterial, canManageStock, canReportLoss,
  canViewMaterial, canBorrowMaterial, canReturnMaterial,
  canViewStoreOccupancy, canExportMaterial,
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
  planDelayRecords: PlanDelayRecord[];
  handoverImportBatches: HandoverImportBatch[];
  handoverPrecheckResults: HandoverImportPrecheckResult[];
  currentHandoverPrecheckId: string | null;
  latestHandoverBatchId: string | null;
  toasts: ToastMessage[];
  isLoading: boolean;
  pendingUpgrades: PendingTemplateUpgrade[];
  lastImportValidation: ImportValidationResult | null;
  lastHandoverValidation: HandoverValidationResult | null;
  materials: Material[];
  materialBatches: MaterialStockBatch[];
  materialBorrowForms: MaterialBorrowForm[];
  materialRecords: MaterialRecord[];
  materialSyncQueue: MaterialSyncQueueItem[];
  lastMaterialImportValidation: MaterialImportValidationResult | null;
  pendingMaterialBorrowForm: MaterialBorrowForm | null;
  materialImportWarnings: MaterialBackupWarning[];

  init: () => Promise<void>;
  initMaterials: () => Promise<void>;
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

  requestPlanDelay: (planId: string, data: {
    reason: string;
    newReviewTime: string;
    attachmentSummary: string;
    attachmentIds?: string[];
  }) => Promise<{ success: boolean; error?: string }>;
  approvePlanDelay: (delayRecordId: string, remark?: string) => Promise<{ success: boolean; error?: string }>;
  rejectPlanDelay: (delayRecordId: string, remark?: string) => Promise<{ success: boolean; error?: string }>;
  resolvePlanTimeConflict: (planId: string, resolution: 'local' | 'remote' | 'merge') => Promise<{ success: boolean; error?: string }>;
  computeAndSyncDueStatus: () => void;
  getPlanDelayRecordsForCurrentUser: () => PlanDelayRecord[];

  exportHandover: (issueId: string) => void;
  previewHandoverImport: (rawData: any) => HandoverValidationResult | null;
  confirmHandoverImport: (resolutions: Record<string, 'keep_local' | 'adopt_import' | 'merge'>) => Promise<{ success: boolean; imported: number; skipped: number }>;
  clearHandoverValidation: () => void;

  precheckHandoverImportBatch: (rawData: any) => Promise<{ batch: HandoverImportBatch; precheckResult: HandoverImportPrecheckResult } | null>;
  updateHandoverImportStrategy: (planId: string, strategy: 'keep_local' | 'adopt_import' | 'merge') => void;
  confirmHandoverImportBatch: () => Promise<{ success: boolean; imported: number; skipped: number }>;
  undoLatestHandoverImport: (remark?: string) => Promise<{ success: boolean; restored: number; error?: string }>;
  getLatestHandoverImportBatch: () => HandoverImportBatch | undefined;
  getCurrentHandoverPrecheck: () => HandoverImportPrecheckResult | undefined;
  clearCurrentHandoverPrecheck: () => void;

  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;

  exportData: (format: 'json' | 'csv') => void;

  getTemplateForIssue: (issue: Issue) => Template | undefined;

  createMaterial: (data: Omit<Material, 'id' | 'code' | 'totalStock' | 'availableStock' | 'createdAt' | 'updatedAt' | 'synced' | 'status'> & { code?: string; initialStock?: number; storeId?: string; batchNumber?: string; status?: Material['status'] }) => Promise<{ success: boolean; error?: string; material?: Material }>;
  updateMaterial: (id: string, updates: Partial<Material>) => Promise<{ success: boolean; error?: string }>;
  deleteMaterial: (id: string) => Promise<{ success: boolean; error?: string }>;
  addStockBatch: (data: { materialId: string; storeId: string; quantity: number; batchNumber?: string; remark?: string; receivedDate?: string }) => Promise<{ success: boolean; error?: string }>;
  adjustStock: (materialId: string, storeId: string, quantity: number, reason: string) => Promise<{ success: boolean; error?: string }>;
  createBorrowForm: (data: Omit<MaterialBorrowForm, 'id' | 'formNumber' | 'status' | 'createdAt' | 'updatedAt' | 'synced' | 'operatorId' | 'operatorName' | 'operatorRole'> & { status?: MaterialBorrowStatus }) => Promise<{ success: boolean; error?: string; form?: MaterialBorrowForm; conflicts?: Array<{ type: string; message: string; options: string[] }> }>;
  updateBorrowForm: (formId: string, updates: Partial<MaterialBorrowForm>) => Promise<{ success: boolean; error?: string }>;
  cancelBorrowForm: (formId: string) => Promise<{ success: boolean; error?: string }>;
  submitBorrowForm: (formId: string) => Promise<{ success: boolean; error?: string; conflicts?: Array<{ type: string; message: string; options: string[] }> }>;
  returnBorrowForm: (formId: string, dataOrHandbackCondition?: any, lossQuantity?: number, lossReason?: string) => Promise<{ success: boolean; error?: string; conflicts?: Array<{ type: string; message: string; options: string[] }> }>;
  reportLoss: (materialId: string, storeId: string, quantity: number, reason: string, operatorRemark?: string) => Promise<{ success: boolean; error?: string }>;
  validateBorrowConflicts: (materialId: string, storeId: string, borrowerId: string, quantity: number) => Array<{ type: string; message: string; options: string[] }>;
  processMaterialSyncQueue: (simulateConflict?: boolean) => Promise<void>;
  retryMaterialSyncItem: (itemId: string) => Promise<void>;
  clearCompletedMaterialSync: () => Promise<void>;
  saveDraftBorrowForm: (form: Partial<MaterialBorrowForm>) => void;
  clearDraftBorrowForm: () => void;
  currentMaterialDraft: MaterialBorrowForm | null;
  saveMaterialDraft: (form: Partial<MaterialBorrowForm>) => void;
  clearMaterialDraft: () => void;
  importMaterialBackup: (rawData: any) => Promise<{ success: boolean; warnings: MaterialBackupWarning[]; errors: string[] }>;
  exportMaterialBackup: () => void;
  getMaterialBorrowFormsForCurrentUser: () => MaterialBorrowForm[];
  getMaterialBorrowFormsForStore: (storeId: string) => MaterialBorrowForm[];
  getMaterialOccupancyByStore: (storeId: string) => Array<{ materialId: string; materialName: string; materialCode: string; borrowedQuantity: number; storeId: string; storeName?: string }>;
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
  planDelayRecords: [],
  handoverImportBatches: [],
  handoverPrecheckResults: [],
  currentHandoverPrecheckId: null,
  latestHandoverBatchId: null,
  toasts: [],
  isLoading: false,
  pendingUpgrades: [],
  lastImportValidation: null,
  lastHandoverValidation: null,
  materials: [],
  materialBatches: [],
  materialBorrowForms: [],
  materialRecords: [],
  materialSyncQueue: [],
  lastMaterialImportValidation: null,
  pendingMaterialBorrowForm: null,
  currentMaterialDraft: null,
  materialImportWarnings: [],

  init: async () => {
    set({ isLoading: true });
    try {
      const [
        stores, templates, issues, syncQueue, conflicts, histories, migrations,
        reviewPlans, planConflicts, planDelayRecords, currentUser,
        handoverImportBatches, handoverPrecheckResults
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
        db.getAllPlanDelayRecords(),
        db.getCurrentUser(),
        db.getAllHandoverImportBatches(),
        db.getAllHandoverPrecheckResults(),
      ]);

      const normalizedIssues = issues.map(issue => ({
        ...issue,
        templateVersion: issue.templateVersion || '1.0',
      }));

      const now = new Date();
      const normalizedPlans = reviewPlans.map(p => {
        const base = normalizeReviewPlanDefaults(p as any);
        const recordsForPlan = planDelayRecords.filter(r => r.planId === p.id);
        return {
          ...base,
          delayRecords: recordsForPlan,
          pendingDelayRequest: recordsForPlan.find(r => r.status === 'pending'),
          dueStatus: computePlanDueStatus({ ...base, delayRecords: recordsForPlan } as ReviewPlan, now),
        };
      });

      const normalizedPrechecks = handoverPrecheckResults.map(r => normalizeHandoverPrecheckResultDefaults(r));
      const normalizedBatches = handoverImportBatches.map(b => normalizeHandoverBatchDefaults(b));
      const latestBatch = [...normalizedBatches].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      set({
        stores, templates, issues: normalizedIssues, syncQueue, conflicts,
        histories, migrations, reviewPlans: normalizedPlans, planConflicts,
        planDelayRecords, currentUser,
        handoverImportBatches: normalizedBatches,
        handoverPrecheckResults: normalizedPrechecks,
        latestHandoverBatchId: latestBatch?.id || null,
        isLoading: false
      });

      await get().initMaterials();

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

    const delayRecordsFromPayload = (payload as any).planDelayRecords;
    if (Array.isArray(delayRecordsFromPayload) && delayRecordsFromPayload.length > 0) {
      const existingDelayIds = new Set((await db.getAllPlanDelayRecords()).map(r => r.id));
      let delayImported = 0;
      for (const rec of delayRecordsFromPayload) {
        if (existingDelayIds.has(rec.id)) continue;
        try {
          await db.addPlanDelayRecord(rec);
          delayImported++;
        } catch (e) {
          warnings.push(`[延期记录] 跳过 ${rec.id}：${(e as any)?.message || '已存在'}`);
        }
      }
      warnings.push(`已恢复 ${delayImported} 条延期申请/审批记录`);
    }

    const handoverBatchesFromPayload = (payload as any).handoverImportBatches;
    if (Array.isArray(handoverBatchesFromPayload) && handoverBatchesFromPayload.length > 0) {
      const existingBatchIds = new Set((await db.getAllHandoverImportBatches()).map(b => b.id));
      let batchImported = 0;
      for (const batch of handoverBatchesFromPayload) {
        if (existingBatchIds.has(batch.id)) continue;
        try {
          const normalized = normalizeHandoverBatchDefaults(batch);
          await db.addHandoverImportBatch(normalized);
          batchImported++;
        } catch (e) {
          warnings.push(`[交接包批次] 跳过 ${batch.id}：${(e as any)?.message || '已存在'}`);
        }
      }
      if (batchImported > 0) {
        warnings.push(`已恢复 ${batchImported} 条交接包导入批次记录`);
      }
    }

    const handoverPrechecksFromPayload = (payload as any).handoverPrecheckResults;
    if (Array.isArray(handoverPrechecksFromPayload) && handoverPrechecksFromPayload.length > 0) {
      const existingPrecheckIds = new Set((await db.getAllHandoverPrecheckResults()).map(p => p.id));
      let precheckImported = 0;
      for (const pc of handoverPrechecksFromPayload) {
        if (existingPrecheckIds.has(pc.id)) continue;
        try {
          const normalized = normalizeHandoverPrecheckResultDefaults(pc);
          await db.addHandoverPrecheckResult(normalized);
          precheckImported++;
        } catch (e) {
          warnings.push(`[交接包预检] 跳过 ${pc.id}：${(e as any)?.message || '已存在'}`);
        }
      }
      if (precheckImported > 0) {
        warnings.push(`已恢复 ${precheckImported} 条交接包预检记录`);
      }
    }

    const [stores, templates, issues, conflicts, migrations, reviewPlans, planConflicts, planDelayRecords, handoverImportBatches, handoverPrecheckResults] = await Promise.all([
      db.getAllStores(),
      db.getAllTemplates(),
      db.getAllIssues(),
      db.getAllConflicts(),
      db.getAllMigrations(),
      db.getAllReviewPlans(),
      db.getAllPlanConflicts(),
      db.getAllPlanDelayRecords(),
      db.getAllHandoverImportBatches(),
      db.getAllHandoverPrecheckResults(),
    ]);

    const delayByPlan = new Map<string, PlanDelayRecord[]>();
    for (const rec of planDelayRecords) {
      const arr = delayByPlan.get(rec.planId) || [];
      arr.push(rec);
      delayByPlan.set(rec.planId, arr);
    }

    const finalPlans = reviewPlans.map(p => {
      const recs = delayByPlan.get(p.id) || (p as any).delayRecords || [];
      return {
        ...p,
        delayRecords: recs,
        pendingDelayRequest: recs.find(r => r.status === 'pending'),
        dueStatus: computePlanDueStatus({ ...p, delayRecords: recs } as ReviewPlan),
      };
    });

    const restoredBatches = handoverImportBatches.map(b => normalizeHandoverBatchDefaults(b));
    const restoredPrechecks = handoverPrecheckResults.map(r => normalizeHandoverPrecheckResultDefaults(r));
    const latestBatch = [...restoredBatches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    set({
      stores, templates, issues, conflicts, migrations,
      reviewPlans: finalPlans, planConflicts, planDelayRecords,
      handoverImportBatches: restoredBatches,
      handoverPrecheckResults: restoredPrechecks,
      latestHandoverBatchId: latestBatch?.id || null,
    });

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
              planDetail: {
                field: 'sync',
                newValue: 'succeeded',
              },
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
              planDetail: {
                field: 'sync_fail',
                newValue: '版本冲突',
                localVersion: plan,
                remoteVersion: planResult.remotePlan,
              },
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
    const basePlan = {
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
    const plan: ReviewPlan = normalizeReviewPlanDefaults(basePlan as any);

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
      planDetail: {
        field: 'create',
        newValue: `${data.assigneeName || data.assigneeId} / ${data.reviewTime}`,
        localVersion: plan,
      },
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
    const oldValues: string[] = [];
    const newValues: string[] = [];
    for (const key of Object.keys(updates) as Array<keyof typeof updates>) {
      const oldVal = plan[key];
      const newVal = updates[key];
      oldValues.push(String(oldVal ?? ''));
      newValues.push(String(newVal ?? ''));
    }
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
        oldValue: oldValues.join(' | '),
        newValue: newValues.join(' | '),
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
      planDetail: {
        field: 'delete',
        oldValue: plan.assigneeName || plan.assigneeId,
        localVersion: plan,
      },
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

  requestPlanDelay: async (planId, data) => {
    const { currentUser, reviewPlans, issues, planDelayRecords: existingRecords } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const plan = reviewPlans.find(p => p.id === planId);
    if (!plan) return { success: false, error: '复查计划不存在' };

    const issue = issues.find(i => i.id === plan.issueId);
    if (!canRequestDelay(currentUser, plan, issue)) {
      return { success: false, error: '无权为该计划申请延期' };
    }

    const hasPending = existingRecords.some(
      r => r.planId === planId && r.status === 'pending'
    );
    if (hasPending) {
      return { success: false, error: '该计划已有待审批的延期申请，请勿重复提交' };
    }

    if (!data.reason || data.reason.trim() === '') {
      return { success: false, error: '请填写延期原因' };
    }
    if (!data.newReviewTime) {
      return { success: false, error: '请选择新的复查时间' };
    }
    const newTime = new Date(data.newReviewTime);
    const oldTime = new Date(plan.reviewTime);
    if (newTime.getTime() <= oldTime.getTime()) {
      return { success: false, error: '新的复查时间必须晚于原复查时间' };
    }

    const now = new Date().toISOString();
    const record: PlanDelayRecord = {
      id: generateId(),
      planId,
      issueId: plan.issueId,
      reason: data.reason.trim(),
      newReviewTime: data.newReviewTime,
      oldReviewTime: plan.reviewTime,
      attachmentSummary: data.attachmentSummary || '',
      attachmentIds: data.attachmentIds || [],
      requesterId: currentUser.id,
      requesterRole: currentUser.role,
      requesterName: currentUser.name,
      status: 'pending',
      requestedAt: now,
    };

    await db.addPlanDelayRecord(record);

    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_delay_request',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId,
      remark: buildDelayHistoryRemark(record, 'request'),
      planDetail: {
        delayRecord: record,
        field: 'delay_request',
        newValue: `${data.newReviewTime}（原时间：${plan.reviewTime}）`,
      },
    };
    await db.addHistory(history);

    const allDelayRecords = await db.getAllPlanDelayRecords();
    const recordsForPlan = allDelayRecords.filter(r => r.planId === planId);
    const updatedPlan: ReviewPlan = {
      ...plan,
      version: plan.version + 1,
      updatedAt: now,
      synced: false,
      pendingDelayRequest: recordsForPlan.find(r => r.status === 'pending'),
      delayRecords: recordsForPlan,
      dueStatus: 'delay_requested',
    };
    await db.updateReviewPlan(updatedPlan);
    await get().addPlanToSyncQueue(updatedPlan, 'update');

    const [allPlans, allHistories, allDelay, syncQueue] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
      db.getAllPlanDelayRecords(),
      db.getAllSyncQueue(),
    ]);
    const finalPlans = allPlans.map(p => ({
      ...p,
      delayRecords: allDelay.filter(r => r.planId === p.id),
      pendingDelayRequest: allDelay.filter(r => r.planId === p.id).find(r => r.status === 'pending'),
      dueStatus: computePlanDueStatus(p as ReviewPlan),
    }));
    set({
      reviewPlans: finalPlans,
      histories: allHistories,
      planDelayRecords: allDelay,
      syncQueue,
    });

    get().addToast('success', '延期申请已提交，等待审批');
    return { success: true };
  },

  approvePlanDelay: async (delayRecordId, remark) => {
    const { currentUser, planDelayRecords, reviewPlans, issues } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const record = planDelayRecords.find(r => r.id === delayRecordId);
    if (!record) return { success: false, error: '延期申请记录不存在' };
    if (record.status !== 'pending') {
      return { success: false, error: '该申请已处理，无法重复审批' };
    }

    const plan = reviewPlans.find(p => p.id === record.planId);
    if (!plan) return { success: false, error: '关联的复查计划不存在' };

    const issue = issues.find(i => i.id === plan.issueId);
    if (!canApproveDelay(currentUser, plan, issue)) {
      if (currentUser.role === 'manager') {
        const planStore = issues.find(i => i.id === plan.issueId)?.storeId;
        return {
          success: false,
          error: `无权审批该延期申请：此申请属于其他门店`,
        };
      }
      return { success: false, error: '无权审批延期申请，仅店长（本店）和督导可操作' };
    }

    const now = new Date().toISOString();
    const approvedRecord: PlanDelayRecord = {
      ...record,
      status: 'approved',
      approverId: currentUser.id,
      approverRole: currentUser.role,
      approverName: currentUser.name,
      approvalRemark: remark,
      approvedAt: now,
    };

    await db.updatePlanDelayRecord(approvedRecord);

    const allDelayForPlan = (await db.getAllPlanDelayRecords()).filter(r => r.planId === plan.id);
    const approvedCount = allDelayForPlan.filter(r => r.status === 'approved').length;

    const updatedPlan: ReviewPlan = {
      ...plan,
      version: plan.version + 1,
      reviewTime: record.newReviewTime,
      delayCount: approvedCount,
      delayRecords: allDelayForPlan,
      pendingDelayRequest: undefined,
      lastDelayReason: record.reason,
      lastApproverId: currentUser.id,
      lastApproverName: currentUser.name,
      updatedAt: now,
      synced: false,
      dueStatus: 'delay_approved',
      hasTimeConflict: false,
      timeConflictInfo: undefined,
    };
    await db.updateReviewPlan(updatedPlan);
    await get().addPlanToSyncQueue(updatedPlan, 'update');

    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_delay_approve',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId: plan.id,
      remark: buildDelayHistoryRemark(approvedRecord, 'approve'),
      planDetail: {
        delayRecord: approvedRecord,
        field: 'delay_approve',
        oldValue: record.oldReviewTime,
        newValue: record.newReviewTime,
      },
    };
    await db.addHistory(history);

    const [allPlans, allHistories, allDelay, syncQueue] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
      db.getAllPlanDelayRecords(),
      db.getAllSyncQueue(),
    ]);
    const finalPlans = allPlans.map(p => ({
      ...p,
      delayRecords: allDelay.filter(r => r.planId === p.id),
      pendingDelayRequest: allDelay.filter(r => r.planId === p.id).find(r => r.status === 'pending'),
      dueStatus: computePlanDueStatus(p as ReviewPlan),
    }));
    set({
      reviewPlans: finalPlans,
      histories: allHistories,
      planDelayRecords: allDelay,
      syncQueue,
    });

    get().addToast('success', '延期申请已批准，复查时间已更新');
    return { success: true };
  },

  rejectPlanDelay: async (delayRecordId, remark) => {
    const { currentUser, planDelayRecords, reviewPlans, issues } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const record = planDelayRecords.find(r => r.id === delayRecordId);
    if (!record) return { success: false, error: '延期申请记录不存在' };
    if (record.status !== 'pending') {
      return { success: false, error: '该申请已处理，无法重复审批' };
    }

    const plan = reviewPlans.find(p => p.id === record.planId);
    if (!plan) return { success: false, error: '关联的复查计划不存在' };

    const issue = issues.find(i => i.id === plan.issueId);
    if (!canApproveDelay(currentUser, plan, issue)) {
      return { success: false, error: '无权驳回该延期申请' };
    }

    const now = new Date().toISOString();
    const rejectedRecord: PlanDelayRecord = {
      ...record,
      status: 'rejected',
      approverId: currentUser.id,
      approverRole: currentUser.role,
      approverName: currentUser.name,
      approvalRemark: remark,
      rejectedAt: now,
    };

    await db.updatePlanDelayRecord(rejectedRecord);

    const allDelayForPlan = (await db.getAllPlanDelayRecords()).filter(r => r.planId === plan.id);

    const updatedPlan: ReviewPlan = {
      ...plan,
      version: plan.version + 1,
      delayRecords: allDelayForPlan,
      pendingDelayRequest: undefined,
      updatedAt: now,
      synced: false,
      dueStatus: 'delay_rejected',
    };
    await db.updateReviewPlan(updatedPlan);
    await get().addPlanToSyncQueue(updatedPlan, 'update');

    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_delay_reject',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId: plan.id,
      remark: buildDelayHistoryRemark(rejectedRecord, 'reject'),
      planDetail: {
        delayRecord: rejectedRecord,
        field: 'delay_reject',
        oldValue: record.oldReviewTime,
        newValue: '（延期被驳回，原时间不变）',
      },
    };
    await db.addHistory(history);

    const [allPlans, allHistories, allDelay, syncQueue] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
      db.getAllPlanDelayRecords(),
      db.getAllSyncQueue(),
    ]);
    const finalPlans = allPlans.map(p => ({
      ...p,
      delayRecords: allDelay.filter(r => r.planId === p.id),
      pendingDelayRequest: allDelay.filter(r => r.planId === p.id).find(r => r.status === 'pending'),
      dueStatus: computePlanDueStatus(p as ReviewPlan),
    }));
    set({
      reviewPlans: finalPlans,
      histories: allHistories,
      planDelayRecords: allDelay,
      syncQueue,
    });

    get().addToast('warning', `延期申请已驳回${remark ? `：${remark}` : ''}`);
    return { success: true };
  },

  resolvePlanTimeConflict: async (planId, resolution) => {
    const { currentUser, reviewPlans, planConflicts, issues } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const plan = reviewPlans.find(p => p.id === planId);
    if (!plan) return { success: false, error: '复查计划不存在' };

    const issue = issues.find(i => i.id === plan.issueId);
    if (!canResolveTimeConflict(currentUser, plan, issue)) {
      return { success: false, error: '无权解决该计划的时间冲突' };
    }
    if (!plan.hasTimeConflict || !plan.timeConflictInfo) {
      return { success: false, error: '该计划没有时间冲突需要解决' };
    }

    const now = new Date().toISOString();
    const { localReviewTime, remoteReviewTime } = plan.timeConflictInfo;

    let finalReviewTime = plan.reviewTime;
    let mergedRemark = plan.rectificationNote;

    if (resolution === 'local') {
      finalReviewTime = localReviewTime;
    } else if (resolution === 'remote') {
      finalReviewTime = remoteReviewTime;
    } else {
      const planConflict = planConflicts.find(pc => pc.planId === planId && pc.status === 'pending');
      if (planConflict) {
        const merged = mergePlanRemark(planConflict.localPlan, planConflict.remotePlan);
        finalReviewTime = merged.reviewTime;
        mergedRemark = merged.rectificationNote;
      } else {
        finalReviewTime = remoteReviewTime;
      }
    }

    const updatedPlan: ReviewPlan = {
      ...plan,
      version: plan.version + 1,
      reviewTime: finalReviewTime,
      rectificationNote: mergedRemark,
      hasTimeConflict: false,
      timeConflictInfo: undefined,
      updatedAt: now,
      synced: false,
      dueStatus: computePlanDueStatus({ ...plan, reviewTime: finalReviewTime } as ReviewPlan),
    };

    await db.updateReviewPlan(updatedPlan);
    await get().addPlanToSyncQueue(updatedPlan, 'update');

    const history: History = {
      id: generateId(),
      issueId: plan.issueId,
      action: 'plan_time_conflict_resolve',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      planId: plan.id,
      remark: `解决时间冲突，采用：${resolution === 'local' ? '本地时间' : resolution === 'remote' ? '远端时间' : '合并备注（采用远端时间）'}。本地 ${localReviewTime} vs 远端 ${remoteReviewTime}，最终：${finalReviewTime}`,
      planDetail: {
        timeConflict: {
          resolution,
          localReviewTime,
          remoteReviewTime,
          mergedRemark: resolution === 'merge' ? mergedRemark : undefined,
        },
      },
    };
    await db.addHistory(history);

    const [allPlans, allHistories, syncQueue] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
      db.getAllSyncQueue(),
    ]);
    const allDelay = await db.getAllPlanDelayRecords();
    const finalPlans = allPlans.map(p => ({
      ...p,
      delayRecords: allDelay.filter(r => r.planId === p.id),
      pendingDelayRequest: allDelay.filter(r => r.planId === p.id).find(r => r.status === 'pending'),
      dueStatus: computePlanDueStatus(p as ReviewPlan),
    }));
    set({
      reviewPlans: finalPlans,
      histories: allHistories,
      syncQueue,
    });

    const labels = { local: '本地时间', remote: '远端时间', merge: '合并备注' };
    get().addToast('success', `时间冲突已解决，采用${labels[resolution]}`);
    return { success: true };
  },

  computeAndSyncDueStatus: () => {
    const now = new Date();
    set(state => ({
      reviewPlans: state.reviewPlans.map(p => ({
        ...p,
        dueStatus: computePlanDueStatus(p, now),
      })),
    }));
  },

  getPlanDelayRecordsForCurrentUser: () => {
    const { planDelayRecords, currentUser, issues, reviewPlans } = get();
    if (!currentUser) return [];
    return planDelayRecords.filter(r => {
      if (currentUser.role === 'supervisor') return true;
      if (r.requesterId === currentUser.id) return true;
      const plan = reviewPlans.find(p => p.id === r.planId);
      const issue = issues.find(i => i.id === r.issueId);
      if (currentUser.role === 'manager' && issue && issue.storeId === currentUser.storeId) return true;
      if (plan && (plan.assigneeId === currentUser.id || plan.creatorId === currentUser.id)) return true;
      return false;
    });
  },

  exportHandover: (issueId) => {
    const { issues, reviewPlans, planConflicts, histories, currentUser, stores, addToast } = get();
    const issue = issues.find(i => i.id === issueId);
    if (!issue || !currentUser) return;

    if (!canExportHandover(currentUser, issue)) {
      addToast('error', '无权导出该问题的交接包');
      return;
    }

    const issuePlans = reviewPlans.filter(p => p.issueId === issueId);
    const issuePlanConflicts = planConflicts.filter(pc => pc.issueId === issueId);
    const store = stores.find(s => s.id === issue.storeId);

    if (issuePlans.length === 0) {
      addToast('warning', '该问题暂无复查计划，无法导出交接包');
      return;
    }

    const pkg = buildHandoverPackage(
      issue,
      issuePlans,
      issuePlanConflicts,
      histories,
      currentUser,
      store?.name,
    );

    downloadHandoverPackage(pkg);

    const now = new Date().toISOString();
    const history: History = {
      id: generateId(),
      issueId,
      action: 'plan_handover_export',
      operatorId: currentUser.id,
      operatorRole: currentUser.role,
      timestamp: now,
      remark: `导出交接包，包含 ${issuePlans.length} 条复查计划`,
      planDetail: {
        field: 'handover_export',
        newValue: `${issuePlans.length} 条计划`,
      },
    };
    db.addHistory(history).then(() => {
      db.getAllHistories().then(allHistories => {
        set({ histories: allHistories });
      });
    });

    addToast('success', `交接包导出成功，包含 ${issuePlans.length} 条复查计划`);
  },

  previewHandoverImport: (rawData) => {
    const { currentUser, reviewPlans, issues, addToast } = get();

    if (!canImportHandover(currentUser)) {
      addToast('error', '仅督导可导入交接包');
      return null;
    }

    if (!isHandoverPackage(rawData)) {
      addToast('error', '文件不是有效的交接包格式');
      return null;
    }

    const pkg = rawData as HandoverPackage;
    const issue = issues.find(i => i.id === pkg.issueId);
    const issuePlans = reviewPlans.filter(p => p.issueId === pkg.issueId);

    const validation = validateHandoverImport(rawData, issuePlans, currentUser, issue);
    set({ lastHandoverValidation: validation });

    return validation;
  },

  confirmHandoverImport: async (resolutions) => {
    const { lastHandoverValidation, currentUser, issues, addToast } = get();
    if (!lastHandoverValidation || !currentUser) {
      return { success: false, imported: 0, skipped: 0 };
    }

    if (!canImportHandover(currentUser)) {
      addToast('error', '仅督导可导入交接包');
      return { success: false, imported: 0, skipped: 0 };
    }

    const pkg = lastHandoverValidation as HandoverValidationResult;
    const issue = issues.find(i => i.id === (lastHandoverValidation as any).issueId);
    let imported = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const item of pkg.plans) {
      if (!item.canImport) {
        skipped++;
        continue;
      }

      const resolution = resolutions[item.plan.id] || 'adopt_import';

      if (resolution === 'keep_local' && item.localPlan) {
        skipped++;
        continue;
      }

      const resolvedPlan = applyHandoverResolution(item, resolution);
      if (!resolvedPlan) {
        skipped++;
        continue;
      }

      const finalPlan: ReviewPlan = {
        ...resolvedPlan,
        issueId: item.plan.issueId,
      };

      if (item.localPlan) {
        await db.updateReviewPlan(finalPlan);
      } else {
        await db.addReviewPlan(finalPlan);
      }

      await get().addPlanToSyncQueue(finalPlan, item.localPlan ? 'update' : 'create');

      const history: History = {
        id: generateId(),
        issueId: finalPlan.issueId,
        action: 'plan_handover_import',
        operatorId: currentUser.id,
        operatorRole: currentUser.role,
        timestamp: now,
        planId: finalPlan.id,
        remark: `导入交接包计划，策略：${resolution === 'adopt_import' ? '采用导入版本' : resolution === 'merge' ? '合并备注与附件' : '保留本地'}`,
        planDetail: {
          field: 'handover_import',
          newValue: resolution,
          conflictResolution: resolution as any,
          localVersion: item.localPlan,
          remoteVersion: item.plan,
        },
      };
      await db.addHistory(history);

      imported++;
    }

    const [updatedPlans, updatedHistories, updatedSyncQueue] = await Promise.all([
      db.getAllReviewPlans(),
      db.getAllHistories(),
      db.getAllSyncQueue(),
    ]);
    set({
      reviewPlans: updatedPlans,
      histories: updatedHistories,
      syncQueue: updatedSyncQueue,
      lastHandoverValidation: null,
    });

    if (imported > 0) {
      addToast('success', `成功导入 ${imported} 条复查计划（跳过 ${skipped} 条）`);
    } else {
      addToast('info', `没有导入任何计划（跳过 ${skipped} 条）`);
    }

    return { success: true, imported, skipped };
  },

  clearHandoverValidation: () => {
    set({ lastHandoverValidation: null });
  },

  precheckHandoverImportBatch: async (rawData) => {
    const { currentUser, issues, reviewPlans, stores } = get();
    if (!currentUser) {
      get().addToast('error', '请先登录');
      return null;
    }
    if (!canPrecheckHandoverImport(currentUser)) {
      get().addToast('error', '权限不足，无法执行交接包预检');
      return null;
    }

    try {
      const issue = issues.find(i => i.id === rawData.issueId);
      const validation = validateHandoverImport(rawData, reviewPlans, currentUser, issue);
      const result = precheckHandoverImport(rawData, reviewPlans, currentUser, issues, stores);
      await db.addHandoverImportBatch(result.batch);
      await db.addHandoverPrecheckResult(result.precheckResult);

      const normalizedBatch = normalizeHandoverBatchDefaults(result.batch);
      const normalizedPrecheck = normalizeHandoverPrecheckResultDefaults(result.precheckResult);

      set(state => ({
        handoverImportBatches: [...state.handoverImportBatches, normalizedBatch],
        handoverPrecheckResults: [...state.handoverPrecheckResults, normalizedPrecheck],
        currentHandoverPrecheckId: normalizedPrecheck.id,
        lastHandoverValidation: validation,
      }));

      get().addToast('success',
        `预检完成：${result.precheckResult.groupedPlans.direct_import.length} 条可直接导入，` +
        `${result.precheckResult.groupedPlans.needs_merge.length} 条需合并，` +
        `${result.precheckResult.groupedPlans.no_permission.length} 条权限不足，` +
        `${result.precheckResult.groupedPlans.issue_not_found.length} 条缺关联问题，` +
        `${result.precheckResult.groupedPlans.version_behind.length} 条版本落后`
      );

      return { batch: normalizedBatch, precheckResult: normalizedPrecheck };
    } catch (error) {
      get().addToast('error', `预检失败：${(error as Error).message}`);
      return null;
    }
  },

  updateHandoverImportStrategy: async (planId, strategy) => {
    const { currentUser, currentHandoverPrecheckId, handoverPrecheckResults } = get();
    if (!currentUser || !currentHandoverPrecheckId) return false;

    const precheckResult = handoverPrecheckResults.find(p => p.id === currentHandoverPrecheckId);
    if (!precheckResult) return false;

    const issue = get().issues.find(i => i.id === precheckResult.handoverPackage.issueId);
    if (!canSelectHandoverStrategy(currentUser, precheckResult, issue)) {
      get().addToast('error', '权限不足，无法修改导入策略');
      return false;
    }

    const updatedStrategies = {
      ...precheckResult.selectedStrategies,
      [planId]: strategy,
    };

    const updatedGroups = { ...precheckResult.groupedPlans };
    for (const groupName of Object.keys(updatedGroups) as HandoverPrecheckGroup[]) {
      updatedGroups[groupName] = updatedGroups[groupName].map(item =>
        item.plan.id === planId ? { ...item, selectedResolution: strategy } : item
      );
    }

    const updated: HandoverImportPrecheckResult = {
      ...precheckResult,
      selectedStrategies: updatedStrategies,
      groupedPlans: updatedGroups,
      updatedAt: new Date().toISOString(),
    };

    await db.updateHandoverPrecheckResult(updated);

    set(state => ({
      handoverPrecheckResults: state.handoverPrecheckResults.map(p =>
        p.id === precheckResult.id ? normalizeHandoverPrecheckResultDefaults(updated) : p
      ),
    }));

    return true;
  },

  confirmHandoverImportBatch: async () => {
    const { currentUser, currentHandoverPrecheckId, handoverPrecheckResults, handoverImportBatches, reviewPlans, issues, stores } = get();
    if (!currentUser || !currentHandoverPrecheckId) {
      get().addToast('error', '没有可确认的导入批次');
      return { success: false, imported: 0, skipped: 0 };
    }

    const precheckResult = handoverPrecheckResults.find(p => p.id === currentHandoverPrecheckId);
    if (!precheckResult) {
      get().addToast('error', '预检结果不存在');
      return { success: false, imported: 0, skipped: 0 };
    }

    const issue = issues.find(i => i.id === precheckResult.handoverPackage.issueId);
    if (!canConfirmHandoverImport(currentUser, precheckResult, issue)) {
      get().addToast('error', '权限不足，无法确认导入');
      return { success: false, imported: 0, skipped: 0 };
    }

    const batch = handoverImportBatches.find(b => b.id === precheckResult.batchId);
    if (!batch) {
      get().addToast('error', '导入批次不存在');
      return { success: false, imported: 0, skipped: 0 };
    }

    try {
      const planMap = new Map(reviewPlans.map(p => [p.id, p]));
      const allPlanItems: HandoverPlanItem[] = Object.values(precheckResult.groupedPlans).flat();
      const undoPlanSnapshots: Array<{ planId: string; snapshot: ReviewPlan }> = [];
      const importedPlanIds: string[] = [];
      const skippedPlanIds: string[] = [];
      const syncItems: SyncQueueItem[] = [];
      const historyItems: History[] = [];
      const finalStrategies: Record<string, 'keep_local' | 'adopt_import' | 'merge'> = {};
      const finalPlans: ReviewPlan[] = [];

      for (const item of allPlanItems) {
        const planId = item.plan.id;
        const strategy = precheckResult.selectedStrategies[planId] || item.selectedResolution || 'adopt_import';
        finalStrategies[planId] = strategy;

        if (strategy === 'keep_local' || !item.canImport) {
          skippedPlanIds.push(planId);
          continue;
        }

        const existingPlan = planMap.get(planId);
        if (existingPlan) {
          undoPlanSnapshots.push({ planId, snapshot: JSON.parse(JSON.stringify(existingPlan)) });
        }

        let finalPlan: ReviewPlan;
        if (strategy === 'merge') {
          const mergedAttachments = [
            ...(existingPlan?.attachments || []),
            ...(item.plan.attachments || []).map(a => ({ ...a, id: generateId() })),
          ];
          const mergedNote = existingPlan && existingPlan.rectificationNote && item.plan.rectificationNote
            ? `${existingPlan.rectificationNote}\n\n[合并导入] ${item.plan.rectificationNote}`
            : item.plan.rectificationNote || existingPlan?.rectificationNote || '';
          finalPlan = {
            ...item.plan,
            rectificationNote: mergedNote,
            attachments: mergedAttachments,
            updatedAt: new Date().toISOString(),
          };
        } else {
          finalPlan = {
            ...item.plan,
            updatedAt: new Date().toISOString(),
          };
        }

        if (existingPlan) {
          await db.updateReviewPlan(finalPlan);
        } else {
          await db.addReviewPlan(finalPlan);
        }
        importedPlanIds.push(planId);
        finalPlans.push(finalPlan);

        const syncItem = createPlanSyncQueueItem(finalPlan, existingPlan ? 'update' : 'create');
        await db.addSyncQueueItem(syncItem);
        syncItems.push(syncItem);

        const planHistory: History = {
          id: generateId(),
          issueId: item.plan.issueId,
          action: 'plan_handover_import',
          operatorId: currentUser.id,
          operatorRole: currentUser.role,
          timestamp: new Date().toISOString(),
          remark: `交接包导入，策略：${strategy === 'adopt_import' ? '采用导入' : strategy === 'merge' ? '合并备注和附件' : '保留本地'}`,
          planId: finalPlan.id,
          planDetail: {
            handoverBatch: {
              batchId: batch.id,
              strategy,
              isUndo: false,
            },
          },
        };
        await db.addHistory(planHistory);
        historyItems.push(planHistory);
      }

      const batchHistory: History = {
        id: generateId(),
        issueId: batch.sourceHandoverPackage.issueId,
        action: 'plan_handover_import_batch',
        operatorId: currentUser.id,
        operatorRole: currentUser.role,
        timestamp: new Date().toISOString(),
        remark: `交接包批量导入 ${importedPlanIds.length} 条计划`,
        planDetail: {
          handoverBatch: {
            batchId: batch.id,
            strategy: 'batch',
            isUndo: false,
          },
          importedPlanIds,
        },
      };
      await db.addHistory(batchHistory);
      historyItems.push(batchHistory);

      const updatedBatch: HandoverImportBatch = {
        ...batch,
        status: 'imported',
        importedPlanIds,
        undoPlanSnapshots,
        strategies: finalStrategies,
        hasUndo: false,
        updatedAt: new Date().toISOString(),
        importedAt: new Date().toISOString(),
      };
      await db.updateHandoverImportBatch(updatedBatch);

      const updatedPrecheck: HandoverImportPrecheckResult = {
        ...precheckResult,
        selectedStrategies: finalStrategies,
        updatedAt: new Date().toISOString(),
      };
      await db.updateHandoverPrecheckResult(updatedPrecheck);

      const restoredBatches = handoverImportBatches.map(b =>
        b.id === batch.id ? normalizeHandoverBatchDefaults(updatedBatch) : normalizeHandoverBatchDefaults(b)
      );
      const latestBatch = [...restoredBatches].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      set(state => ({
        handoverImportBatches: restoredBatches,
        handoverPrecheckResults: state.handoverPrecheckResults.map(p =>
          p.id === precheckResult.id ? normalizeHandoverPrecheckResultDefaults(updatedPrecheck) : p
        ),
        reviewPlans: state.reviewPlans.filter(p => !importedPlanIds.includes(p.id)).concat(finalPlans),
        syncQueue: [...state.syncQueue, ...syncItems],
        histories: [...state.histories, ...historyItems],
        currentHandoverPrecheckId: null,
        latestHandoverBatchId: latestBatch?.id || null,
      }));

      get().addToast('success',
        `导入成功：${importedPlanIds.length} 条计划已导入，` +
        `${skippedPlanIds.length} 条保留本地`
      );

      return { success: true, imported: importedPlanIds.length, skipped: skippedPlanIds.length };
    } catch (error) {
      get().addToast('error', `导入失败：${(error as Error).message}`);
      return { success: false, imported: 0, skipped: 0 };
    }
  },

  undoLatestHandoverImport: async (remark) => {
    const { currentUser, handoverImportBatches, reviewPlans } = get();
    if (!currentUser) {
      get().addToast('error', '请先登录');
      return { success: false, restored: 0, error: '请先登录' };
    }

    const batch = [...handoverImportBatches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    if (!batch) {
      get().addToast('error', '没有可撤销的导入批次');
      return { success: false, restored: 0, error: '没有可撤销的导入批次' };
    }

    if (!canUndoHandoverImport(currentUser, batch)) {
      get().addToast('error', '权限不足或该批次已撤销');
      return { success: false, restored: 0, error: '权限不足或该批次已撤销' };
    }

    try {
      await db.updateHandoverImportBatch({ ...batch, status: 'undoing', updatedAt: new Date().toISOString() });

      const planMap = new Map(reviewPlans.map(p => [p.id, p]));
      const restoredPlans: ReviewPlan[] = [];
      const deletedPlanIds: string[] = [];
      const syncItems: SyncQueueItem[] = [];
      const historyItems: History[] = [];

      for (const snap of batch.undoPlanSnapshots) {
        const existing = planMap.get(snap.planId);
        const restored: ReviewPlan = {
          ...snap.snapshot,
          updatedAt: new Date().toISOString(),
        };
        if (existing) {
          await db.updateReviewPlan(restored);
          restoredPlans.push(restored);
        } else {
          await db.deleteReviewPlan(snap.planId);
          deletedPlanIds.push(snap.planId);
        }

        const syncItem = createPlanSyncQueueItem(existing ? restored : snap.snapshot, existing ? 'update' : 'delete');
        await db.addSyncQueueItem(syncItem);
        syncItems.push(syncItem);

        const planHistory: History = {
          id: generateId(),
          issueId: snap.snapshot.issueId,
          action: 'plan_handover_import_undo',
          operatorId: currentUser.id,
          operatorRole: currentUser.role,
          timestamp: new Date().toISOString(),
          remark: `撤销交接包导入${remark ? `：${remark}` : ''}`,
          planId: snap.planId,
          planDetail: {
            handoverBatch: {
              batchId: batch.id,
              strategy: 'undo',
              isUndo: true,
            },
          },
        };
        await db.addHistory(planHistory);
        historyItems.push(planHistory);
      }

      const newImportedIds = batch.importedPlanIds.filter(id => !batch.undoPlanSnapshots.some(s => s.planId === id));
      for (const planId of newImportedIds) {
        const existing = planMap.get(planId);
        if (existing) {
          await db.deleteReviewPlan(planId);
          deletedPlanIds.push(planId);

          const syncItem = createPlanSyncQueueItem(existing, 'delete');
          await db.addSyncQueueItem(syncItem);
          syncItems.push(syncItem);
        }
      }

      const batchHistory: History = {
        id: generateId(),
        issueId: batch.sourceHandoverPackage.issueId,
        action: 'plan_handover_import_undo',
        operatorId: currentUser.id,
        operatorRole: currentUser.role,
        timestamp: new Date().toISOString(),
        remark: `撤销交接包批量导入 ${batch.undoPlanSnapshots.length + newImportedIds.length} 条计划${remark ? `：${remark}` : ''}`,
        planDetail: {
          handoverBatch: {
            batchId: batch.id,
            strategy: 'batch_undo',
            isUndo: true,
          },
          undoPlanIds: [...batch.undoPlanSnapshots.map(s => s.planId), ...newImportedIds],
        },
      };
      await db.addHistory(batchHistory);
      historyItems.push(batchHistory);

      const updatedBatch: HandoverImportBatch = {
        ...batch,
        status: 'undone',
        hasUndo: true,
        updatedAt: new Date().toISOString(),
        undoneAt: new Date().toISOString(),
        undoneBy: currentUser.id,
        undoneByRole: currentUser.role,
        undoneByName: currentUser.name,
        undoRemark: remark,
      };
      await db.updateHandoverImportBatch(updatedBatch);

      set(state => {
        const allUndoIds = [...batch.undoPlanSnapshots.map(s => s.planId), ...newImportedIds];
        const newReviewPlans = state.reviewPlans
          .filter(p => !allUndoIds.includes(p.id))
          .concat(restoredPlans);

        return {
          handoverImportBatches: state.handoverImportBatches.map(b =>
            b.id === batch.id ? normalizeHandoverBatchDefaults(updatedBatch) : normalizeHandoverBatchDefaults(b)
          ),
          reviewPlans: newReviewPlans,
          syncQueue: [...state.syncQueue, ...syncItems],
          histories: [...state.histories, ...historyItems],
        };
      });

      const restoredCount = restoredPlans.length + deletedPlanIds.length;
      get().addToast('success', `撤销成功：已回滚 ${restoredCount} 条计划`);

      return { success: true, restored: restoredCount };
    } catch (error) {
      await db.updateHandoverImportBatch({ ...batch, status: 'imported', updatedAt: new Date().toISOString() });
      const errorMsg = (error as Error).message;
      get().addToast('error', `撤销失败：${errorMsg}`);
      return { success: false, restored: 0, error: errorMsg };
    }
  },

  getLatestHandoverImportBatch: () => {
    const { handoverImportBatches, latestHandoverBatchId } = get();
    if (latestHandoverBatchId) {
      return handoverImportBatches.find(b => b.id === latestHandoverBatchId) || null;
    }
    return [...handoverImportBatches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0] || null;
  },

  getCurrentHandoverPrecheck: () => {
    const { handoverPrecheckResults, currentHandoverPrecheckId } = get();
    if (!currentHandoverPrecheckId) return null;
    return handoverPrecheckResults.find(p => p.id === currentHandoverPrecheckId) || null;
  },

  clearCurrentHandoverPrecheck: () => {
    set({ currentHandoverPrecheckId: null });
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
    const { issues, stores, templates, migrations, conflicts, currentUser, reviewPlans, planConflicts, planDelayRecords, handoverImportBatches, handoverPrecheckResults } = get();
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
        planDelayRecords,
        handoverImportBatches,
        handoverPrecheckResults,
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser,
      };
      downloadFile(exportToJSON(data), `inspection-export-${timestamp}.json`, 'application/json');
    } else {
      downloadFile(exportToCSV(issues, stores, templates, migrations, reviewPlans), `inspection-export-${timestamp}.csv`, 'text/csv');
    }
    get().addToast('success',
      `数据导出成功（含 ${migrations.length} 条迁移，${unresolvedConflicts.length} 条问题冲突，` +
      `${reviewPlans.length} 条复查计划，${unresolvedPlanConflicts.length} 条计划冲突，` +
      `${handoverImportBatches.length} 条交接包批次，${handoverPrecheckResults.length} 条预检记录）`
    );
  },

  getTemplateForIssue: (issue) => {
    const { templates } = get();
    return templates.find(
      t => t.id === issue.templateId && t.version === issue.templateVersion
    ) || templates.find(t => t.id === issue.templateId);
  },

  initMaterials: async () => {
    const [
      materials, materialBatches, materialBorrowForms, materialRecords, materialSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialBatches(),
      db.getAllMaterialBorrowForms(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials,
      materialBatches,
      materialBorrowForms,
      materialRecords,
      materialSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }
  },

  createMaterial: async (data) => {
    const { currentUser } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canManageMaterial(currentUser)) return { success: false, error: '权限不足，仅督导可管理物资' };

    if (!data.name || data.name.trim() === '') return { success: false, error: '请输入物资名称' };
    if (!data.category || data.category.trim() === '') return { success: false, error: '请选择物资分类' };
    if (!data.unit || data.unit.trim() === '') return { success: false, error: '请输入计量单位' };

    const now = new Date().toISOString();
    const code = data.code || generateMaterialCode();
    const initialStock = data.initialStock ?? 0;

    const baseMaterial = {
      ...data,
      id: generateId(),
      code,
      totalStock: initialStock,
      availableStock: initialStock,
      createdAt: now,
      updatedAt: now,
      synced: false,
    };

    const material = normalizeMaterialDefaults(baseMaterial as any);

    await db.addMaterial(material);

    if (initialStock > 0 && data.storeId) {
      const batchNumber = data.batchNumber || generateBatchNumber();
      const batch: MaterialStockBatch = {
        id: generateId(),
        materialId: material.id,
        storeId: data.storeId,
        batchNumber,
        quantity: initialStock,
        receivedDate: now,
        remark: '初始库存',
        createdAt: now,
        synced: false,
      };
      await db.addMaterialBatch(batch);

      const record: MaterialRecord = {
        id: generateId(),
        materialId: material.id,
        storeId: data.storeId,
        type: 'restock',
        quantity: initialStock,
        beforeStock: 0,
        afterStock: initialStock,
        operatorId: currentUser.id,
        operatorName: currentUser.name,
        operatorRole: currentUser.role,
        remark: '初始库存入库',
        timestamp: now,
        synced: false,
      };
      await db.addMaterialRecord(record);

      const syncItems = [
        createMaterialSyncQueueItem(material, 'material', 'create'),
        createMaterialSyncQueueItem(batch, 'material_batch', 'create'),
        createMaterialSyncQueueItem(record, 'material_record', 'create'),
      ];
      for (const item of syncItems) {
        await db.addMaterialSyncQueueItem(item);
      }
    } else {
      const syncItem = createMaterialSyncQueueItem(material, 'material', 'create');
      await db.addMaterialSyncQueueItem(syncItem);
    }

    const [
      updatedMaterials, updatedBatches, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialBatches(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials: updatedMaterials,
      materialBatches: updatedBatches,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', `物资「${material.name}」已创建`);
    return { success: true, material };
  },

  updateMaterial: async (id, updates) => {
    const { currentUser, materials } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canManageMaterial(currentUser)) return { success: false, error: '权限不足，仅督导可管理物资' };

    const material = materials.find(m => m.id === id);
    if (!material) return { success: false, error: '物资不存在' };

    const now = new Date().toISOString();
    const updated: Material = {
      ...material,
      ...updates,
      updatedAt: now,
      synced: false,
    };

    await db.putMaterial(updated);

    const syncItem = createMaterialSyncQueueItem(updated, 'material', 'update');
    await db.addMaterialSyncQueueItem(syncItem);

    const [updatedMaterials, updatedSyncQueue] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials: updatedMaterials,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', `物资「${updated.name}」已更新`);
    return { success: true };
  },

  deleteMaterial: async (id) => {
    const { currentUser, materials, materialBorrowForms } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canManageMaterial(currentUser)) return { success: false, error: '权限不足，仅督导可管理物资' };

    const material = materials.find(m => m.id === id);
    if (!material) return { success: false, error: '物资不存在' };

    const activeBorrows = materialBorrowForms.filter(
      f => f.materialId === id && (f.status === 'borrowed' || f.status === 'pending')
    );
    if (activeBorrows.length > 0) {
      return { success: false, error: '该物资存在未归还的借用单，无法删除' };
    }

    await db.deleteMaterial(id);

    const syncItem = createMaterialSyncQueueItem(material, 'material', 'delete');
    await db.addMaterialSyncQueueItem(syncItem);

    const [updatedMaterials, updatedSyncQueue] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials: updatedMaterials,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', `物资「${material.name}」已删除`);
    return { success: true };
  },

  addStockBatch: async (data) => {
    const { currentUser, materials, materialBatches, materialRecords } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canManageStock(currentUser)) return { success: false, error: '权限不足，仅督导可管理库存' };

    const { materialId, storeId, quantity, batchNumber, remark, receivedDate } = data;
    const material = materials.find(m => m.id === materialId);
    if (!material) return { success: false, error: '物资不存在' };

    if (quantity <= 0) return { success: false, error: '入库数量必须大于0' };

    const now = new Date().toISOString();
    const newBatchNumber = batchNumber || generateBatchNumber();
    const newReceivedDate = receivedDate || now;

    const beforeStock = material.availableStock;
    const afterStock = beforeStock + quantity;

    const batch: MaterialStockBatch = {
      id: generateId(),
      materialId,
      storeId,
      batchNumber: newBatchNumber,
      quantity,
      receivedDate: newReceivedDate,
      remark,
      createdAt: now,
      synced: false,
    };

    const record: MaterialRecord = {
      id: generateId(),
      materialId,
      storeId,
      type: 'restock',
      quantity,
      beforeStock,
      afterStock,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      batchId: batch.id,
      remark: remark || '库存入库',
      timestamp: now,
      synced: false,
    };

    const updatedMaterial: Material = {
      ...material,
      totalStock: material.totalStock + quantity,
      availableStock: afterStock,
      updatedAt: now,
      synced: false,
    };

    await Promise.all([
      db.addMaterialBatch(batch),
      db.addMaterialRecord(record),
      db.putMaterial(updatedMaterial),
    ]);

    const syncItems = [
      createMaterialSyncQueueItem(batch, 'material_batch', 'create'),
      createMaterialSyncQueueItem(record, 'material_record', 'create'),
      createMaterialSyncQueueItem(updatedMaterial, 'material', 'update'),
    ];
    for (const item of syncItems) {
      await db.addMaterialSyncQueueItem(item);
    }

    const [
      updatedMaterials, updatedBatches, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialBatches(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials: updatedMaterials,
      materialBatches: updatedBatches,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', `已入库 ${quantity} ${material.unit}「${material.name}」`);
    return { success: true };
  },

  adjustStock: async (materialId, storeId, quantity, reason) => {
    const { currentUser, materials, materialRecords } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canManageStock(currentUser)) return { success: false, error: '权限不足，仅督导可调整库存' };

    const material = materials.find(m => m.id === materialId);
    if (!material) return { success: false, error: '物资不存在' };

    if (quantity === 0) return { success: false, error: '调整数量不能为0' };
    if (quantity < 0 && material.availableStock + quantity < 0) {
      return { success: false, error: `库存不足，最多可调减 ${material.availableStock} ${material.unit}` };
    }

    const now = new Date().toISOString();
    const beforeStock = material.availableStock;
    const afterStock = beforeStock + quantity;
    const recordType = quantity > 0 ? 'restock' : 'loss';

    const record: MaterialRecord = {
      id: generateId(),
      materialId,
      storeId,
      type: recordType,
      quantity: Math.abs(quantity),
      beforeStock,
      afterStock,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      remark: `库存调整：${quantity > 0 ? '增加' : '减少'} ${Math.abs(quantity)} ${material.unit}，原因：${reason}`,
      timestamp: now,
      synced: false,
    };

    const updatedMaterial: Material = {
      ...material,
      totalStock: material.totalStock + quantity,
      availableStock: afterStock,
      updatedAt: now,
      synced: false,
    };

    await Promise.all([
      db.addMaterialRecord(record),
      db.putMaterial(updatedMaterial),
    ]);

    const syncItems = [
      createMaterialSyncQueueItem(record, 'material_record', 'create'),
      createMaterialSyncQueueItem(updatedMaterial, 'material', 'update'),
    ];
    for (const item of syncItems) {
      await db.addMaterialSyncQueueItem(item);
    }

    const [
      updatedMaterials, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials: updatedMaterials,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    const action = quantity > 0 ? '增加' : '减少';
    get().addToast('success', `库存已${action} ${Math.abs(quantity)} ${material.unit}「${material.name}」`);
    return { success: true };
  },

  validateBorrowConflicts: (materialId, storeId, borrowerId, quantity) => {
    const { materials, materialBorrowForms, currentUser, stores } = get();
    const conflicts: Array<{ type: string; message: string; options: string[] }> = [];

    const material = materials.find(m => m.id === materialId);
    if (!material) {
      conflicts.push({
        type: 'material_not_found',
        message: '物资不存在',
        options: ['请选择其他物资']
      });
      return conflicts;
    }

    if (material.availableStock < quantity) {
      conflicts.push({
        type: 'insufficient_stock',
        message: `库存不足，当前可用库存为 ${material.availableStock} ${material.unit}，申请数量为 ${quantity} ${material.unit}`,
        options: [
          `减少申请数量至 ${material.availableStock} ${material.unit}`,
          '联系督导补充库存',
          '取消本次申请'
        ]
      });
    }

    if (currentUser && currentUser.role === 'manager' && currentUser.storeId !== storeId) {
      const store = stores.find(s => s.id === storeId);
      conflicts.push({
        type: 'cross_store_borrow',
        message: `您仅可为「${stores.find(s => s.id === currentUser.storeId)?.name || currentUser.storeId}」的人员申请借用，无法为「${store?.name || storeId}」申请`,
        options: [
          '请切换到对应门店身份',
          '联系目标门店店长操作',
          '取消本次申请'
        ]
      });
    }

    const activeBorrows = materialBorrowForms.filter(
      f => f.materialId === materialId &&
        f.storeId === storeId &&
        f.borrowerId === borrowerId &&
        (f.status === 'borrowed' || f.status === 'pending')
    );

    if (activeBorrows.length > 0) {
      const totalBorrowed = activeBorrows.reduce((sum, f) => sum + f.quantity, 0);
      conflicts.push({
        type: 'duplicate_borrow',
        message: `该用户已有 ${activeBorrows.length} 笔未归还的「${material.name}」，共计 ${totalBorrowed} ${material.unit}`,
        options: [
          '先归还已借物资后再申请',
          '继续申请（合并处理）',
          '取消本次申请'
        ]
      });
    }

    const pendingForms = materialBorrowForms.filter(
      f => f.materialId === materialId &&
        f.storeId === storeId &&
        f.status === 'pending'
    );

    if (pendingForms.length > 0) {
      const totalPending = pendingForms.reduce((sum, f) => sum + f.quantity, 0);
      if (material.availableStock - totalPending < quantity) {
        conflicts.push({
          type: 'pending_reservation',
          message: `另有 ${pendingForms.length} 笔待领取申请已预留 ${totalPending} ${material.unit}，扣除后剩余库存不足`,
          options: [
            `减少申请数量至 ${Math.max(0, material.availableStock - totalPending)} ${material.unit}`,
            '等待其他申请处理完毕',
            '联系督导确认库存',
            '取消本次申请'
          ]
        });
      }
    }

    return conflicts;
  },

  createBorrowForm: async (data) => {
    const { currentUser } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canBorrowMaterial(currentUser, data.storeId)) return { success: false, error: '权限不足，无法申请借用' };

    if (!data.materialId) return { success: false, error: '请选择物资' };
    if (!data.storeId) return { success: false, error: '请选择门店' };
    if (!data.borrowerId) return { success: false, error: '请选择借用人' };
    if (data.quantity <= 0) return { success: false, error: '借用数量必须大于0' };

    const conflicts = get().validateBorrowConflicts(
      data.materialId,
      data.storeId,
      data.borrowerId,
      data.quantity
    );

    if (conflicts.length > 0 && !data.status) {
      return { success: false, error: '存在借用冲突', conflicts };
    }

    const now = new Date().toISOString();
    const status: MaterialBorrowStatus = data.status || 'pending';

    const baseForm = {
      ...data,
      id: generateId(),
      formNumber: generateBorrowFormNumber(),
      status,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      createdAt: now,
      updatedAt: now,
      synced: false,
    };

    const form = normalizeMaterialBorrowFormDefaults(baseForm as any);

    await db.addMaterialBorrowForm(form);

    if (status === 'borrowed') {
      const { materials } = get();
      const material = materials.find(m => m.id === data.materialId);
      if (material) {
        const beforeStock = material.availableStock;
        const afterStock = beforeStock - data.quantity;

        const record: MaterialRecord = {
          id: generateId(),
          materialId: data.materialId,
          storeId: data.storeId,
          formId: form.id,
          type: 'borrow',
          quantity: data.quantity,
          beforeStock,
          afterStock,
          operatorId: currentUser.id,
          operatorName: currentUser.name,
          operatorRole: currentUser.role,
          relatedUserId: data.borrowerId,
          relatedUserName: data.borrowerName,
          remark: data.purpose || '物资借出',
          timestamp: now,
          synced: false,
        };

        const updatedMaterial: Material = {
          ...material,
          availableStock: afterStock,
          updatedAt: now,
          synced: false,
        };

        await Promise.all([
          db.addMaterialRecord(record),
          db.putMaterial(updatedMaterial),
        ]);

        const recordSyncItem = createMaterialSyncQueueItem(record, 'material_record', 'create');
        const materialSyncItem = createMaterialSyncQueueItem(updatedMaterial, 'material', 'update');
        await db.addMaterialSyncQueueItem(recordSyncItem);
        await db.addMaterialSyncQueueItem(materialSyncItem);
      }
    }

    const formSyncItem = createMaterialSyncQueueItem(form, 'material_borrow', 'create');
    await db.addMaterialSyncQueueItem(formSyncItem);

    const [
      updatedForms, updatedMaterials, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterialBorrowForms(),
      db.getAllMaterials(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materialBorrowForms: updatedForms,
      materials: updatedMaterials,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    const statusLabel = MATERIAL_BORROW_STATUS_LABELS[status];
    get().addToast('success', `借用单已${statusLabel}`);
    return { success: true, form };
  },

  updateBorrowForm: async (formId, updates) => {
    const { currentUser, materialBorrowForms } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const form = materialBorrowForms.find(f => f.id === formId);
    if (!form) return { success: false, error: '借用单不存在' };
    if (form.status !== 'draft') return { success: false, error: '仅草稿状态的借用单可编辑' };
    if (form.borrowerId !== currentUser.id) return { success: false, error: '仅创建人可编辑' };
    if (!canBorrowMaterial(currentUser, form.storeId)) return { success: false, error: '权限不足' };

    const now = new Date().toISOString();
    const updatedForm: MaterialBorrowForm = {
      ...form,
      ...updates,
      updatedAt: now,
      synced: false,
    };

    await db.putMaterialBorrowForm(updatedForm);

    const syncItem = createMaterialSyncQueueItem(updatedForm, 'material_borrow', 'update');
    await db.addMaterialSyncQueueItem(syncItem);

    const updatedForms = await db.getAllMaterialBorrowForms();
    set({ materialBorrowForms: updatedForms, materialSyncQueue: await db.getAllMaterialSyncQueue() });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', '借用单已更新');
    return { success: true };
  },

  cancelBorrowForm: async (formId) => {
    const { currentUser, materialBorrowForms } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const form = materialBorrowForms.find(f => f.id === formId);
    if (!form) return { success: false, error: '借用单不存在' };
    if (!['draft', 'pending'].includes(form.status)) return { success: false, error: '该状态不允许取消' };
    if (form.borrowerId !== currentUser.id) return { success: false, error: '仅创建人可取消' };
    if (!canBorrowMaterial(currentUser, form.storeId)) return { success: false, error: '权限不足' };

    const now = new Date().toISOString();
    const updatedForm: MaterialBorrowForm = {
      ...form,
      status: 'cancelled',
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      updatedAt: now,
      synced: false,
    };

    await db.putMaterialBorrowForm(updatedForm);

    const syncItem = createMaterialSyncQueueItem(updatedForm, 'material_borrow', 'update');
    await db.addMaterialSyncQueueItem(syncItem);

    const updatedForms = await db.getAllMaterialBorrowForms();
    set({ materialBorrowForms: updatedForms, materialSyncQueue: await db.getAllMaterialSyncQueue() });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', '借用单已取消');
    return { success: true };
  },

  submitBorrowForm: async (formId) => {
    const { currentUser, materialBorrowForms, materials } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const form = materialBorrowForms.find(f => f.id === formId);
    if (!form) return { success: false, error: '借用单不存在' };
    if (form.status !== 'pending' && form.status !== 'draft') {
      return { success: false, error: '该借用单状态不允许提交' };
    }

    if (!canBorrowMaterial(currentUser, form.storeId)) {
      return { success: false, error: '权限不足，无法确认领取' };
    }

    const material = materials.find(m => m.id === form.materialId);
    if (!material) return { success: false, error: '物资不存在' };

    const conflicts = get().validateBorrowConflicts(
      form.materialId,
      form.storeId,
      form.borrowerId,
      form.quantity
    );

    const stockConflict = conflicts.find(c => c.type === 'insufficient_stock' || c.type === 'pending_reservation');
    if (stockConflict) {
      return { success: false, error: stockConflict.message, conflicts };
    }

    const now = new Date().toISOString();
    const beforeStock = material.availableStock;
    const afterStock = beforeStock - form.quantity;

    const updatedForm: MaterialBorrowForm = {
      ...form,
      status: 'borrowed',
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      updatedAt: now,
      synced: false,
    };

    const record: MaterialRecord = {
      id: generateId(),
      materialId: form.materialId,
      storeId: form.storeId,
      formId: form.id,
      type: 'borrow',
      quantity: form.quantity,
      beforeStock,
      afterStock,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      relatedUserId: form.borrowerId,
      relatedUserName: form.borrowerName,
      remark: form.purpose || '物资借出',
      timestamp: now,
      synced: false,
    };

    const updatedMaterial: Material = {
      ...material,
      availableStock: afterStock,
      updatedAt: now,
      synced: false,
    };

    await Promise.all([
      db.putMaterialBorrowForm(updatedForm),
      db.addMaterialRecord(record),
      db.putMaterial(updatedMaterial),
    ]);

    const syncItems = [
      createMaterialSyncQueueItem(updatedForm, 'material_borrow', 'update'),
      createMaterialSyncQueueItem(record, 'material_record', 'create'),
      createMaterialSyncQueueItem(updatedMaterial, 'material', 'update'),
    ];
    for (const item of syncItems) {
      await db.addMaterialSyncQueueItem(item);
    }

    const [
      updatedForms, updatedMaterials, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterialBorrowForms(),
      db.getAllMaterials(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materialBorrowForms: updatedForms,
      materials: updatedMaterials,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', `已确认领取 ${form.quantity} ${material.unit}「${material.name}」`);
    return { success: true };
  },

  returnBorrowForm: async function (formId: string, data?: any, lossQuantity?: number, lossReason?: string) {
    const { currentUser, materialBorrowForms, materials, stores } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };

    const form = materialBorrowForms.find(f => f.id === formId);
    if (!form) return { success: false, error: '借用单不存在' };
    if (form.status !== 'borrowed') {
      return { success: false, error: '该借用单状态不允许归还' };
    }

    if (!canReturnMaterial(currentUser, form)) {
      return { success: false, error: '权限不足，无法办理归还' };
    }

    if (currentUser.role === 'manager' && currentUser.storeId !== form.storeId) {
      const formStore = stores.find(s => s.id === form.storeId);
      const userStore = stores.find(s => s.id === currentUser.storeId);
      return {
        success: false,
        error: `跨门店归还：该借用单属于「${formStore?.name || form.storeId}」，您仅可处理「${userStore?.name || currentUser.storeId}」的归还`,
        conflicts: [{
          type: 'cross_store_return',
          message: `跨门店归还：该借用单属于「${formStore?.name || form.storeId}」，您仅可处理「${userStore?.name || currentUser.storeId}」的归还`,
          options: ['请切换到对应门店身份', '联系目标门店店长操作', '取消本次归还']
        }]
      };
    }

    const material = materials.find(m => m.id === form.materialId);
    if (!material) return { success: false, error: '物资不存在' };

    let handbackCondition: string | undefined;
    let actualLossQuantity: number | undefined;
    let actualLossReason: string | undefined;

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handbackCondition = data.handbackCondition || data.remark;
      actualLossQuantity = data.lossQuantity ?? (form.quantity - (data.quantity ?? form.quantity));
      actualLossReason = data.lossReason;
    } else {
      handbackCondition = data as string | undefined;
      actualLossQuantity = lossQuantity;
      actualLossReason = lossReason;
    }

    const actualLoss = actualLossQuantity ?? 0;
    if (actualLoss < 0 || actualLoss > form.quantity) {
      return { success: false, error: '报损数量无效' };
    }

    const returnQuantity = form.quantity - actualLoss;
    const now = new Date().toISOString();
    const beforeStock = material.availableStock;
    const afterStock = beforeStock + returnQuantity;

    const updatedForm: MaterialBorrowForm = {
      ...form,
      status: actualLoss === form.quantity ? 'lost' : 'returned',
      actualReturnDate: now,
      handbackCondition,
      lossQuantity: actualLoss,
      lossReason: actualLoss > 0 ? actualLossReason : undefined,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      updatedAt: now,
      synced: false,
    };

    const records: MaterialRecord[] = [];

    if (returnQuantity > 0) {
      records.push({
        id: generateId(),
        materialId: form.materialId,
        storeId: form.storeId,
        formId: form.id,
        type: 'return',
        quantity: returnQuantity,
        beforeStock,
        afterStock,
        operatorId: currentUser.id,
        operatorName: currentUser.name,
        operatorRole: currentUser.role,
        relatedUserId: form.borrowerId,
        relatedUserName: form.borrowerName,
        remark: handbackCondition || '物资归还',
        timestamp: now,
        synced: false,
      });
    }

    if (actualLoss > 0) {
      records.push({
        id: generateId(),
        materialId: form.materialId,
        storeId: form.storeId,
        formId: form.id,
        type: 'loss',
        quantity: actualLoss,
        beforeStock: material.totalStock,
        afterStock: material.totalStock - actualLoss,
        operatorId: currentUser.id,
        operatorName: currentUser.name,
        operatorRole: currentUser.role,
        relatedUserId: form.borrowerId,
        relatedUserName: form.borrowerName,
        remark: lossReason || '物资报损',
        timestamp: now,
        synced: false,
      });
    }

    const updatedMaterial: Material = {
      ...material,
      availableStock: afterStock,
      totalStock: material.totalStock - actualLoss,
      updatedAt: now,
      synced: false,
    };

    await Promise.all([
      db.putMaterialBorrowForm(updatedForm),
      ...records.map(r => db.addMaterialRecord(r)),
      db.putMaterial(updatedMaterial),
    ]);

    const syncItems = [
      createMaterialSyncQueueItem(updatedForm, 'material_borrow', 'update'),
      ...records.map(r => createMaterialSyncQueueItem(r, 'material_record', 'create')),
      createMaterialSyncQueueItem(updatedMaterial, 'material', 'update'),
    ];
    for (const item of syncItems) {
      await db.addMaterialSyncQueueItem(item);
    }

    const [
      updatedForms, updatedMaterials, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterialBorrowForms(),
      db.getAllMaterials(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materialBorrowForms: updatedForms,
      materials: updatedMaterials,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    const statusText = actualLoss === form.quantity ? '已报损' : `已归还 ${returnQuantity} ${material.unit}`;
    const lossText = actualLoss > 0 ? `，报损 ${actualLoss} ${material.unit}` : '';
    get().addToast('success', `${statusText}${lossText}`);
    return { success: true };
  },

  reportLoss: async (materialId, storeId, quantity, reason, operatorRemark) => {
    const { currentUser, materials, materialRecords } = get();
    if (!currentUser) return { success: false, error: '请先选择身份' };
    if (!canReportLoss(currentUser)) return { success: false, error: '权限不足，仅督导可执行报损' };

    const material = materials.find(m => m.id === materialId);
    if (!material) return { success: false, error: '物资不存在' };

    if (quantity <= 0) return { success: false, error: '报损数量必须大于0' };
    if (quantity > material.availableStock) {
      return { success: false, error: `报损数量不能超过可用库存（${material.availableStock} ${material.unit}）` };
    }

    const now = new Date().toISOString();
    const beforeStock = material.availableStock;
    const afterStock = beforeStock - quantity;

    const record: MaterialRecord = {
      id: generateId(),
      materialId,
      storeId,
      type: 'loss',
      quantity,
      beforeStock,
      afterStock,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      remark: `${reason || '物资报损'}${operatorRemark ? ` - ${operatorRemark}` : ''}`,
      timestamp: now,
      synced: false,
    };

    const updatedMaterial: Material = {
      ...material,
      availableStock: afterStock,
      totalStock: material.totalStock - quantity,
      updatedAt: now,
      synced: false,
    };

    await Promise.all([
      db.addMaterialRecord(record),
      db.putMaterial(updatedMaterial),
    ]);

    const syncItems = [
      createMaterialSyncQueueItem(record, 'material_record', 'create'),
      createMaterialSyncQueueItem(updatedMaterial, 'material', 'update'),
    ];
    for (const item of syncItems) {
      await db.addMaterialSyncQueueItem(item);
    }

    const [
      updatedMaterials, updatedRecords, updatedSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials: updatedMaterials,
      materialRecords: updatedRecords,
      materialSyncQueue: updatedSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    get().addToast('success', `已报损 ${quantity} ${material.unit}「${material.name}」`);
    return { success: true };
  },

  processMaterialSyncQueue: async (simulateConflict = false) => {
    const { materialSyncQueue: currentQueue, isOnline } = get();
    if (!isOnline) {
      get().addToast('warning', '当前离线，无法同步');
      return;
    }

    const pendingItems = currentQueue.filter(i => i.status === 'pending' || i.status === 'failed');

    for (const item of pendingItems) {
      await db.putMaterialSyncQueueItem({ ...item, status: 'syncing', lastAttempt: new Date().toISOString() });
      set({ materialSyncQueue: await db.getAllMaterialSyncQueue() });

      if (item.entityType === 'material' && item.payload) {
        const result = await syncMaterialToServer(item.payload, simulateConflict && Math.random() > 0.7);
        if (result.success) {
          await db.putMaterial({ ...item.payload, synced: true });
          await db.putMaterialSyncQueueItem({ ...item, status: 'completed' });
        } else {
          const errMsg = result.error || '物资同步失败';
          await db.putMaterialSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: errMsg,
          });
        }
      } else if (item.entityType === 'material_borrow' && item.payload) {
        const result = await syncMaterialBorrowFormToServer(item.payload, simulateConflict && Math.random() > 0.7);
        if (result.success) {
          await db.putMaterialBorrowForm({ ...item.payload, synced: true });
          await db.putMaterialSyncQueueItem({ ...item, status: 'completed' });
        } else {
          const errMsg = result.error || '借用单同步失败';
          await db.putMaterialSyncQueueItem({
            ...item,
            status: 'failed',
            retryCount: item.retryCount + 1,
            errorMessage: errMsg,
          });
        }
      } else {
        await db.putMaterialSyncQueueItem({ ...item, status: 'completed' });
      }
    }

    const [
      materials, materialBorrowForms, materialRecords, materialSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialBorrowForms(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials,
      materialBorrowForms,
      materialRecords,
      materialSyncQueue,
    });

    const completedCount = materialSyncQueue.filter(i => i.status === 'completed').length;
    const failedCount = materialSyncQueue.filter(i => i.status === 'failed').length;
    if (completedCount > 0) {
      get().addToast('success', `物资同步成功 ${completedCount} 项`);
    }
    if (failedCount > 0) {
      get().addToast('error', `物资同步失败 ${failedCount} 项`);
    }
  },

  retryMaterialSyncItem: async (itemId) => {
    const item = get().materialSyncQueue.find(i => i.id === itemId);
    if (!item) return;

    await db.putMaterialSyncQueueItem({ ...item, status: 'pending', retryCount: 0 });
    const materialSyncQueue = await db.getAllMaterialSyncQueue();
    set({ materialSyncQueue });
    get().processMaterialSyncQueue();
  },

  clearCompletedMaterialSync: async () => {
    const { materialSyncQueue } = get();
    const completed = materialSyncQueue.filter(i => i.status === 'completed');
    for (const item of completed) {
      await db.deleteMaterialSyncQueueItem(item.id);
    }
    const updatedQueue = await db.getAllMaterialSyncQueue();
    set({ materialSyncQueue: updatedQueue });
    get().addToast('info', `已清除 ${completed.length} 条已完成同步记录`);
  },

  saveDraftBorrowForm: (form) => {
    const { currentUser } = get();
    if (!currentUser) return;

    const now = new Date().toISOString();
    const draft: MaterialBorrowForm = normalizeMaterialBorrowFormDefaults({
      ...form,
      id: form.id || generateId(),
      formNumber: form.formNumber || generateBorrowFormNumber(),
      status: 'draft',
      borrowerId: form.borrowerId || currentUser.id,
      borrowerName: form.borrowerName || currentUser.name,
      borrowerRole: form.borrowerRole || currentUser.role,
      operatorId: currentUser.id,
      operatorName: currentUser.name,
      operatorRole: currentUser.role,
      createdAt: form.createdAt || now,
      updatedAt: now,
      synced: false,
    } as any);

    set({ pendingMaterialBorrowForm: draft });
    get().addToast('info', '草稿已保存');
  },

  clearDraftBorrowForm: () => {
    set({ pendingMaterialBorrowForm: null });
  },

  saveMaterialDraft: (form) => {
    get().saveDraftBorrowForm(form);
    set({ currentMaterialDraft: get().pendingMaterialBorrowForm });
  },

  clearMaterialDraft: () => {
    get().clearDraftBorrowForm();
    set({ currentMaterialDraft: null });
  },

  importMaterialBackup: async (rawData) => {
    const { currentUser, materials: existingMaterials, stores } = get();
    if (!currentUser) return { success: false, warnings: [], errors: ['请先登录'] };
    if (!canManageMaterial(currentUser)) {
      return { success: false, warnings: [], errors: ['权限不足，仅督导可导入物资数据'] };
    }

    const validation = validateMaterialBackupImport(rawData, existingMaterials, currentUser);
    set({ lastMaterialImportValidation: validation, materialImportWarnings: validation.warnings });

    if (!validation.valid) {
      for (const err of validation.errors) {
        get().addToast('error', err);
      }
      return { success: false, warnings: validation.warnings, errors: validation.errors };
    }

    const now = new Date().toISOString();
    const importedIds = new Set<string>();

    for (const material of validation.materialsToImport) {
      if (importedIds.has(material.id)) continue;
      try {
        await db.addMaterial(material);
        importedIds.add(material.id);
      } catch {
        await db.putMaterial(material);
      }
      const syncItem = createMaterialSyncQueueItem(material, 'material', 'create');
      await db.addMaterialSyncQueueItem(syncItem);
    }

    for (const batch of validation.batchesToImport) {
      try {
        await db.addMaterialBatch(batch);
      } catch {
        await db.putMaterialBatch(batch);
      }
      const syncItem = createMaterialSyncQueueItem(batch, 'material_batch', 'create');
      await db.addMaterialSyncQueueItem(syncItem);
    }

    for (const form of validation.borrowFormsToImport) {
      try {
        await db.addMaterialBorrowForm(form);
      } catch {
        await db.putMaterialBorrowForm(form);
      }
      const syncItem = createMaterialSyncQueueItem(form, 'material_borrow', 'create');
      await db.addMaterialSyncQueueItem(syncItem);
    }

    for (const record of validation.recordsToImport) {
      try {
        await db.addMaterialRecord(record);
      } catch {
        continue;
      }
      const syncItem = createMaterialSyncQueueItem(record, 'material_record', 'create');
      await db.addMaterialSyncQueueItem(syncItem);
    }

    const [
      materials, materialBatches, materialBorrowForms, materialRecords, materialSyncQueue
    ] = await Promise.all([
      db.getAllMaterials(),
      db.getAllMaterialBatches(),
      db.getAllMaterialBorrowForms(),
      db.getAllMaterialRecords(),
      db.getAllMaterialSyncQueue(),
    ]);

    set({
      materials,
      materialBatches,
      materialBorrowForms,
      materialRecords,
      materialSyncQueue,
    });

    if (get().isOnline) {
      get().processMaterialSyncQueue();
    }

    for (const warn of validation.warnings) {
      get().addToast('warning', warn.message);
    }

    get().addToast('success',
      `导入完成：${validation.materialsToImport.length} 条物资，` +
      `${validation.batchesToImport.length} 条库存批次，` +
      `${validation.borrowFormsToImport.length} 条借用单，` +
      `${validation.recordsToImport.length} 条出入库记录`
    );

    return { success: true, warnings: validation.warnings, errors: [] };
  },

  exportMaterialBackup: () => {
    const { currentUser, materials, materialBatches, materialBorrowForms, materialRecords, materialSyncQueue } = get();
    if (!currentUser) return;
    if (!canExportMaterial(currentUser)) {
      get().addToast('error', '权限不足，仅督导可导出物资数据');
      return;
    }

    const payload = buildMaterialExportPayload(
      materials,
      materialBatches,
      materialBorrowForms,
      materialRecords,
      materialSyncQueue,
      currentUser
    );

    const content = JSON.stringify(payload, null, 2);
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadFile(content, `material-backup-${timestamp}.json`, 'application/json');

    get().addToast('success',
      `物资数据导出成功（${materials.length} 条物资，` +
      `${materialBorrowForms.length} 条借用单，` +
      `${materialRecords.length} 条出入库记录）`
    );
  },

  getMaterialBorrowFormsForCurrentUser: () => {
    const { materialBorrowForms, currentUser } = get();
    if (!currentUser) return [];

    if (currentUser.role === 'supervisor') return materialBorrowForms;

    if (currentUser.role === 'manager') {
      return materialBorrowForms.filter(f => f.storeId === currentUser.storeId);
    }

    return materialBorrowForms.filter(f => f.borrowerId === currentUser.id);
  },

  getMaterialBorrowFormsForStore: (storeId) => {
    const { materialBorrowForms, currentUser, stores } = get();
    if (!currentUser) return [];
    if (!canViewMaterial(currentUser, storeId)) return [];

    return materialBorrowForms.filter(f => f.storeId === storeId);
  },

  getMaterialOccupancyByStore: (storeId) => {
    const { materialBorrowForms, materials, stores, currentUser } = get();
    if (!currentUser || !canViewStoreOccupancy(currentUser, storeId)) return [];

    const store = stores.find(s => s.id === storeId);
    const occupancyMap = new Map<string, { materialId: string; materialName: string; materialCode: string; borrowedQuantity: number; storeId: string; storeName?: string }>();

    const activeForms = materialBorrowForms.filter(
      f => f.storeId === storeId && (f.status === 'borrowed' || f.status === 'pending')
    );

    for (const form of activeForms) {
      const material = materials.find(m => m.id === form.materialId);
      if (!material) continue;

      const existing = occupancyMap.get(form.materialId);
      if (existing) {
        existing.borrowedQuantity += form.quantity;
      } else {
        occupancyMap.set(form.materialId, {
          materialId: form.materialId,
          materialName: material.name,
          materialCode: material.code,
          borrowedQuantity: form.quantity,
          storeId,
          storeName: store?.name,
        });
      }
    }

    return Array.from(occupancyMap.values());
  },
}));
