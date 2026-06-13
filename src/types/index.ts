export type UserRole = 'inspector' | 'manager' | 'supervisor';

export interface User {
  id: string;
  role: UserRole;
  name: string;
  storeId?: string;
}

export type PlanSyncStatus = 'draft' | 'pending' | 'syncing' | 'failed' | 'completed';

export type PlanDueStatus = 'normal' | 'due_soon' | 'overdue' | 'delay_requested' | 'delay_approved' | 'delay_rejected';

export interface PlanAttachment {
  id: string;
  name: string;
  type: string;
  size?: number;
  url?: string;
  placeholder?: boolean;
  uploadedAt: string;
  uploaderId: string;
  summary?: string;
}

export interface PlanDelayRecord {
  id: string;
  planId: string;
  issueId: string;
  reason: string;
  newReviewTime: string;
  oldReviewTime: string;
  attachmentSummary: string;
  attachmentIds?: string[];
  requesterId: string;
  requesterRole: UserRole;
  requesterName?: string;
  approverId?: string;
  approverRole?: UserRole;
  approverName?: string;
  approvalRemark?: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface ReviewPlan {
  id: string;
  issueId: string;
  reviewTime: string;
  originalReviewTime?: string;
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
  delayCount: number;
  delayRecords: PlanDelayRecord[];
  pendingDelayRequest?: PlanDelayRecord;
  lastDelayReason?: string;
  lastApproverId?: string;
  lastApproverName?: string;
  dueStatus?: PlanDueStatus;
  hasTimeConflict?: boolean;
  timeConflictInfo?: {
    localReviewTime: string;
    remoteReviewTime: string;
    detectedAt: string;
  };
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
  | 'plan_sync_fail'
  | 'plan_handover_export'
  | 'plan_handover_import'
  | 'plan_handover_import_undo'
  | 'plan_handover_import_batch'
  | 'plan_delay_request'
  | 'plan_delay_approve'
  | 'plan_delay_reject'
  | 'plan_time_conflict_mark'
  | 'plan_time_conflict_resolve';

export interface PlanHistoryDetail {
  field?: string;
  oldValue?: any;
  newValue?: any;
  conflictResolution?: 'local' | 'remote' | 'merge';
  localVersion?: ReviewPlan;
  remoteVersion?: ReviewPlan;
  delayRecord?: PlanDelayRecord;
  timeConflict?: {
    resolution: 'local' | 'remote' | 'merge';
    localReviewTime: string;
    remoteReviewTime: string;
    mergedRemark?: string;
  };
  handoverBatch?: {
    batchId: string;
    strategy: 'keep_local' | 'adopt_import' | 'merge' | 'batch' | 'undo' | 'batch_undo';
    isUndo?: boolean;
  };
  importedPlanIds?: string[];
  undoPlanIds?: string[];
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

export type HandoverPrecheckGroup =
  | 'direct_import'
  | 'needs_merge'
  | 'no_permission'
  | 'issue_not_found'
  | 'version_behind';

export interface HandoverImportBatch {
  id: string;
  sourceHandoverPackage: HandoverPackage;
  precheckResultId: string;
  status: 'prechecking' | 'prechecked' | 'confirming' | 'imported' | 'undoing' | 'undone' | 'failed';
  importedPlanIds: string[];
  undoPlanSnapshots: Array<{ planId: string; snapshot: ReviewPlan }>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByRole: UserRole;
  createdByName?: string;
  importedAt?: string;
  undoneAt?: string;
  undoneBy?: string;
  undoneByRole?: UserRole;
  undoneByName?: string;
  undoRemark?: string;
  strategies: Record<string, 'keep_local' | 'adopt_import' | 'merge'>;
  hasUndo: boolean;
  schemaVersion: string;
}

export interface HandoverImportPrecheckResult {
  id: string;
  batchId: string;
  handoverPackage: HandoverPackage;
  groupedPlans: Record<HandoverPrecheckGroup, Array<HandoverPlanItem & { selectedResolution?: 'keep_local' | 'adopt_import' | 'merge' }>>;
  selectedStrategies: Record<string, 'keep_local' | 'adopt_import' | 'merge'>;
  impactSummary: {
    totalPlans: number;
    directImportCount: number;
    needsMergeCount: number;
    noPermissionCount: number;
    issueNotFoundCount: number;
    versionBehindCount: number;
    newCount: number;
    updateCount: number;
  };
  warnings: string[];
  visibleToUserIds: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByRole: UserRole;
}

export interface HandoverImportUndoRecord {
  id: string;
  batchId: string;
  planId: string;
  beforeImport: ReviewPlan | null;
  afterImport: ReviewPlan;
  restoredAt?: string;
  restoredBy?: string;
}

export interface ExportPayload {
  issues: Issue[];
  stores: Store[];
  templates: Template[];
  migrations: MigrationRecord[];
  unresolvedConflicts: Conflict[];
  reviewPlans: ReviewPlan[];
  unresolvedPlanConflicts: PlanConflict[];
  planDelayRecords?: PlanDelayRecord[];
  handoverImportBatches?: HandoverImportBatch[];
  handoverPrecheckResults?: HandoverImportPrecheckResult[];
  exportedAt: string;
  exportedBy?: {
    id: string;
    role: UserRole;
    name: string;
  };
  schemaVersion: string;
}

export type HandoverConflictType =
  | 'local_exists'
  | 'version_behind'
  | 'assignee_mismatch'
  | 'no_permission'
  | 'issue_not_found';

export interface HandoverPlanItem {
  plan: ReviewPlan;
  conflictTypes: HandoverConflictType[];
  localPlan?: ReviewPlan;
  canImport: boolean;
  reason?: string;
  resolution?: 'keep_local' | 'adopt_import' | 'merge';
  mergedPlan?: ReviewPlan;
  batchId?: string;
  precheckGroup?: HandoverPrecheckGroup;
  selectedResolution?: 'keep_local' | 'adopt_import' | 'merge';
}

export interface HandoverValidationResult {
  valid: boolean;
  issueId: string;
  issueTitle?: string;
  plans: HandoverPlanItem[];
  warnings: string[];
  errors: string[];
  summary: {
    totalPlans: number;
    canImportCount: number;
    conflictCount: number;
    newPlansCount: number;
  };
}

export interface HandoverPackage {
  packageType: 'handover';
  schemaVersion: string;
  issueId: string;
  issueTitle?: string;
  storeId?: string;
  storeName?: string;
  reviewPlans: ReviewPlan[];
  planConflicts: PlanConflict[];
  keyHistories: History[];
  attachmentSummary: Array<{
    planId: string;
    planReviewTime: string;
    attachments: PlanAttachment[];
    note?: string;
  }>;
  syncStatusSummary: Array<{
    planId: string;
    status: PlanSyncStatus;
    lastSyncError?: string;
    lastSyncAttempt?: string;
  }>;
  exportedAt: string;
  exportedBy: {
    id: string;
    role: UserRole;
    name: string;
  };
  handoverImportBatchId?: string;
  hasUndo?: boolean;
}

export type MaterialStatus = 'active' | 'inactive' | 'discontinued';
export type MaterialRecordType = 'borrow' | 'return' | 'loss' | 'restock' | 'adjust';
export type MaterialBorrowStatus = 'draft' | 'pending' | 'borrowed' | 'returned' | 'lost' | 'cancelled';

export interface Material {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  spec?: string;
  description?: string;
  status: MaterialStatus;
  totalStock: number;
  availableStock: number;
  minStock?: number;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export interface MaterialStockBatch {
  id: string;
  materialId: string;
  storeId: string;
  batchNumber: string;
  quantity: number;
  receivedDate: string;
  expiryDate?: string;
  remark?: string;
  createdAt: string;
  synced: boolean;
}

export interface MaterialBorrowForm {
  id: string;
  formNumber: string;
  materialId: string;
  storeId: string;
  quantity: number;
  borrowerId: string;
  borrowerName?: string;
  borrowerRole?: UserRole;
  expectedReturnDate?: string;
  actualReturnDate?: string;
  purpose?: string;
  status: MaterialBorrowStatus;
  handbackCondition?: string;
  lossReason?: string;
  lossQuantity?: number;
  operatorId?: string;
  operatorName?: string;
  operatorRole?: UserRole;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
  lastSyncError?: string;
}

export interface MaterialRecord {
  id: string;
  materialId: string;
  storeId: string;
  formId?: string;
  type: MaterialRecordType;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  operatorId: string;
  operatorName?: string;
  operatorRole?: UserRole;
  relatedUserId?: string;
  relatedUserName?: string;
  batchId?: string;
  remark?: string;
  timestamp: string;
  synced: boolean;
}

export interface MaterialSyncQueueItem {
  id: string;
  entityType: 'material' | 'material_batch' | 'material_borrow' | 'material_record';
  entityId: string;
  action: SyncAction;
  status: SyncStatus;
  retryCount: number;
  lastAttempt?: string;
  errorMessage?: string;
  payload: any;
}

export type MaterialBackupWarningType =
  | 'material_missing_code'
  | 'material_missing_store'
  | 'material_missing_operator'
  | 'material_missing_batch'
  | 'material_invalid_quantity'
  | 'material_missing_abnormal'
  | 'material_unknown_category';

export interface MaterialBackupWarning {
  type: MaterialBackupWarningType;
  materialId?: string;
  materialCode?: string;
  materialName?: string;
  formId?: string;
  message: string;
  missingFields?: string[];
  appliedDefaults?: Record<string, any>;
}

export interface MaterialImportValidationResult {
  valid: boolean;
  warnings: MaterialBackupWarning[];
  errors: string[];
  materialsToImport: Material[];
  batchesToImport: MaterialStockBatch[];
  borrowFormsToImport: MaterialBorrowForm[];
  recordsToImport: MaterialRecord[];
}

export interface MaterialExportPayload {
  materials: Material[];
  materialBatches: MaterialStockBatch[];
  materialBorrowForms: MaterialBorrowForm[];
  materialRecords: MaterialRecord[];
  materialSyncQueue: MaterialSyncQueueItem[];
  exportedAt: string;
  exportedBy?: {
    id: string;
    role: UserRole;
    name: string;
  };
  schemaVersion: string;
}

export type PatrolCheckpointStatus = 'active' | 'inactive';

export interface PatrolCheckpoint {
  id: string;
  routeId: string;
  name: string;
  order: number;
  storeId: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  status: PatrolCheckpointStatus;
  createdAt: string;
  updatedAt: string;
}

export type PatrolRouteStatus = 'active' | 'inactive';

export interface PatrolRoute {
  id: string;
  name: string;
  version: number;
  status: PatrolRouteStatus;
  checkpoints: PatrolCheckpoint[];
  creatorId: string;
  creatorName?: string;
  creatorRole?: UserRole;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export type CheckInStatus = 'draft' | 'submitted' | 'exception';
export type CheckInSyncStatus = 'pending' | 'syncing' | 'failed' | 'completed';

export interface CheckInException {
  type: 'out_of_window' | 'cross_store' | 'version_mismatch' | 'other';
  description: string;
}

export interface CheckIn {
  id: string;
  routeId: string;
  routeVersion: number;
  checkpointId: string;
  storeId: string;
  inspectorId: string;
  inspectorName?: string;
  status: CheckInStatus;
  checkInTime: string;
  exception?: CheckInException;
  remark?: string;
  syncStatus: CheckInSyncStatus;
  lastSyncError?: string;
  lastSyncAttempt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatrolSyncQueueItem {
  id: string;
  entityType: 'patrol_route' | 'check_in';
  entityId: string;
  action: SyncAction;
  status: SyncStatus;
  retryCount: number;
  lastAttempt?: string;
  errorMessage?: string;
  payload: any;
}

export type PatrolBackupWarningType =
  | 'patrol_missing_route_name'
  | 'patrol_missing_checkpoint_name'
  | 'patrol_missing_inspector'
  | 'patrol_missing_time_window'
  | 'patrol_invalid_route_version'
  | 'patrol_unknown_checkpoint_status'
  | 'patrol_checkin_missing_route';

export interface PatrolBackupWarning {
  type: PatrolBackupWarningType;
  routeId?: string;
  routeName?: string;
  checkInId?: string;
  checkpointId?: string;
  message: string;
  missingFields?: string[];
  appliedDefaults?: Record<string, any>;
}

export interface PatrolImportValidationResult {
  valid: boolean;
  warnings: PatrolBackupWarning[];
  errors: string[];
  routesToImport: PatrolRoute[];
  checkInsToImport: CheckIn[];
}

export interface PatrolExportPayload {
  patrolRoutes: PatrolRoute[];
  checkIns: CheckIn[];
  patrolSyncQueue: PatrolSyncQueueItem[];
  exportedAt: string;
  exportedBy?: {
    id: string;
    role: UserRole;
    name: string;
  };
  schemaVersion: string;
}
