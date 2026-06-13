import { openDB, IDBPDatabase } from 'idb';
import {
  Issue, Store, Template, History, Conflict, SyncQueueItem, User, MigrationRecord,
  ReviewPlan, PlanConflict, PlanDelayRecord, HandoverImportBatch, HandoverImportPrecheckResult,
  Material, MaterialStockBatch, MaterialBorrowForm, MaterialRecord, MaterialSyncQueueItem
} from '@/types';
import { normalizeReviewPlanDefaults } from '@/utils/helpers';

const DB_NAME = 'inspection-pwa-db';
const DB_VERSION = 6;

export interface DBSchema {
  users: { key: string; value: User };
  stores: { key: string; value: Store };
  templates: { key: string; value: Template; indexes: { 'by-name': string; 'by-version': string } };
  issues: { key: string; value: Issue; indexes: { 'by-status': string; 'by-store': string; 'by-creator': string; 'by-template': string; 'by-template-version': string } };
  histories: { key: string; value: History; indexes: { 'by-issue': string } };
  conflicts: { key: string; value: Conflict; indexes: { 'by-issue': string } };
  syncQueue: { key: string; value: SyncQueueItem; indexes: { 'by-status': string; 'by-issue': string } };
  migrations: { key: string; value: MigrationRecord; indexes: { 'by-template': string; 'by-operator': string } };
  reviewPlans: { key: string; value: ReviewPlan; indexes: { 'by-issue': string; 'by-assignee': string; 'by-status': string; 'by-creator': string; 'by-due-status': string } };
  planConflicts: { key: string; value: PlanConflict; indexes: { 'by-issue': string; 'by-plan': string } };
  planDelayRecords: { key: string; value: PlanDelayRecord; indexes: { 'by-plan': string; 'by-issue': string; 'by-status': string; 'by-requester': string; 'by-approver': string } };
  handoverImportBatches: { key: string; value: HandoverImportBatch; indexes: { 'by-status': string; 'by-creator': string; 'by-created-at': string } };
  handoverPrecheckResults: { key: string; value: HandoverImportPrecheckResult; indexes: { 'by-batch': string; 'by-creator': string } };
  materials: { key: string; value: Material; indexes: { 'by-code': string; 'by-category': string; 'by-status': string } };
  materialBatches: { key: string; value: MaterialStockBatch; indexes: { 'by-material': string; 'by-store': string; 'by-batch': string } };
  materialBorrowForms: { key: string; value: MaterialBorrowForm; indexes: { 'by-material': string; 'by-store': string; 'by-borrower': string; 'by-status': string } };
  materialRecords: { key: string; value: MaterialRecord; indexes: { 'by-material': string; 'by-store': string; 'by-form': string; 'by-operator': string; 'by-timestamp': string } };
  materialSyncQueue: { key: string; value: MaterialSyncQueueItem; indexes: { 'by-status': string; 'by-entity': string } };
}

let db: IDBPDatabase<DBSchema> | null = null;

