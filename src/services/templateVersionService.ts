import {
  Template,
  TemplateField,
  TemplateDiff,
  FieldDiff,
  FieldChangeType,
  Issue,
  MigrationOption,
  FieldMapping,
  MigrationRecord,
  ImportValidationResult,
  ImportWarning,
  ImportWarningType,
  ExportPayload,
  Conflict,
  Store,
  User,
  UserRole,
  ReviewPlan,
  PlanConflict,
  PlanDelayRecord,
  PlanDueStatus,
  HandoverImportBatch,
  HandoverImportPrecheckResult,
} from '@/types';
import { generateId, normalizeReviewPlanDefaults, DUE_STATUS_LABELS } from '@/utils/helpers';
import { normalizeHandoverBatchDefaults, normalizeHandoverPrecheckResultDefaults } from './syncService';

export function compareSemanticVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

export function isNewerVersion(newVer: string, oldVer: string): boolean {
  return compareSemanticVersions(newVer, oldVer) > 0;
}

export function diffTemplateFields(
  oldFields: TemplateField[],
  newFields: TemplateField[]
): FieldDiff[] {
  const oldMap = new Map(oldFields.map(f => [f.key, f]));
  const newMap = new Map(newFields.map(f => [f.key, f]));
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);

  const oldLabels = new Map(oldFields.map(f => [f.label, f.key]));
  const newLabels = new Map(newFields.map(f => [f.label, f.key]));

  for (const key of allKeys) {
    const oldField = oldMap.get(key);
    const newField = newMap.get(key);

    if (oldField && !newField) {
      const matchingNewByLabel = newFields.find(
        nf => nf.label === oldField.label && !oldMap.has(nf.key)
      );
      if (matchingNewByLabel) {
        diffs.push({
          key: matchingNewByLabel.key,
          changeType: 'renamed',
          oldLabel: oldField.label,
          newLabel: matchingNewByLabel.label,
          oldType: oldField.type,
          newType: matchingNewByLabel.type,
          oldRequired: oldField.required,
          newRequired: matchingNewByLabel.required,
          oldOptions: oldField.options,
          newOptions: matchingNewByLabel.options,
          renamedFrom: key,
          renamedTo: matchingNewByLabel.key,
        });
      } else {
        diffs.push({
          key,
          changeType: 'removed',
          oldLabel: oldField.label,
          oldType: oldField.type,
          oldRequired: oldField.required,
          oldOptions: oldField.options,
        });
      }
    } else if (!oldField && newField) {
      const matchingOldByLabel = oldFields.find(
        of => of.label === newField.label && !newMap.has(of.key)
      );
      if (!matchingOldByLabel) {
        diffs.push({
          key,
          changeType: 'added',
          newLabel: newField.label,
          newType: newField.type,
          newRequired: newField.required,
          newOptions: newField.options,
        });
      }
    } else if (oldField && newField) {
      const hasTypeChange = oldField.type !== newField.type;
      const hasRequiredChange = oldField.required !== newField.required;
      const hasLabelChange = oldField.label !== newField.label;
      const hasOptionsChange =
        JSON.stringify(oldField.options ?? []) !== JSON.stringify(newField.options ?? []);

      if (hasTypeChange || hasRequiredChange || hasLabelChange || hasOptionsChange) {
        diffs.push({
          key,
          changeType: 'modified',
          oldLabel: oldField.label,
          newLabel: newField.label,
          oldType: oldField.type,
          newType: newField.type,
          oldRequired: oldField.required,
          newRequired: newField.required,
          oldOptions: oldField.options,
          newOptions: newField.options,
        });
      } else {
        diffs.push({
          key,
          changeType: 'unchanged',
          oldLabel: oldField.label,
          newLabel: newField.label,
          oldType: oldField.type,
          newType: newField.type,
        });
      }
    }
  }

  return diffs;
}

