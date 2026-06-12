export type UserRole = 'inspector' | 'manager' | 'supervisor';

export interface User {
  id: string;
  role: UserRole;
  name: string;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  manager: string;
}

export type FieldType = 'text' | 'textarea' | 'select' | 'image' | 'number';

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export interface Template {
  id: string;
  name: string;
  fields: TemplateField[];
  version: string;
  createdAt: string;
}

export type IssueStatus = 'draft' | 'submitted' | 'rejected' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high';

export interface Issue {
  id: string;
  title: string;
  storeId: string;
  templateId: string;
  creatorId: string;
  status: IssueStatus;
  data: Record<string, any>;
  version: number;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
  images?: string[];
  priority?: IssuePriority;
}

export type HistoryAction = 'create' | 'update' | 'submit' | 'reject' | 'close' | 'reopen';

export interface History {
  id: string;
  issueId: string;
  action: HistoryAction;
  operatorId: string;
  operatorRole: UserRole;
  fromStatus?: IssueStatus;
  toStatus?: IssueStatus;
  timestamp: string;
  remark?: string;
}

export interface Conflict {
  id: string;
  issueId: string;
  localVersion: Issue;
  remoteVersion: Issue;
  status: 'pending' | 'resolved';
  detectedAt: string;
  resolution?: 'local' | 'remote' | 'merge';
}

export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'completed';
export type SyncAction = 'create' | 'update' | 'delete';

export interface SyncQueueItem {
  id: string;
  issueId: string;
  action: SyncAction;
  status: SyncStatus;
  retryCount: number;
  lastAttempt?: string;
  errorMessage?: string;
  payload: Issue;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}