export async function initDB(): Promise<IDBPDatabase<DBSchema>> {
  if (db) return db;

  db = await openDB<DBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stores')) {
        db.createObjectStore('stores', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('templates')) {
        const tplStore = db.createObjectStore('templates', { keyPath: 'id' });
        tplStore.createIndex('by-name', 'name');
        tplStore.createIndex('by-version', 'version');
      } else if (oldVersion < 2) {
        const tplStore = db.transaction('templates', 'readwrite').store as any;
        if (!tplStore.indexNames.contains('by-name')) {
          tplStore.createIndex('by-name', 'name');
        }
        if (!tplStore.indexNames.contains('by-version')) {
          tplStore.createIndex('by-version', 'version');
        }
      }
      if (!db.objectStoreNames.contains('issues')) {
        const issueStore = db.createObjectStore('issues', { keyPath: 'id' });
        issueStore.createIndex('by-status', 'status');
        issueStore.createIndex('by-store', 'storeId');
        issueStore.createIndex('by-creator', 'creatorId');
        issueStore.createIndex('by-template', 'templateId');
        issueStore.createIndex('by-template-version', ['templateId', 'templateVersion']);
      } else if (oldVersion < 2) {
        const issueStore = db.transaction('issues', 'readwrite').store as any;
        if (!issueStore.indexNames.contains('by-template')) {
          issueStore.createIndex('by-template', 'templateId');
        }
        if (!issueStore.indexNames.contains('by-template-version')) {
          issueStore.createIndex('by-template-version', ['templateId', 'templateVersion']);
        }
      }
      if (!db.objectStoreNames.contains('histories')) {
        const historyStore = db.createObjectStore('histories', { keyPath: 'id' });
        historyStore.createIndex('by-issue', 'issueId');
      }
      if (!db.objectStoreNames.contains('conflicts')) {
        const conflictStore = db.createObjectStore('conflicts', { keyPath: 'id' });
        conflictStore.createIndex('by-issue', 'issueId');
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
        syncStore.createIndex('by-status', 'status');
        syncStore.createIndex('by-issue', 'issueId');
      }
      if (!db.objectStoreNames.contains('migrations')) {
        const migrationStore = db.createObjectStore('migrations', { keyPath: 'id' });
        migrationStore.createIndex('by-template', 'templateId');
        migrationStore.createIndex('by-operator', 'operatorId');
      }
      if (!db.objectStoreNames.contains('reviewPlans')) {
        const planStore = db.createObjectStore('reviewPlans', { keyPath: 'id' });
        planStore.createIndex('by-issue', 'issueId');
        planStore.createIndex('by-assignee', 'assigneeId');
        planStore.createIndex('by-status', 'status');
        planStore.createIndex('by-creator', 'creatorId');
      } else if (oldVersion < 3) {
        const planStore = db.transaction('reviewPlans', 'readwrite').store as any;
        if (!planStore.indexNames.contains('by-issue')) {
          planStore.createIndex('by-issue', 'issueId');
        }
        if (!planStore.indexNames.contains('by-assignee')) {
          planStore.createIndex('by-assignee', 'assigneeId');
        }
        if (!planStore.indexNames.contains('by-status')) {
          planStore.createIndex('by-status', 'status');
        }
        if (!planStore.indexNames.contains('by-creator')) {
          planStore.createIndex('by-creator', 'creatorId');
        }
      }
      if (!db.objectStoreNames.contains('planConflicts')) {
        const pcStore = db.createObjectStore('planConflicts', { keyPath: 'id' });
        pcStore.createIndex('by-issue', 'issueId');
        pcStore.createIndex('by-plan', 'planId');
      }
      if (!db.objectStoreNames.contains('planDelayRecords')) {
        const pdrStore = db.createObjectStore('planDelayRecords', { keyPath: 'id' });
        pdrStore.createIndex('by-plan', 'planId');
        pdrStore.createIndex('by-issue', 'issueId');
        pdrStore.createIndex('by-status', 'status');
        pdrStore.createIndex('by-requester', 'requesterId');
        pdrStore.createIndex('by-approver', 'approverId');
      }
      if (oldVersion < 4) {
        const planTx = db.transaction('reviewPlans', 'readwrite');
        const planStore = planTx.store;
        const cursorReq = planStore.openCursor();
        cursorReq.then(function processCursor(cursor) {
          if (!cursor) return;
          const p = cursor.value as any;
          const normalized = normalizeReviewPlanDefaults(p);
          cursor.update(normalized);
          return cursor.continue().then(processCursor);
        }).catch(() => { /* ignore cursor errors */ });
        const planIdxStore = (planTx as any).store;
        if (!planIdxStore.indexNames.contains('by-due-status')) {
          try { planIdxStore.createIndex('by-due-status', 'dueStatus'); } catch { /* ignore */ }
        }
      }
      if (oldVersion < 5) {
        if (!db.objectStoreNames.contains('handoverImportBatches')) {
          const hbStore = db.createObjectStore('handoverImportBatches', { keyPath: 'id' });
          hbStore.createIndex('by-status', 'status');
          hbStore.createIndex('by-creator', 'createdBy');
          hbStore.createIndex('by-created-at', 'createdAt');
        }
        if (!db.objectStoreNames.contains('handoverPrecheckResults')) {
          const hpStore = db.createObjectStore('handoverPrecheckResults', { keyPath: 'id' });
          hpStore.createIndex('by-batch', 'batchId');
          hpStore.createIndex('by-creator', 'createdBy');
        }
      }
      if (oldVersion < 6) {
        if (!db.objectStoreNames.contains('materials')) {
          const matStore = db.createObjectStore('materials', { keyPath: 'id' });
          matStore.createIndex('by-code', 'code');
          matStore.createIndex('by-category', 'category');
          matStore.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('materialBatches')) {
          const mbStore = db.createObjectStore('materialBatches', { keyPath: 'id' });
          mbStore.createIndex('by-material', 'materialId');
          mbStore.createIndex('by-store', 'storeId');
          mbStore.createIndex('by-batch', 'batchNumber');
        }
        if (!db.objectStoreNames.contains('materialBorrowForms')) {
          const mbfStore = db.createObjectStore('materialBorrowForms', { keyPath: 'id' });
          mbfStore.createIndex('by-material', 'materialId');
          mbfStore.createIndex('by-store', 'storeId');
          mbfStore.createIndex('by-borrower', 'borrowerId');
          mbfStore.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('materialRecords')) {
          const mrStore = db.createObjectStore('materialRecords', { keyPath: 'id' });
          mrStore.createIndex('by-material', 'materialId');
          mrStore.createIndex('by-store', 'storeId');
          mrStore.createIndex('by-form', 'formId');
          mrStore.createIndex('by-operator', 'operatorId');
          mrStore.createIndex('by-timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('materialSyncQueue')) {
          const msqStore = db.createObjectStore('materialSyncQueue', { keyPath: 'id' });
          msqStore.createIndex('by-status', 'status');
          msqStore.createIndex('by-entity', 'entityType');
        }
      }
    },
  });

  return db;
}