export function diffTemplateVersions(
  oldTemplate: Template,
  newTemplate: Template,
  affectedIssues: Issue[] = []
): TemplateDiff {
  const fieldDiffs = diffTemplateFields(oldTemplate.fields, newTemplate.fields);

  const addedFields = fieldDiffs.filter(d => d.changeType === 'added').map(d => d.key);
  const removedFields = fieldDiffs.filter(d => d.changeType === 'removed').map(d => d.key);
  const modifiedFields = fieldDiffs.filter(d => d.changeType === 'modified').map(d => d.key);
  const renamedFields = fieldDiffs
    .filter(d => d.changeType === 'renamed' && d.renamedFrom && d.renamedTo)
    .map(d => ({ from: d.renamedFrom!, to: d.renamedTo! }));

  const draftCountAffected = affectedIssues.filter(i => i.status === 'draft').length;
  const pendingSyncCountAffected = affectedIssues.filter(i => !i.synced).length;
  const hasBreakingChanges =
    removedFields.length > 0 ||
    modifiedFields.some(key => {
      const diff = fieldDiffs.find(d => d.key === key);
      return diff?.oldType !== diff?.newType;
    });

  return {
    templateId: oldTemplate.id,
    oldVersion: oldTemplate.version,
    newVersion: newTemplate.version,
    fieldDiffs,
    addedFields,
    removedFields,
    modifiedFields,
    renamedFields,
    impactSummary: {
      draftCountAffected,
      pendingSyncCountAffected,
      hasBreakingChanges,
    },
  };
}

export function buildMigrationMappingsFromDiff(diff: TemplateDiff): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  for (const d of diff.fieldDiffs) {
    if (d.changeType === 'unchanged' || d.changeType === 'modified') {
      mappings.push({ fromKey: d.key, toKey: d.key });
    } else if (d.changeType === 'renamed' && d.renamedFrom && d.renamedTo) {
      mappings.push({ fromKey: d.renamedFrom, toKey: d.renamedTo });
    }
  }

  return mappings;
}

export function migrateIssueData(
  oldData: Record<string, any>,
  mappings: FieldMapping[],
  newTemplate: Template,
  options: { fillDefaults?: boolean } = {}
): Record<string, any> {
  const newData: Record<string, any> = {};
  const mappingMap = new Map(mappings.map(m => [m.fromKey, m.toKey]));

  for (const [oldKey, value] of Object.entries(oldData)) {
    const newKey = mappingMap.get(oldKey);
    if (newKey) {
      newData[newKey] = value;
    }
  }

  if (options.fillDefaults) {
    for (const field of newTemplate.fields) {
      if (!(field.key in newData)) {
        if (field.type === 'select' && field.options && field.options.length > 0) {
          newData[field.key] = field.options[0];
        } else if (field.type === 'number') {
          newData[field.key] = 0;
        } else {
          newData[field.key] = '';
        }
      }
    }
  }

  return newData;
}

