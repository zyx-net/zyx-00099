export type UserRole = 'inspector' | 'manager' | 'supervisor';

export interface User {
  id: string;
  role: UserRole;
  name: string;
  storeId?: string;
}

export type PlanSyncStatus = 'draft' | 'pending' | 'syncing' | 'failed' | 'completed';

export interface PlanAttachment {
  id: string;
  name: string;
  type: string;
  size?: number;
  url?: string;
  placeholder?: boolean;
  uploadedAt: string;
  uploaderId: string;
}

export interface ReviewPlan {
  id: string;
  issueId: string;
  reviewTime: string;
  assigneeId: string;
  assigneeName?: string;
  assigneeRole?: UserRole;
  rectificationNote: string;
  attachments: PlanAttachment[];
  creatorId: string;
  creatorRole: UserRole;
  version: number;
  status: PlanSyncStatus;
  synced: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncError?: string;
  lastSyncAttempt?: string;
}

export interface PlanConflict {
  id: string;
  planId: string;
  issueId: string;
  localPlan: ReviewPlan;
  remotePlan: ReviewPlan;
  status: 'pending' | 'resolved';
  detectedAt: string;
  resolution?: 'local' | 'remote' | 'merge';
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedByRole?: UserRole;
}

export type PlanHistoryAction =
  | 'plan_create'
  | 'plan_update'
  | 'plan_delete'
  | 'plan_conflict_resolve'
  | 'plan_sync'
  | 'plan_sync_fail';

export interface PlanHistoryDetail {
  field?: string;
  oldValue?: any;
  newValue?: any;
  conflictResolution?: 'local' | 'remote' | 'merge';
  localVersion?: ReviewPlan;
  remoteVersion?: ReviewPlan;
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

export type FieldChangeType = 'added' | 'removed' | 'renamed' | 'modified' | 'unchanged';

export interface FieldDiff {
  key: string;
  changeType: FieldChangeType;
  oldLabel?: string;
  newLabel?: string;
  oldType?: FieldType;
  newType?: FieldType;
  oldRequired?: boolean;
  newRequired?: boolean;
  oldOptions?: string[];
  newOptions?: string[];
  renamedFrom?: string;
  renamedTo?: string;
}

export interface TemplateDiff {
  templateId: string;
  oldVersion: string;
  newVersion: string;
  fieldDiffs: FieldDiff[];
  addedFields: string[];
  removedFields: string[];
  modifiedFields: string[];
  renamedFields: Array<{ from: string; to: string }>;
  impactSummary: {
    draftCountAffected: number;
    pendingSyncCountAffected: number;
    hasBreakingChanges: boolean;
  };
}

export type MigrationOption = 'keep_old' | 'migrate' | 'new_only';

export interface FieldMapping {
  fromKey: string;
  toKey: string;
}

export interface MigrationRecord {
  id: string;
  templateId: string;
  fromVersion: string;
  toVersion: string;
  option: MigrationOption;
  fieldMappings: FieldMapping[];
  migratedIssueIds: string[];
  keptOldIssueIds: string[];
  operatorId: string;
  operatorRole: UserRole;
  createdAt: string;
  remark?: string;
}

export interface Template {
  id: string;
  name: string;
  fields: TemplateField[];
  version: string;
  createdAt: string;
  deprecated?: boolean;
  supersededBy?: string;
  parentId?: string;
}

export type IssueStatus = 'draft' | 'submitted' | 'rejected' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high';

export interface Issue {
  id: string;
  title: string;
  storeId: string;
  templateId: string;
  templateVersion: string;
  creatorId: string;
  status: IssueStatus;
  data: Record<string, any>;
  version: number;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
  images?: string[];
  priority?: IssuePriority;
  migrationSource?: {
    fromTemplateVersion: string;
    migrationId: string;
    migratedAt: string;
  };
}

export type HistoryAction =
  | 'create'
  | 'update'
  | 'submit'
  | 'reject'
  | 'close'
  | 'reopen'
  | 'migrate'
  | PlanHistoryAction;

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
  templateVersion?: string;
  migrationInfo?: {
    fromVersion: string;
    toVersion: string;
    migrationId: string;
  };
  planId?: string;
  planDetail?: PlanHistoryDetail;
}

export interface Conflict {
  id: string;
  issueId: string;
  localVersion: Issue;
  remoteVersion: Issue;
  status: 'pending' | 'resolved';
  detectedAt: string;
  resolution?: 'local' | 'remote' | 'merge';
  templateVersionConflict?: {
    localTemplateVersion: string;
    remoteTemplateVersion: string;
    diff?: TemplateDiff;
  };
}

export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'completed';
export type SyncAction = 'create' | 'update' | 'delete';
export type SyncEntityType = 'issue' | 'review_plan';

export interface SyncQueueItem {
  id: string;
  issueId: string;
  action: SyncAction;
  status: SyncStatus;
  retryCount: number;
  lastAttempt?: string;
  errorMessage?: string;
  payload: Issue;
  templateVersionAtSync?: string;
  entityType?: SyncEntityType;
  planPayload?: ReviewPlan;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export type ImportWarningType =
  | 'same_name_different_version'
  | 'duplicate_version'
  | 'missing_fields'
  | 'template_upgrade_available'
  | 'permission_denied'
  | 'duplicate_plan'
  | 'plan_missing_assignee'
  | 'plan_no_permission'
  | 'plan_attachment_placeholder';

export interface ImportWarning {
  type: ImportWarningType;
  templateId?: string;
  templateName?: string;
  existingVersion?: string;
  importVersion?: string;
  message: string;
  missingFields?: string[];
  planId?: string;
  issueId?: string;
}

export interface ImportValidationResult {
  valid: boolean;
  warnings: ImportWarning[];
  errors: string[];
  templatesToImport: Template[];
  templatesToUpgrade: Array<{ existing: Template; incoming: Template }>;
}

export interface ExportPayload {
  issues: Issue[];
  stores: Store[];
  templates: Template[];
  migrations: MigrationRecord[];
  unresolvedConflicts: Conflict[];
  reviewPlans: ReviewPlan[];
  unresolvedPlanConflicts: PlanConflict[];
  exportedAt: string;
  exportedBy?: {
    id: string;
    role: UserRole;
    name: string;
  };
  schemaVersion: string;
}