export async function getAllStores(): Promise<Store[]> {
  const database = await initDB();
  return database.getAll('stores');
}

export async function addStore(store: Store): Promise<string> {
  const database = await initDB();
  return database.add('stores', store) as Promise<string>;
}

export async function addStores(stores: Store[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('stores', 'readwrite');
  await Promise.all([...stores.map(s => tx.store.add(s)), tx.done]);
}

export async function getAllTemplates(): Promise<Template[]> {
  const database = await initDB();
  return database.getAll('templates');
}

export async function getTemplateById(id: string): Promise<Template | undefined> {
  const database = await initDB();
  return database.get('templates', id);
}

export async function getTemplatesByName(name: string): Promise<Template[]> {
  const database = await initDB();
  return database.getAllFromIndex('templates', 'by-name', name);
}

export async function addTemplate(template: Template): Promise<string> {
  const database = await initDB();
  return database.add('templates', template) as Promise<string>;
}

export async function putTemplate(template: Template): Promise<string> {
  const database = await initDB();
  return database.put('templates', template) as Promise<string>;
}

export async function addTemplates(templates: Template[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('templates', 'readwrite');
  await Promise.all([...templates.map(t => tx.store.add(t)), tx.done]);
}

export async function putTemplates(templates: Template[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('templates', 'readwrite');
  await Promise.all([...templates.map(t => tx.store.put(t)), tx.done]);
}

export async function getAllIssues(): Promise<Issue[]> {
  const database = await initDB();
  return database.getAll('issues');
}

export async function getIssuesByTemplate(templateId: string): Promise<Issue[]> {
  const database = await initDB();
  return database.getAllFromIndex('issues', 'by-template', templateId);
}

export async function getIssueById(id: string): Promise<Issue | undefined> {
  const database = await initDB();
  return database.get('issues', id);
}

export async function addIssue(issue: Issue): Promise<string> {
  const database = await initDB();
  return database.add('issues', issue) as Promise<string>;
}

export async function updateIssue(issue: Issue): Promise<string> {
  const database = await initDB();
  return database.put('issues', issue) as Promise<string>;
}

export async function updateIssues(issues: Issue[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('issues', 'readwrite');
  await Promise.all([...issues.map(i => tx.store.put(i)), tx.done]);
}

export async function deleteIssue(id: string): Promise<void> {
  const database = await initDB();
  await database.delete('issues', id);
}

export async function getHistoriesByIssue(issueId: string): Promise<History[]> {
  const database = await initDB();
  return database.getAllFromIndex('histories', 'by-issue', issueId);
}

export async function addHistory(history: History): Promise<string> {
  const database = await initDB();
  return database.add('histories', history) as Promise<string>;
}

export async function addHistories(histories: History[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('histories', 'readwrite');
  await Promise.all([...histories.map(h => tx.store.add(h)), tx.done]);
}

export async function getAllHistories(): Promise<History[]> {
  const database = await initDB();
  return database.getAll('histories');
}

export async function getAllConflicts(): Promise<Conflict[]> {
  const database = await initDB();
  return database.getAll('conflicts');
}

export async function addConflict(conflict: Conflict): Promise<string> {
  const database = await initDB();
  return database.add('conflicts', conflict) as Promise<string>;
}

export async function updateConflict(conflict: Conflict): Promise<string> {
  const database = await initDB();
  return database.put('conflicts', conflict) as Promise<string>;
}

export async function getAllSyncQueue(): Promise<SyncQueueItem[]> {
  const database = await initDB();
  return database.getAll('syncQueue');
}

export async function addSyncQueueItem(item: SyncQueueItem): Promise<string> {
  const database = await initDB();
  return database.add('syncQueue', item) as Promise<string>;
}

export async function updateSyncQueueItem(item: SyncQueueItem): Promise<string> {
  const database = await initDB();
  return database.put('syncQueue', item) as Promise<string>;
}

export async function deleteSyncQueueItem(id: string): Promise<void> {
  const database = await initDB();
  await database.delete('syncQueue', id);
}

export async function getSyncQueueByStatus(status: string): Promise<SyncQueueItem[]> {
  const database = await initDB();
  return database.getAllFromIndex('syncQueue', 'by-status', status);
}

export async function getAllMigrations(): Promise<MigrationRecord[]> {
  const database = await initDB();
  return database.getAll('migrations');
}

export async function getMigrationsByTemplate(templateId: string): Promise<MigrationRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('migrations', 'by-template', templateId);
}

export async function addMigration(migration: MigrationRecord): Promise<string> {
  const database = await initDB();
  return database.add('migrations', migration) as Promise<string>;
}

export async function getCurrentUser(): Promise<User | null> {
  const stored = localStorage.getItem('currentUser');
  return stored ? JSON.parse(stored) : null;
}

export async function saveCurrentUser(user: User | null): Promise<void> {
  if (user) {
    localStorage.setItem('currentUser', JSON.stringify(user));
  } else {
    localStorage.removeItem('currentUser');
  }
}

export async function getAllReviewPlans(): Promise<ReviewPlan[]> {
  const database = await initDB();
  return database.getAll('reviewPlans');
}

export async function getReviewPlansByIssue(issueId: string): Promise<ReviewPlan[]> {
  const database = await initDB();
  return database.getAllFromIndex('reviewPlans', 'by-issue', issueId);
}

export async function getReviewPlansByAssignee(assigneeId: string): Promise<ReviewPlan[]> {
  const database = await initDB();
  return database.getAllFromIndex('reviewPlans', 'by-assignee', assigneeId);
}

export async function getReviewPlansByStatus(status: string): Promise<ReviewPlan[]> {
  const database = await initDB();
  return database.getAllFromIndex('reviewPlans', 'by-status', status);
}

export async function getReviewPlanById(id: string): Promise<ReviewPlan | undefined> {
  const database = await initDB();
  return database.get('reviewPlans', id);
}

export async function addReviewPlan(plan: ReviewPlan): Promise<string> {
  const database = await initDB();
  return database.add('reviewPlans', plan) as Promise<string>;
}

export async function updateReviewPlan(plan: ReviewPlan): Promise<string> {
  const database = await initDB();
  return database.put('reviewPlans', plan) as Promise<string>;
}

export async function deleteReviewPlan(id: string): Promise<void> {
  const database = await initDB();
  await database.delete('reviewPlans', id);
}

export async function getAllPlanConflicts(): Promise<PlanConflict[]> {
  const database = await initDB();
  return database.getAll('planConflicts');
}

export async function getPlanConflictsByIssue(issueId: string): Promise<PlanConflict[]> {
  const database = await initDB();
  return database.getAllFromIndex('planConflicts', 'by-issue', issueId);
}

export async function getPlanConflictsByPlan(planId: string): Promise<PlanConflict[]> {
  const database = await initDB();
  return database.getAllFromIndex('planConflicts', 'by-plan', planId);
}

export async function addPlanConflict(conflict: PlanConflict): Promise<string> {
  const database = await initDB();
  return database.add('planConflicts', conflict) as Promise<string>;
}

export async function updatePlanConflict(conflict: PlanConflict): Promise<string> {
  const database = await initDB();
  return database.put('planConflicts', conflict) as Promise<string>;
}

export async function getAllPlanDelayRecords(): Promise<PlanDelayRecord[]> {
  const database = await initDB();
  return database.getAll('planDelayRecords');
}

export async function getPlanDelayRecordsByPlan(planId: string): Promise<PlanDelayRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('planDelayRecords', 'by-plan', planId);
}

export async function getPlanDelayRecordsByIssue(issueId: string): Promise<PlanDelayRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('planDelayRecords', 'by-issue', issueId);
}

export async function getPlanDelayRecordsByStatus(status: string): Promise<PlanDelayRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('planDelayRecords', 'by-status', status);
}

export async function addPlanDelayRecord(record: PlanDelayRecord): Promise<string> {
  const database = await initDB();
  return database.add('planDelayRecords', record) as Promise<string>;
}

export async function updatePlanDelayRecord(record: PlanDelayRecord): Promise<string> {
  const database = await initDB();
  return database.put('planDelayRecords', record) as Promise<string>;
}

export async function clearAllData(): Promise<void> {
  const database = await initDB();
  const tx = database.transaction(
    ['stores', 'templates', 'issues', 'histories', 'conflicts', 'syncQueue', 'migrations', 'reviewPlans', 'planConflicts', 'planDelayRecords', 'handoverImportBatches', 'handoverPrecheckResults', 'materials', 'materialBatches', 'materialBorrowForms', 'materialRecords', 'materialSyncQueue'],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('stores').clear(),
    tx.objectStore('templates').clear(),
    tx.objectStore('issues').clear(),
    tx.objectStore('histories').clear(),
    tx.objectStore('conflicts').clear(),
    tx.objectStore('syncQueue').clear(),
    tx.objectStore('migrations').clear(),
    tx.objectStore('reviewPlans').clear(),
    tx.objectStore('planConflicts').clear(),
    tx.objectStore('planDelayRecords').clear(),
    tx.objectStore('handoverImportBatches').clear(),
    tx.objectStore('handoverPrecheckResults').clear(),
    tx.objectStore('materials').clear(),
    tx.objectStore('materialBatches').clear(),
    tx.objectStore('materialBorrowForms').clear(),
    tx.objectStore('materialRecords').clear(),
    tx.objectStore('materialSyncQueue').clear(),
    tx.done,
  ]);
}