export function applyTemplateUpgrade(
  issues: Issue[],
  oldTemplate: Template,
  newTemplate: Template,
  diff: TemplateDiff,
  option: MigrationOption,
  customMappings?: FieldMapping[]
): {
  migratedIssues: Issue[];
  keptIssues: Issue[];
  migrationRecord: Omit<MigrationRecord, 'id' | 'operatorId' | 'operatorRole' | 'createdAt'>;
  histories: Array<Omit<import('@/types').History, 'id' | 'timestamp'>>;
} {
  const mappings = customMappings ?? buildMigrationMappingsFromDiff(diff);
  const now = new Date().toISOString();
  const migrationId = generateId();

  const affectedIssues = issues.filter(
    i => i.templateId === oldTemplate.id && i.templateVersion === oldTemplate.version
  );

  const migratedIssues: Issue[] = [];
  const keptIssues: Issue[] = [];
  const histories: Array<Omit<import('@/types').History, 'id' | 'timestamp'>> = [];

  if (option === 'keep_old') {
    for (const issue of affectedIssues) {
      keptIssues.push({ ...issue });
    }
  } else if (option === 'migrate') {
    for (const issue of affectedIssues) {
      const migratedData = migrateIssueData(issue.data, mappings, newTemplate, {
        fillDefaults: true,
      });
      migratedIssues.push({
        ...issue,
        data: migratedData,
        templateVersion: newTemplate.version,
        version: issue.version + 1,
        updatedAt: now,
        synced: false,
        migrationSource: {
          fromTemplateVersion: oldTemplate.version,
          migrationId,
          migratedAt: now,
        },
      });
      histories.push({
        issueId: issue.id,
        action: 'migrate',
        operatorId: 'system',
        operatorRole: 'supervisor',
        templateVersion: newTemplate.version,
        migrationInfo: {
          fromVersion: oldTemplate.version,
          toVersion: newTemplate.version,
          migrationId,
        },
        remark: `模板版本从 v${oldTemplate.version} 迁移到 v${newTemplate.version}`,
      });
    }
  } else if (option === 'new_only') {
    for (const issue of affectedIssues) {
      if (issue.status === 'draft') {
        keptIssues.push({ ...issue });
      } else {
        const migratedData = migrateIssueData(issue.data, mappings, newTemplate, {
          fillDefaults: true,
        });
        migratedIssues.push({
          ...issue,
          data: migratedData,
          templateVersion: newTemplate.version,
          version: issue.version + 1,
          updatedAt: now,
          synced: false,
          migrationSource: {
            fromTemplateVersion: oldTemplate.version,
            migrationId,
            migratedAt: now,
          },
        });
        histories.push({
          issueId: issue.id,
          action: 'migrate',
          operatorId: 'system',
          operatorRole: 'supervisor',
          templateVersion: newTemplate.version,
          migrationInfo: {
            fromVersion: oldTemplate.version,
            toVersion: newTemplate.version,
            migrationId,
          },
          remark: `已提交/已关闭问题模板版本从 v${oldTemplate.version} 迁移到 v${newTemplate.version}，草稿保留旧版本`,
        });
      }
    }
  }

  return {
    migratedIssues,
    keptIssues,
    migrationRecord: {
      templateId: oldTemplate.id,
      fromVersion: oldTemplate.version,
      toVersion: newTemplate.version,
      option,
      fieldMappings: mappings,
      migratedIssueIds: migratedIssues.map(i => i.id),
      keptOldIssueIds: keptIssues.map(i => i.id),
    },
    histories,
  };
}

