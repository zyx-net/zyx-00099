import { openDB, IDBPDatabase } from 'idb';
import {
  Issue, Store, Template, History, Conflict, SyncQueueItem, User, MigrationRecord,
  ReviewPlan, PlanConflict
} from '@/types';

const DB_NAME = 'inspection-pwa-db';
const DB_VERSION = 3;

export interface DBSchema {
  users: { key: string; value: User };
  stores: { key: string; value: Store };
  templates: { key: string; value: Template; indexes: { 'by-name': string; 'by-version': string } };
  issues: { key: string; value: Issue; indexes: { 'by-status': string; 'by-store': string; 'by-creator': string; 'by-template': string; 'by-template-version': string } };
  histories: { key: string; value: History; indexes: { 'by-issue': string } };
  conflicts: { key: string; value: Conflict; indexes: { 'by-issue': string } };
  syncQueue: { key: string; value: SyncQueueItem; indexes: { 'by-status': string; 'by-issue': string } };
  migrations: { key: string; value: MigrationRecord; indexes: { 'by-template': string; 'by-operator': string } };
  reviewPlans: { key: string; value: ReviewPlan; indexes: { 'by-issue': string; 'by-assignee': string; 'by-status': string; 'by-creator': string } };
  planConflicts: { key: string; value: PlanConflict; indexes: { 'by-issue': string; 'by-plan': string } };
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

export async function clearAllData(): Promise<void> {
  const database = await initDB();
  const tx = database.transaction(
    ['stores', 'templates', 'issues', 'histories', 'conflicts', 'syncQueue', 'migrations', 'reviewPlans', 'planConflicts'],
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
    tx.done,
  ]);
}