export async function getAllHandoverImportBatches(): Promise<HandoverImportBatch[]> {
  const database = await initDB();
  return database.getAll('handoverImportBatches');
}

export async function getHandoverImportBatchById(id: string): Promise<HandoverImportBatch | undefined> {
  const database = await initDB();
  return database.get('handoverImportBatches', id);
}

export async function getLatestHandoverImportBatch(): Promise<HandoverImportBatch | undefined> {
  const database = await initDB();
  const all = await database.getAll('handoverImportBatches');
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export async function addHandoverImportBatch(batch: HandoverImportBatch): Promise<string> {
  const database = await initDB();
  return database.add('handoverImportBatches', batch) as Promise<string>;
}

export async function updateHandoverImportBatch(batch: HandoverImportBatch): Promise<string> {
  const database = await initDB();
  return database.put('handoverImportBatches', batch) as Promise<string>;
}

export async function getAllHandoverPrecheckResults(): Promise<HandoverImportPrecheckResult[]> {
  const database = await initDB();
  return database.getAll('handoverPrecheckResults');
}

export async function getHandoverPrecheckResultById(id: string): Promise<HandoverImportPrecheckResult | undefined> {
  const database = await initDB();
  return database.get('handoverPrecheckResults', id);
}

export async function getHandoverPrecheckResultByBatchId(batchId: string): Promise<HandoverImportPrecheckResult | undefined> {
  const database = await initDB();
  const results = await database.getAllFromIndex('handoverPrecheckResults', 'by-batch', batchId);
  return results[0];
}

export async function addHandoverPrecheckResult(result: HandoverImportPrecheckResult): Promise<string> {
  const database = await initDB();
  return database.add('handoverPrecheckResults', result) as Promise<string>;
}

export async function updateHandoverPrecheckResult(result: HandoverImportPrecheckResult): Promise<string> {
  const database = await initDB();
  return database.put('handoverPrecheckResults', result) as Promise<string>;
}

export async function getAllMaterials(): Promise<Material[]> {
  const database = await initDB();
  return database.getAll('materials');
}

export async function getMaterialById(id: string): Promise<Material | undefined> {
  const database = await initDB();
  return database.get('materials', id);
}

export async function getMaterialsByCode(code: string): Promise<Material[]> {
  const database = await initDB();
  return database.getAllFromIndex('materials', 'by-code', code);
}

export async function addMaterial(material: Material): Promise<string> {
  const database = await initDB();
  return database.add('materials', material) as Promise<string>;
}

export async function putMaterial(material: Material): Promise<string> {
  const database = await initDB();
  return database.put('materials', material) as Promise<string>;
}

export async function deleteMaterial(id: string): Promise<void> {
  const database = await initDB();
  await database.delete('materials', id);
}

export async function getAllMaterialBatches(): Promise<MaterialStockBatch[]> {
  const database = await initDB();
  return database.getAll('materialBatches');
}

export async function getMaterialBatchesByMaterial(materialId: string): Promise<MaterialStockBatch[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialBatches', 'by-material', materialId);
}

export async function getMaterialBatchesByStore(storeId: string): Promise<MaterialStockBatch[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialBatches', 'by-store', storeId);
}

export async function addMaterialBatch(batch: MaterialStockBatch): Promise<string> {
  const database = await initDB();
  return database.add('materialBatches', batch) as Promise<string>;
}

export async function putMaterialBatch(batch: MaterialStockBatch): Promise<string> {
  const database = await initDB();
  return database.put('materialBatches', batch) as Promise<string>;
}

export async function getAllMaterialBorrowForms(): Promise<MaterialBorrowForm[]> {
  const database = await initDB();
  return database.getAll('materialBorrowForms');
}

export async function getMaterialBorrowFormsByMaterial(materialId: string): Promise<MaterialBorrowForm[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialBorrowForms', 'by-material', materialId);
}

export async function getMaterialBorrowFormsByStore(storeId: string): Promise<MaterialBorrowForm[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialBorrowForms', 'by-store', storeId);
}

export async function getMaterialBorrowFormsByBorrower(borrowerId: string): Promise<MaterialBorrowForm[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialBorrowForms', 'by-borrower', borrowerId);
}

export async function getMaterialBorrowFormsByStatus(status: string): Promise<MaterialBorrowForm[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialBorrowForms', 'by-status', status);
}

export async function getMaterialBorrowFormById(id: string): Promise<MaterialBorrowForm | undefined> {
  const database = await initDB();
  return database.get('materialBorrowForms', id);
}

export async function addMaterialBorrowForm(form: MaterialBorrowForm): Promise<string> {
  const database = await initDB();
  return database.add('materialBorrowForms', form) as Promise<string>;
}

export async function putMaterialBorrowForm(form: MaterialBorrowForm): Promise<string> {
  const database = await initDB();
  return database.put('materialBorrowForms', form) as Promise<string>;
}

export async function deleteMaterialBorrowForm(id: string): Promise<void> {
  const database = await initDB();
  await database.delete('materialBorrowForms', id);
}

export async function getAllMaterialRecords(): Promise<MaterialRecord[]> {
  const database = await initDB();
  return database.getAll('materialRecords');
}

export async function getMaterialRecordsByMaterial(materialId: string): Promise<MaterialRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialRecords', 'by-material', materialId);
}