export function validateTemplateImport(
  incomingTemplates: Template[],
  existingTemplates: Template[],
  userRole: UserRole
): ImportValidationResult {
  const warnings: ImportWarning[] = [];
  const errors: string[] = [];
  const templatesToImport: Template[] = [];
  const templatesToUpgrade: Array<{ existing: Template; incoming: Template }> = [];

  if (userRole !== 'supervisor') {
    warnings.push({
      type: 'permission_denied',
      message: '当前用户无权限导入或升级模板，仅督导可操作。模板导入将被跳过。',
    });
    return {
      valid: false,
      warnings,
      errors: ['权限不足：仅督导可导入模板'],
      templatesToImport: [],
      templatesToUpgrade: [],
    };
  }

  const existingByName = new Map<string, Template[]>();
  for (const tpl of existingTemplates) {
    const list = existingByName.get(tpl.name) ?? [];
    list.push(tpl);
    existingByName.set(tpl.name, list);
  }

  const existingById = new Map(existingTemplates.map(t => [t.id, t]));

  for (const incoming of incomingTemplates) {
    if (!incoming.id || !incoming.name || !Array.isArray(incoming.fields)) {
      errors.push(`模板数据格式错误：${JSON.stringify(incoming).slice(0, 80)}`);
      continue;
    }

    const requiredFieldKeys = new Set(['key', 'label', 'type', 'required']);
    const missingFields: string[] = [];
    for (const field of incoming.fields) {
      for (const req of requiredFieldKeys) {
        if (!(req in field)) {
          missingFields.push(`${field.key ?? field.label ?? 'unknown'}.${req}`);
        }
      }
    }
    if (missingFields.length > 0) {
      warnings.push({
        type: 'missing_fields',
        templateId: incoming.id,
        templateName: incoming.name,
        missingFields,
        message: `模板「${incoming.name}」部分字段缺失属性: ${missingFields.join(', ')}`,
      });
    }

    const existingSameId = existingById.get(incoming.id);
    if (existingSameId) {
      if (existingSameId.version === incoming.version) {
        warnings.push({
          type: 'duplicate_version',
          templateId: incoming.id,
          templateName: incoming.name,
          existingVersion: existingSameId.version,
          importVersion: incoming.version,
          message: `模板「${incoming.name}」ID=${incoming.id} 已存在相同版本 v${incoming.version}，将被跳过。`,
        });
      } else if (isNewerVersion(incoming.version, existingSameId.version)) {
        templatesToUpgrade.push({ existing: existingSameId, incoming });
        warnings.push({
          type: 'template_upgrade_available',
          templateId: incoming.id,
          templateName: incoming.name,
          existingVersion: existingSameId.version,
          importVersion: incoming.version,
          message: `检测到模板「${incoming.name}」新版本 v${incoming.version}（当前 v${existingSameId.version}），请确认升级策略。`,
        });
      } else {
        warnings.push({
          type: 'duplicate_version',
          templateId: incoming.id,
          templateName: incoming.name,
          existingVersion: existingSameId.version,
          importVersion: incoming.version,
          message: `模板「${incoming.name}」导入版本 v${incoming.version} 不高于现有版本 v${existingSameId.version}，将被跳过。`,
        });
      }
      continue;
    }

    const sameNameList = existingByName.get(incoming.name) ?? [];
    if (sameNameList.length > 0) {
      const newestExisting = sameNameList.reduce((a, b) =>
        isNewerVersion(a.version, b.version) ? a : b
      );
      warnings.push({
        type: 'same_name_different_version',
        templateId: incoming.id,
        templateName: incoming.name,
        existingVersion: newestExisting.version,
        importVersion: incoming.version,
        message: `已存在同名模板「${incoming.name}」v${newestExisting.version}，本次导入为新 ID=${incoming.id} v${incoming.version}，将作为独立模板并存。`,
      });
    }

    templatesToImport.push(incoming);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    templatesToImport,
    templatesToUpgrade,
  };
}

export function buildExportPayload(
  issues: Issue[],
  stores: Store[],
  templates: Template[],
  migrations: MigrationRecord[],
  unresolvedConflicts: Conflict[],
  currentUser?: User,
  reviewPlans: ReviewPlan[] = [],
  unresolvedPlanConflicts: PlanConflict[] = [],
  planDelayRecords: PlanDelayRecord[] = [],
  handoverImportBatches: HandoverImportBatch[] = [],
  handoverPrecheckResults: HandoverImportPrecheckResult[] = []
): ExportPayload {
  const plansByDelay = new Map<string, PlanDelayRecord[]>();
  for (const rec of planDelayRecords) {
    const arr = plansByDelay.get(rec.planId) || [];
    arr.push(rec);
    plansByDelay.set(rec.planId, arr);
  }
  const normalizedPlans = reviewPlans.map(plan => {
    const base = normalizeReviewPlanDefaults(plan as any);
    const delayRecs = plansByDelay.get(plan.id) || base.delayRecords || [];
    const pending = delayRecs.find(r => r.status === 'pending');
    const approvedLast = [...delayRecs].filter(r => r.status === 'approved').sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    )[0];
    return {
      ...base,
      delayRecords: delayRecs,
      pendingDelayRequest: pending,
      delayCount: delayRecs.filter(r => r.status === 'approved').length,
      lastDelayReason: approvedLast?.reason || base.lastDelayReason,
      lastApproverId: approvedLast?.approverId || base.lastApproverId,
      lastApproverName: approvedLast?.approverName || base.lastApproverName,
      attachments: (base.attachments || []).map(att => ({
        ...att,
        url: undefined,
        placeholder: true,
      })),
    };
  });
  return {
    issues,
    stores,
    templates,
    migrations,
    unresolvedConflicts,
    reviewPlans: normalizedPlans,
    unresolvedPlanConflicts,
    planDelayRecords,
    handoverImportBatches,
    handoverPrecheckResults,
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser
      ? { id: currentUser.id, role: currentUser.role, name: currentUser.name }
      : undefined,
    schemaVersion: '5.0',
  };
}

