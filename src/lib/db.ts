import { openDB, IDBPDatabase } from 'idb';
import { Issue, Store, Template, History, Conflict, SyncQueueItem, User } from '@/types';

const DB_NAME = 'inspection-pwa-db';
const DB_VERSION = 1;

export interface DBSchema {
  users: { key: string; value: User };
  stores: { key: string; value: Store };
  templates: { key: string; value: Template };
  issues: { key: string; value: Issue; indexes: { 'by-status': string; 'by-store': string; 'by-creator': string } };
  histories: { key: string; value: History; indexes: { 'by-issue': string } };
  conflicts: { key: string; value: Conflict; indexes: { 'by-issue': string } };
  syncQueue: { key: string; value: SyncQueueItem; indexes: { 'by-status': string; 'by-issue': string } };
}

let db: IDBPDatabase<DBSchema> | null = null;

export async function initDB(): Promise<IDBPDatabase<DBSchema>> {
  if (db) return db;

  db = await openDB<DBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('stores')) {
        db.createObjectStore('stores', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('issues')) {
        const issueStore = db.createObjectStore('issues', { keyPath: 'id' });
        issueStore.createIndex('by-status', 'status');
        issueStore.createIndex('by-store', 'storeId');
        issueStore.createIndex('by-creator', 'creatorId');
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

export async function addTemplate(template: Template): Promise<string> {
  const database = await initDB();
  return database.add('templates', template) as Promise<string>;
}

export async function addTemplates(templates: Template[]): Promise<void> {
  const database = await initDB();
  const tx = database.transaction('templates', 'readwrite');
  await Promise.all([...templates.map(t => tx.store.add(t)), tx.done]);
}

export async function getAllIssues(): Promise<Issue[]> {
  const database = await initDB();
  return database.getAll('issues');
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

export async function clearAllData(): Promise<void> {
  const database = await initDB();
  const tx = database.transaction(
    ['stores', 'templates', 'issues', 'histories', 'conflicts', 'syncQueue'],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('stores').clear(),
    tx.objectStore('templates').clear(),
    tx.objectStore('issues').clear(),
    tx.objectStore('histories').clear(),
    tx.objectStore('conflicts').clear(),
    tx.objectStore('syncQueue').clear(),
    tx.done,
  ]);
}