export async function getMaterialRecordsByStore(storeId: string): Promise<MaterialRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialRecords', 'by-store', storeId);
}

export async function getMaterialRecordsByForm(formId: string): Promise<MaterialRecord[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialRecords', 'by-form', formId);
}

export async function addMaterialRecord(record: MaterialRecord): Promise<string> {
  const database = await initDB();
  return database.add('materialRecords', record) as Promise<string>;
}

export async function addMaterialRecords(records: MaterialRecord[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('materialRecords', 'readwrite');
  await Promise.all([...records.map(r => tx.store.add(r)), tx.done]);
}

export async function getAllMaterialSyncQueue(): Promise<MaterialSyncQueueItem[]> {
  const database = await initDB();
  return database.getAll('materialSyncQueue');
}

export async function getMaterialSyncQueueByStatus(status: string): Promise<MaterialSyncQueueItem[]> {
  const database = await initDB();
  return database.getAllFromIndex('materialSyncQueue', 'by-status', status);
}

export async function addMaterialSyncQueueItem(item: MaterialSyncQueueItem): Promise<string> {
  const database = await initDB();
  return database.add('materialSyncQueue', item) as Promise<string>;
}

export async function putMaterialSyncQueueItem(item: MaterialSyncQueueItem): Promise<string> {
  const database = await initDB();
  return database.put('materialSyncQueue', item) as Promise<string>;
}

export async function deleteMaterialSyncQueueItem(id: string): Promise<void> {
  const database = await initDB();
  await database.delete('materialSyncQueue', id);
}