export function parseExportPayload(raw: any): {
  valid: boolean;
  payload?: ExportPayload;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, warnings, errors: ['导入文件不是有效的 JSON 对象'] };
  }

  const declaredVer: string = (raw.schemaVersion as string) || '1.0';
  if (declaredVer !== '5.0') {
    warnings.push(
      `📦 备份 schema 版本为 v${declaredVer}，当前支持 v5.0。已自动为缺失字段补充默认值，旧数据不会报废。`
    );
    if (['1.0', '2.0'].includes(declaredVer)) {
      warnings.push(`  · 注意 v${declaredVer} 备份可能不包含「复查整改计划」，对应部分将为空。`);
    }
    if (['1.0', '2.0', '3.0'].includes(declaredVer)) {
      warnings.push(`  · 旧版本未包含「到期状态/延期记录/时间冲突」等字段，已补默认值（到期状态=normal、延期次数=0等）。`);
    }
    if (['1.0', '2.0', '3.0', '4.0'].includes(declaredVer)) {
      warnings.push(`  · 旧版本未包含「交接包导入批次/预检结果/撤销标记」等字段，已补默认值。`);
    }
  }

  if (!Array.isArray(raw.issues)) errors.push('缺少 issues 数组');
  if (!Array.isArray(raw.stores)) errors.push('缺少 stores 数组');
  if (!Array.isArray(raw.templates)) errors.push('缺少 templates 数组');

  if (!raw.migrations) warnings.push('导入文件不包含迁移记录，已用空数组代替。');
  if (!raw.unresolvedConflicts) warnings.push('导入文件不包含未解决冲突记录，已用空数组代替。');
  if (!raw.reviewPlans) warnings.push('导入文件不包含复查整改计划，已用空数组代替。');
  if (!raw.unresolvedPlanConflicts) warnings.push('导入文件不包含复查计划冲突记录，已用空数组代替。');
  if (!raw.planDelayRecords) warnings.push('导入文件不包含延期申请记录，已用空数组代替。');
  if (!raw.handoverImportBatches) warnings.push('导入文件不包含交接包导入批次记录，已用空数组代替。');
  if (!raw.handoverPrecheckResults) warnings.push('导入文件不包含交接包预检记录，已用空数组代替。');

  if (errors.length > 0) {
    return { valid: false, warnings, errors };
  }

  const payload = raw as ExportPayload;

  if (!payload.migrations) payload.migrations = [];
  if (!payload.unresolvedConflicts) payload.unresolvedConflicts = [];
  if (!payload.reviewPlans) payload.reviewPlans = [];
  if (!payload.unresolvedPlanConflicts) payload.unresolvedPlanConflicts = [];
  (payload as any).planDelayRecords = (payload as any).planDelayRecords || [];
  (payload as any).handoverImportBatches = (payload as any).handoverImportBatches || [];
  (payload as any).handoverPrecheckResults = (payload as any).handoverPrecheckResults || [];

  for (const issue of payload.issues) {
    if (!issue.templateVersion) {
      issue.templateVersion = '1.0';
      warnings.push(`问题「${issue.title || issue.id}」缺少 templateVersion，已默认补为 v1.0`);
    }
  }

  const planDelayByPlan = new Map<string, PlanDelayRecord[]>();
  for (const rec of ((payload as any).planDelayRecords || [])) {
    const arr = planDelayByPlan.get(rec.planId) || [];
    arr.push(rec);
    planDelayByPlan.set(rec.planId, arr);
  }

  const normalizedReviewPlans: ReviewPlan[] = [];
  for (let i = 0; i < payload.reviewPlans.length; i++) {
    const plan = payload.reviewPlans[i];
    const before = JSON.stringify(plan);
    const planDelayRecords = planDelayByPlan.get(plan.id) || (plan as any).delayRecords || [];
    const normalized = normalizeReviewPlanDefaults(plan as any);

    normalized.delayRecords = planDelayRecords;
    if (planDelayRecords.length > 0) {
      normalized.pendingDelayRequest = planDelayRecords.find((r: PlanDelayRecord) => r.status === 'pending');
      normalized.delayCount = planDelayRecords.filter((r: PlanDelayRecord) => r.status === 'approved').length;
      const lastApproved = [...planDelayRecords]
        .filter((r: PlanDelayRecord) => r.status === 'approved')
        .sort((a: any, b: any) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())[0];
      if (lastApproved) {
        normalized.lastDelayReason = normalized.lastDelayReason || (lastApproved as PlanDelayRecord).reason;
        normalized.lastApproverId = normalized.lastApproverId || (lastApproved as PlanDelayRecord).approverId;
        normalized.lastApproverName = normalized.lastApproverName || (lastApproved as PlanDelayRecord).approverName;
      }
    }
    normalizedReviewPlans.push(normalized);

    const after = JSON.stringify(normalized);
    if (before.length !== after.length || !(plan as any).dueStatus) {
      if (i < 3) {
        warnings.push(`复查计划 ${plan.id.slice(0, 12)}… 已补齐默认字段（到期状态：${DUE_STATUS_LABELS[normalized.dueStatus]}，延期次数：${normalized.delayCount}）`);
      } else if (i === 3) {
        warnings.push(`… 其余 ${payload.reviewPlans.length - 3} 个复查计划同样已补齐默认字段。`);
      }
    }
  }
  payload.reviewPlans = normalizedReviewPlans;

  for (const plan of payload.reviewPlans) {
    if (!plan.assigneeId) {
      warnings.push(`复查计划 ${plan.id} 缺少责任人，导入后需手动补全。`);
    }
    if ((plan.attachments || []).some((a: any) => a.placeholder)) {
      warnings.push(`复查计划 ${plan.id} 包含占位附件，需重新上传。`);
    }
  }

  const rawBatches = (payload as any).handoverImportBatches || [];
  if (rawBatches.length > 0) {
    const normalizedBatches: HandoverImportBatch[] = [];
    for (let i = 0; i < rawBatches.length; i++) {
      const batch = rawBatches[i];
      const before = JSON.stringify(batch);
      const normalized = normalizeHandoverBatchDefaults(batch);
      normalizedBatches.push(normalized);
      if (i < 2 && before !== JSON.stringify(normalized)) {
        warnings.push(`交接包批次 ${batch.id.slice(0, 12)}… 已补齐默认字段`);
      }
    }
    (payload as any).handoverImportBatches = normalizedBatches;
    if (rawBatches.length > 2) {
      warnings.push(`… 其余 ${rawBatches.length - 2} 个交接包批次同样已补齐默认字段。`);
    }
  }

  const rawPrechecks = (payload as any).handoverPrecheckResults || [];
  if (rawPrechecks.length > 0) {
    const normalizedPrechecks: HandoverImportPrecheckResult[] = [];
    for (let i = 0; i < rawPrechecks.length; i++) {
      const pc = rawPrechecks[i];
      const before = JSON.stringify(pc);
      const normalized = normalizeHandoverPrecheckResultDefaults(pc);
      normalizedPrechecks.push(normalized);
      if (i < 2 && before !== JSON.stringify(normalized)) {
        warnings.push(`交接包预检 ${pc.id.slice(0, 12)}… 已补齐默认字段`);
      }
    }
    (payload as any).handoverPrecheckResults = normalizedPrechecks;
    if (rawPrechecks.length > 2) {
      warnings.push(`… 其余 ${rawPrechecks.length - 2} 个交接包预检记录同样已补齐默认字段。`);
    }
  }

  return { valid: true, payload, warnings, errors };
}

export function generateCSVWithVersions(
  issues: Issue[],
  stores: { id: string; name: string }[],
  templates: Template[],
  migrations: MigrationRecord[],
  reviewPlans: ReviewPlan[] = []
): string {
  const storeMap = new Map(stores.map(s => [s.id, s.name]));
  const templateMap = new Map(templates.map(t => [t.id, t]));
  const migrationMap = new Map(migrations.map(m => [m.id, m]));
  const plansByIssue = new Map<string, ReviewPlan[]>();
  for (const plan of reviewPlans) {
    const list = plansByIssue.get(plan.issueId) || [];
    list.push(plan);
    plansByIssue.set(plan.issueId, list);
  }

  const headers = [
    '问题编号',
    '标题',
    '门店',
    '模板名称',
    '模板版本',
    '状态',
    '优先级',
    '创建时间',
    '更新时间',
    '是否同步',
    '数据版本号',
    '是否迁移过',
    '迁移来源版本',
    '迁移ID',
    '复查计划数量',
    '复查计划ID',
    '复查计划版本',
    '复查时间',
    '复查责任人',
    '复查责任人角色',
    '复查计划状态',
    '复查计划是否同步',
    '复查计划创建人',
    '复查计划附件数',
    '复查计划整改备注',
    '复查计划摘要',
    '复查计划冲突数',
    '附件占位信息',
    '到期状态',
    '延期次数',
    '最后延期原因',
    '审批人',
  ];

  const rows = issues.map(issue => {
    const tpl = templateMap.get(issue.templateId);
    const migration = issue.migrationSource
      ? migrationMap.get(issue.migrationSource.migrationId)
      : undefined;
    const plans = plansByIssue.get(issue.id) || [];
    const planSummary = plans.map(p =>
      `[${p.assigneeName || p.assigneeId}|${p.reviewTime}|${p.status}]`
    ).join('; ');
    const attachmentPlaceholder = plans.some(p =>
      (p.attachments || []).some(a => a.placeholder)
    ) ? '含占位附件，需重新上传' : '';
    
    const planIds = plans.map(p => p.id).join('; ');
    const planVersions = plans.map(p => `v${p.version}`).join('; ');
    const planReviewTimes = plans.map(p => p.reviewTime).join('; ');
    const planAssignees = plans.map(p => p.assigneeName || p.assigneeId).join('; ');
    const planAssigneeRoles = plans.map(p => p.assigneeRole || '').join('; ');
    const planStatuses = plans.map(p => p.status).join('; ');
    const planSynced = plans.map(p => p.synced ? '是' : '否').join('; ');
    const planCreators = plans.map(p => p.creatorId).join('; ');
    const planAttachmentCounts = plans.map(p => (p.attachments || []).length).join('; ');
    const planNotes = plans.map(p => (p.rectificationNote || '').replace(/"/g, "'").replace(/\n/g, ' ')).join(' | ');

    const planDueStatuses = plans.map(p =>
      DUE_STATUS_LABELS[p.dueStatus as PlanDueStatus] || '正常'
    ).join('; ');
    const planDelayCounts = plans.map(p => String(p.delayCount || 0)).join('; ');
    const planLastDelayReasons = plans.map(p =>
      (p.lastDelayReason || '').replace(/"/g, "'").replace(/\n/g, ' ')
    ).join(' | ');
    const planApprovers = plans.map(p =>
      p.lastApproverName || p.lastApproverId || ''
    ).join('; ');
    
    return [
      issue.id,
      issue.title,
      storeMap.get(issue.storeId) || issue.storeId,
      tpl?.name || issue.templateId,
      issue.templateVersion || '1.0',
      issue.status,
      issue.priority || 'medium',
      issue.createdAt,
      issue.updatedAt,
      issue.synced ? '是' : '否',
      issue.version,
      issue.migrationSource ? '是' : '否',
      issue.migrationSource?.fromTemplateVersion || '',
      issue.migrationSource?.migrationId || '',
      plans.length,
      planIds,
      planVersions,
      planReviewTimes,
      planAssignees,
      planAssigneeRoles,
      planStatuses,
      planSynced,
      planCreators,
      planAttachmentCounts,
      planNotes,
      planSummary,
      0,
      attachmentPlaceholder,
      planDueStatuses,
      planDelayCounts,
      planLastDelayReasons,
      planApprovers,
    ];
  });

  return [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
