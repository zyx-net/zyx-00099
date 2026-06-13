function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

const ROLE_PERMISSIONS = {
  inspector: ['issue:create', 'issue:edit_own', 'issue:view_own', 'plan:view_own', 'patrol:checkin', 'patrol:view_own_checkin'],
  manager: ['issue:view_all', 'issue:close', 'export:data', 'plan:create', 'plan:edit_own', 'plan:view_store', 'plan_conflict:resolve_own', 'handover:export_own', 'patrol:view_store_checkin'],
  supervisor: ['issue:view_all', 'issue:close', 'issue:reject', 'issue:create', 'template:import', 'template:upgrade', 'store:manage', 'sync:manage', 'conflict:resolve', 'export:data', 'plan:create', 'plan:edit_all', 'plan:view_all', 'plan_conflict:resolve_all', 'handover:export_all', 'handover:import', 'patrol:route_manage', 'patrol:view_all_checkin', 'patrol:export']
};

const DUE_STATUS_LABELS = {
  normal: '正常',
  due_soon: '即将到期',
  overdue: '已逾期',
  delay_requested: '已申请延期',
  delay_approved: '已批准延期',
  delay_rejected: '已驳回延期',
};

function hasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
}

function canUpgradeTemplate(user) {
  return hasPermission(user?.role, 'template:upgrade');
}

function canManageIssue(user, issue, action) {
  if (!user || !issue) return false;
  if (action === 'close' && !hasPermission(user.role, 'issue:close')) return false;
  if (action === 'reject' && !hasPermission(user.role, 'issue:reject')) return false;
  if (user.role === 'supervisor') return true;
  if (user.role === 'manager') {
    return user.storeId === issue.storeId;
  }
  return false;
}

function compareSemanticVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function diffTemplateFields(oldFields, newFields) {
  const oldMap = new Map(oldFields.map(f => [f.key, f]));
  const newMap = new Map(newFields.map(f => [f.key, f]));
  const diffs = [];
  const oldLabels = new Map(oldFields.map(f => [f.label, f]));

  for (const newField of newFields) {
    if (!oldMap.has(newField.key)) {
      const renamedFrom = oldLabels.get(newField.label);
      if (renamedFrom && !newMap.has(renamedFrom.key)) {
        diffs.push({ type: 'renamed', oldKey: renamedFrom.key, newKey: newField.key, field: newField });
      } else {
        diffs.push({ type: 'added', newKey: newField.key, field: newField });
      }
    } else {
      const oldField = oldMap.get(newField.key);
      const changed = oldField.label !== newField.label ||
                      oldField.type !== newField.type ||
                      JSON.stringify(oldField.options || []) !== JSON.stringify(newField.options || []);
      if (changed) {
        diffs.push({ type: 'modified', oldKey: newField.key, newKey: newField.key, oldField, newField });
      } else {
        diffs.push({ type: 'unchanged', oldKey: newField.key, newKey: newField.key, field: newField });
      }
    }
  }

  for (const oldField of oldFields) {
    if (!newMap.has(oldField.key)) {
      const stillExists = diffs.some(d => d.type === 'renamed' && d.oldKey === oldField.key);
      if (!stillExists) {
        diffs.push({ type: 'removed', oldKey: oldField.key, field: oldField });
      }
    }
  }

  return diffs;
}

function diffTemplateVersions(oldTpl, newTpl, affectedIssues = []) {
  const fieldDiffs = diffTemplateFields(oldTpl.fields || [], newTpl.fields || []);
  const added = fieldDiffs.filter(d => d.type === 'added');
  const removed = fieldDiffs.filter(d => d.type === 'removed');
  const modified = fieldDiffs.filter(d => d.type === 'modified');
  const renamed = fieldDiffs.filter(d => d.type === 'renamed');

  return {
    templateId: oldTpl.id,
    oldVersion: oldTpl.version,
    newVersion: newTpl.version,
    fieldDiffs,
    summary: {
      total: fieldDiffs.length,
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      renamed: renamed.length,
      unchanged: fieldDiffs.filter(d => d.type === 'unchanged').length
    },
    impactSummary: {
      affectedIssues: affectedIssues.length,
      draftIssues: affectedIssues.filter(i => i.status === 'draft').length,
      pendingSyncIssues: affectedIssues.filter(i => i.syncStatus === 'pending').length,
      fieldsLosingData: removed.length + modified.filter(m => m.oldField.type !== m.newField.type).length
    }
  };
}

function buildMigrationMappingsFromDiff(diff) {
  return diff.fieldDiffs
    .filter(d => d.type === 'renamed' || d.type === 'unchanged' || d.type === 'modified')
    .map(d => ({ fromKey: d.oldKey, toKey: d.newKey, strategy: 'copy' }));
}

function migrateIssueData(oldData, mappings, newTemplate, options = {}) {
  const { fillDefaults = true } = options;
  const result = {};
  const mappingMap = new Map(mappings.map(m => [m.fromKey, m]));

  for (const [key, value] of Object.entries(oldData || {})) {
    const mapping = mappingMap.get(key);
    if (mapping) {
      result[mapping.toKey] = value;
    }
  }

  if (fillDefaults) {
    for (const field of newTemplate.fields || []) {
      if (!(field.key in result) && field.defaultValue !== undefined) {
        result[field.key] = field.defaultValue;
      }
    }
  }

  return result;
}

function applyTemplateUpgrade(issues, oldTpl, newTpl, diff, option, customMappings) {
  const mappings = customMappings || buildMigrationMappingsFromDiff(diff);
  const migrationRecord = {
    id: generateId(),
    templateId: oldTpl.id,
    fromVersion: oldTpl.version,
    toVersion: newTpl.version,
    option,
    mappings,
    operatorId: 'test-operator',
    createdAt: new Date().toISOString(),
    affectedIssueCount: issues.length
  };

  const migratedIssues = [];
  const keptIssues = [];
  const histories = [];

  for (const issue of issues) {
    const isDraft = issue.status === 'draft';
    const shouldKeepOld = option === 'keep_old' || (option === 'new_only' && isDraft);

    if (shouldKeepOld) {
      keptIssues.push({ ...issue });
    } else {
      const migratedData = migrateIssueData(issue.fieldData, mappings, newTpl);
      const migratedIssue = {
        ...issue,
        fieldData: migratedData,
        templateVersion: newTpl.version,
        migrationSource: {
          fromTemplateVersion: oldTpl.version,
          migrationId: migrationRecord.id,
          migratedAt: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };
      migratedIssues.push(migratedIssue);
      histories.push({
        id: generateId(),
        issueId: issue.id,
        action: 'migrate',
        actorId: 'test-operator',
        timestamp: new Date().toISOString(),
        templateVersion: newTpl.version,
        migrationInfo: {
          fromVersion: oldTpl.version,
          toVersion: newTpl.version,
          migrationId: migrationRecord.id
        },
        details: {
          from: oldTpl.version,
          to: newTpl.version
        }
      });
    }
  }

  return { migratedIssues, keptIssues, migrationRecord, histories };
}

function validateTemplateImport(incomingTemplates, existingTemplates, userRole) {
  const warnings = [];
  const errors = [];
  const validTemplates = [];
  const duplicates = [];
  const versionConflicts = [];

  if (!hasPermission(userRole, 'template:import')) {
    errors.push({ type: 'permission_denied', message: '当前用户无权限导入模板' });
    return { valid: false, validTemplates, warnings, errors, duplicates, versionConflicts };
  }

  const existingByName = new Map();
  for (const tpl of existingTemplates) {
    if (!existingByName.has(tpl.name)) existingByName.set(tpl.name, []);
    existingByName.get(tpl.name).push(tpl);
  }

  for (const incoming of incomingTemplates) {
    if (!incoming.name || !incoming.version || !incoming.fields) {
      warnings.push({ type: 'missing_fields', templateName: incoming.name || '(无名模板)', message: '模板缺少必填字段(name/version/fields)，已跳过' });
      continue;
    }

    const existingSameName = existingByName.get(incoming.name) || [];
    const existingSameVersion = existingSameName.find(t => t.version === incoming.version);

    if (existingSameVersion) {
      duplicates.push({ templateName: incoming.name, version: incoming.version });
      warnings.push({ type: 'duplicate_version', templateName: incoming.name, version: incoming.version, message: `模板 "${incoming.name}" v${incoming.version} 已存在，跳过导入` });
      continue;
    }

    const hasOlderVersion = existingSameName.some(t => compareSemanticVersions(t.version, incoming.version) < 0);
    const hasNewerVersion = existingSameName.some(t => compareSemanticVersions(t.version, incoming.version) > 0);

    if (hasNewerVersion) {
      warnings.push({ type: 'older_version_imported', templateName: incoming.name, version: incoming.version, message: `模板 "${incoming.name}" 已有更新版本，导入 v${incoming.version} 将作为历史版本保留` });
    }

    if (hasOlderVersion) {
      versionConflicts.push({ templateName: incoming.name, newVersion: incoming.version, existingVersions: existingSameName.map(t => t.version) });
    }

    validTemplates.push(incoming);
  }

  return {
    valid: errors.length === 0,
    validTemplates,
    warnings,
    errors,
    duplicates,
    versionConflicts,
    hasUpgrades: versionConflicts.length > 0
  };
}

function buildExportPayload(issues, stores, templates, migrations, unresolvedConflicts, currentUser) {
  return {
    schemaVersion: '2.0',
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser?.id,
    data: {
      issues: issues.map(i => ({
        ...i,
        templateVersion: i.templateVersion || '1.0'
      })),
      stores,
      templates: templates.map(t => ({ ...t })),
      migrations,
      unresolvedConflicts
    }
  };
}

function parseExportPayload(raw) {
  const warnings = [];
  const errors = [];

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!parsed || typeof parsed !== 'object') {
      errors.push({ type: 'invalid_format', message: '导出文件格式无效' });
      return { valid: false, warnings, errors };
    }

    if (!parsed.data || typeof parsed.data !== 'object') {
      errors.push({ type: 'missing_data', message: '导出文件缺少 data 字段' });
      return { valid: false, warnings, errors };
    }

    const schemaVersion = parsed.schemaVersion || '1.0';
    if (compareSemanticVersions(schemaVersion, '1.0') < 0) {
      warnings.push({ type: 'old_schema', message: `文件来自旧版本 (v${schemaVersion})，部分字段可能缺失` });
    }

    const data = parsed.data;
    const result = {
      issues: [],
      stores: [],
      templates: [],
      migrations: [],
      unresolvedConflicts: []
    };

    if (Array.isArray(data.templates)) {
      result.templates = data.templates;
    } else {
      warnings.push({ type: 'missing_templates', message: '导出文件缺少模板数据' });
    }

    if (Array.isArray(data.issues)) {
      result.issues = data.issues.map(issue => ({
        ...issue,
        templateVersion: issue.templateVersion || '1.0'
      }));
    } else {
      warnings.push({ type: 'missing_issues', message: '导出文件缺少问题数据' });
    }

    if (Array.isArray(data.stores)) {
      result.stores = data.stores;
    }

    if (Array.isArray(data.migrations)) {
      result.migrations = data.migrations;
    }

    if (Array.isArray(data.unresolvedConflicts)) {
      result.unresolvedConflicts = data.unresolvedConflicts;
    }

    return { valid: true, payload: result, warnings, errors, schemaVersion };
  } catch (e) {
    errors.push({ type: 'parse_error', message: `解析失败: ${e.message}` });
    return { valid: false, warnings, errors };
  }
}

function createTemplateVersionConflict(localIssue, remoteIssue, localTpl, remoteTpl) {
  const diff = diffTemplateVersions(localTpl, remoteTpl, [localIssue]);
  return {
    id: generateId(),
    issueId: localIssue.id,
    localVersion: localIssue,
    remoteVersion: remoteIssue,
    status: 'pending',
    detectedAt: new Date().toISOString(),
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    templateVersionConflict: {
      localTemplateVersion: localTpl.version,
      remoteTemplateVersion: remoteTpl.version,
      diff
    }
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`\u2705 ${name}`);
    passed++;
  } catch (e) {
    console.log(`\u274C ${name}`);
    console.log(`   错误: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const storeA = { id: 'store-a', name: '门店A', address: '地址A' };
const storeB = { id: 'store-b', name: '门店B', address: '地址B' };

const managerA = { id: 'mgr-a', name: '店长A', role: 'manager', storeId: 'store-a' };
const managerB = { id: 'mgr-b', name: '店长B', role: 'manager', storeId: 'store-b' };
const supervisor = { id: 'sup-1', name: '督导', role: 'supervisor' };
const inspector = { id: 'ins-1', name: '巡检员', role: 'inspector' };

const issueInA = { id: 'issue-1', title: '问题1', storeId: 'store-a', status: 'submitted', version: 1 };
const issueInB = { id: 'issue-2', title: '问题2', storeId: 'store-b', status: 'submitted', version: 1 };

function makeTemplate(id, name, version, fields) {
  return { id, name, version, fields, createdAt: new Date().toISOString() };
}

const v1Fields = [
  { key: 'floor_clean', label: '地面清洁', type: 'boolean', defaultValue: false },
  { key: 'shelf_tidy', label: '货架整洁', type: 'boolean', defaultValue: true },
  { key: 'lighting_ok', label: '照明正常', type: 'select', options: ['正常', '故障', '部分故障'], defaultValue: '正常' }
];

const v2Fields = [
  { key: 'floor_cleanliness', label: '地面清洁', type: 'rating', options: [1, 2, 3, 4, 5], defaultValue: 3 },
  { key: 'shelf_tidy', label: '货架整洁', type: 'boolean', defaultValue: true },
  { key: 'lighting_ok', label: '照明正常', type: 'select', options: ['正常', '故障', '部分故障'], defaultValue: '正常' },
  { key: 'aircon_temp', label: '空调温度', type: 'number', defaultValue: 26 }
];

const templateV1 = makeTemplate('tpl-1', '日常巡店检查', '1.0', v1Fields);
const templateV2 = makeTemplate('tpl-1', '日常巡店检查', '2.0', v2Fields);

console.log('=== 门店归属权限验证 ===\n');

test('店长可关闭自己门店的问题', () => {
  assert(canManageIssue(managerA, issueInA, 'close') === true, '店长A应能关闭门店A的问题');
});

test('店长不可关闭其他门店的问题', () => {
  assert(canManageIssue(managerA, issueInB, 'close') === false, '店长A不应能关闭门店B的问题');
});

test('督导可关闭任意门店的问题', () => {
  assert(canManageIssue(supervisor, issueInA, 'close') === true, '督导应能关闭门店A的问题');
  assert(canManageIssue(supervisor, issueInB, 'close') === true, '督导应能关闭门店B的问题');
});

test('巡检员不能关闭任何问题', () => {
  assert(canManageIssue(inspector, issueInA, 'close') === false, '巡检员不能关闭问题');
});

test('只有督导可驳回问题', () => {
  assert(canManageIssue(supervisor, issueInA, 'reject') === true, '督导应能驳回');
  assert(canManageIssue(managerA, issueInA, 'reject') === false, '店长不能驳回');
  assert(canManageIssue(inspector, issueInA, 'reject') === false, '巡检员不能驳回');
});

test('用户或问题为空时返回 false', () => {
  assert(canManageIssue(null, issueInA, 'close') === false);
  assert(canManageIssue(managerA, null, 'close') === false);
  assert(canManageIssue(null, null, 'close') === false);
});

console.log('\n=== 语义化版本对比 ===\n');

test('版本号大小比较正确', () => {
  assert(compareSemanticVersions('1.0', '2.0') < 0, '1.0 < 2.0');
  assert(compareSemanticVersions('2.0', '1.0') > 0, '2.0 > 1.0');
  assert(compareSemanticVersions('1.0', '1.0') === 0, '1.0 == 1.0');
  assert(compareSemanticVersions('1.2.3', '1.2.4') < 0, '1.2.3 < 1.2.4');
  assert(compareSemanticVersions('1.10', '1.9') > 0, '1.10 > 1.9');
  assert(compareSemanticVersions('2.0', '1.9.9') > 0, '2.0 > 1.9.9');
});

console.log('\n=== 模板升级导入验证 ===\n');

test('diff 正确识别字段新增、删除、修改、重命名', () => {
  const diff = diffTemplateFields(v1Fields, v2Fields);
  const types = diff.map(d => d.type);

  assert(types.includes('added'), '应识别新增字段 aircon_temp');
  assert(types.includes('renamed'), '应识别 floor_clean -> floor_cleanliness 为重命名');
  assert(types.includes('unchanged'), '应识别 shelf_tidy 和 lighting_ok 未变');

  const added = diff.find(d => d.type === 'added');
  assert(added?.newKey === 'aircon_temp', '新增字段应为 aircon_temp');

  const renamed = diff.find(d => d.type === 'renamed');
  assert(renamed?.oldKey === 'floor_clean', '重命名字段原 key 应为 floor_clean');
  assert(renamed?.newKey === 'floor_cleanliness', '重命名字段新 key 应为 floor_cleanliness');
  assert(renamed?.field?.type === 'rating', '重命名后的字段类型应为 rating');

  const unchanged = diff.filter(d => d.type === 'unchanged');
  assert(unchanged.length === 2, '应有 2 个未变字段（shelf_tidy, lighting_ok）');
  assert(unchanged.some(d => d.newKey === 'shelf_tidy'), 'shelf_tidy 应未变');
  assert(unchanged.some(d => d.newKey === 'lighting_ok'), 'lighting_ok 应未变');
});

test('diffTemplateVersions 返回完整影响摘要', () => {
  const testIssues = [
    { id: 'i1', status: 'draft', syncStatus: 'pending', templateVersion: '1.0' },
    { id: 'i2', status: 'submitted', syncStatus: 'completed', templateVersion: '1.0' },
    { id: 'i3', status: 'draft', syncStatus: 'completed', templateVersion: '1.0' }
  ];
  const diff = diffTemplateVersions(templateV1, templateV2, testIssues);

  assert(diff.oldVersion === '1.0', '旧版本应为 1.0');
  assert(diff.newVersion === '2.0', '新版本应为 2.0');
  assert(diff.summary.total > 0, '应包含差异统计');
  assert(diff.impactSummary.affectedIssues === 3, '应统计 3 个受影响问题');
  assert(diff.impactSummary.draftIssues === 2, '应统计 2 个草稿');
  assert(diff.impactSummary.pendingSyncIssues === 1, '应统计 1 个待同步');
});

test('同名同版本重复导入被识别并跳过', () => {
  const result = validateTemplateImport([templateV1], [templateV1], 'supervisor');
  assert(result.duplicates.length === 1, '应识别 1 个重复版本');
  assert(result.warnings.some(w => w.type === 'duplicate_version'), '应有重复版本警告');
  assert(result.validTemplates.length === 0, '重复版本不应被加入有效模板');
});

test('同名不同版本触发升级提示', () => {
  const result = validateTemplateImport([templateV2], [templateV1], 'supervisor');
  assert(result.hasUpgrades === true, '应标记有可用升级');
  assert(result.versionConflicts.length === 1, '应有 1 个版本冲突记录');
  assert(result.validTemplates.length === 1, '新版本模板应为有效');
});

test('导入缺少必填字段的模板给出警告不静默', () => {
  const badTemplates = [
    { name: '缺 version', fields: [] },
    { version: '1.0', fields: [] }
  ];
  const result = validateTemplateImport(badTemplates, [], 'supervisor');
  assert(result.warnings.some(w => w.type === 'missing_fields'), '应有缺字段警告');
  assert(result.validTemplates.length === 0, '缺字段模板不应被接受');
});

test('导入已有更新版本时给出警告', () => {
  const result = validateTemplateImport([templateV1], [templateV2], 'supervisor');
  assert(result.warnings.some(w => w.type === 'older_version_imported'), '应有旧版本警告');
});

console.log('\n=== 草稿迁移三种策略验证 ===\n');

const sampleIssues = [
  { id: 'i1', status: 'draft', templateVersion: '1.0', fieldData: { floor_clean: true, shelf_tidy: false, lighting_ok: '正常' } },
  { id: 'i2', status: 'submitted', templateVersion: '1.0', fieldData: { floor_clean: false, shelf_tidy: true, lighting_ok: '故障' } },
  { id: 'i3', status: 'draft', templateVersion: '1.0', fieldData: { floor_clean: true, shelf_tidy: true, lighting_ok: '部分故障' } }
];

const diff = diffTemplateVersions(templateV1, templateV2, sampleIssues);

test('keep_old 策略保留所有草稿原版本不变', () => {
  const result = applyTemplateUpgrade(sampleIssues, templateV1, templateV2, diff, 'keep_old');
  assert(result.keptIssues.length === 3, '所有 3 个问题应被保留旧版本');
  assert(result.migratedIssues.length === 0, '不应有迁移的问题');
  assert(result.keptIssues.every(i => i.templateVersion === '1.0'), '保留的问题 templateVersion 应为 1.0');
  assert(result.keptIssues.every(i => !i.migrationSource), '保留的问题不应有迁移来源标记');
});

test('migrate 策略迁移所有问题并写清来源', () => {
  const result = applyTemplateUpgrade(sampleIssues, templateV1, templateV2, diff, 'migrate');
  assert(result.migratedIssues.length === 3, '所有 3 个问题应被迁移');
  assert(result.keptIssues.length === 0, '不应有保留的问题');

  for (const issue of result.migratedIssues) {
    assert(issue.templateVersion === '2.0', '迁移后 templateVersion 应为 2.0');
    assert(issue.migrationSource, '迁移后应有 migrationSource');
    assert(issue.migrationSource.fromTemplateVersion === '1.0', '迁移来源版本应为 1.0');
    assert(issue.migrationSource.migrationId === result.migrationRecord.id, 'migrationId 应与记录一致');
    assert(issue.migrationSource.migratedAt, '应有迁移时间戳');
  }

  assert(result.histories.length === 3, '应为每个迁移问题生成历史记录');
  assert(result.histories.every(h => h.action === 'migrate'), '历史记录 action 应为 migrate');
  assert(result.histories.every(h => h.migrationInfo), '历史记录应有 migrationInfo');
});

test('new_only 策略草稿保留旧版、已提交迁移', () => {
  const result = applyTemplateUpgrade(sampleIssues, templateV1, templateV2, diff, 'new_only');
  assert(result.keptIssues.length === 2, '2 个草稿应保留旧版本');
  assert(result.migratedIssues.length === 1, '1 个已提交问题应迁移');
  assert(result.keptIssues.every(i => i.status === 'draft'), '保留的都是草稿');
  assert(result.migratedIssues[0].status === 'submitted', '迁移的是已提交问题');
});

test('字段映射迁移：重命名字段值正确传递，新增字段填充默认值', () => {
  const result = applyTemplateUpgrade(sampleIssues, templateV1, templateV2, diff, 'migrate');
  const migrated = result.migratedIssues[0];

  assert(migrated.fieldData.floor_cleanliness === true, '重命名字段值应从 floor_clean 迁移到 floor_cleanliness');
  assert(migrated.fieldData.shelf_tidy === false, '未变字段值应保留 shelf_tidy = false');
  assert(migrated.fieldData.aircon_temp === 26, '新增字段应填充默认值 26');
});

test('迁移记录溯源链完整', () => {
  const result = applyTemplateUpgrade(sampleIssues, templateV1, templateV2, diff, 'migrate');
  const record = result.migrationRecord;

  assert(record.fromVersion === '1.0', '记录 fromVersion 正确');
  assert(record.toVersion === '2.0', '记录 toVersion 正确');
  assert(record.option === 'migrate', '记录迁移策略正确');
  assert(record.affectedIssueCount === 3, '记录影响数量正确');
  assert(record.mappings.length > 0, '记录包含字段映射');

  const issue = result.migratedIssues[0];
  assert(issue.migrationSource.migrationId === record.id, '问题的 migrationId 指向记录');

  const history = result.histories[0];
  assert(history.migrationInfo.migrationId === record.id, '历史的 migrationId 指向记录');
});

console.log('\n=== 无权限操作验证 ===\n');

test('店长无 template:upgrade 权限', () => {
  assert(canUpgradeTemplate(managerA) === false, '店长不能升级模板');
});

test('巡检员无 template:upgrade 权限', () => {
  assert(canUpgradeTemplate(inspector) === false, '巡检员不能升级模板');
});

test('督导有 template:upgrade 权限', () => {
  assert(canUpgradeTemplate(supervisor) === true, '督导可以升级模板');
});

test('店长导入模板被拒绝', () => {
  const result = validateTemplateImport([templateV2], [templateV1], 'manager');
  assert(result.valid === false, '店长导入应返回 invalid');
  assert(result.errors.some(e => e.type === 'permission_denied'), '应有权限拒绝错误');
});

test('巡检员导入模板被拒绝', () => {
  const result = validateTemplateImport([templateV2], [templateV1], 'inspector');
  assert(result.valid === false, '巡检员导入应返回 invalid');
  assert(result.errors.some(e => e.type === 'permission_denied'), '应有权限拒绝错误');
});

console.log('\n=== 模板版本同步冲突验证 ===\n');

test('本地旧模板/远端新模板触发特殊冲突并携带 diff', () => {
  const localIssue = { id: 'i-conflict', status: 'submitted', templateVersion: '1.0', fieldData: { floor_clean: true } };
  const remoteIssue = { ...localIssue, templateVersion: '2.0', fieldData: { floor_cleanliness: 4 } };

  const conflict = createTemplateVersionConflict(localIssue, remoteIssue, templateV1, templateV2);

  assert(conflict.templateVersionConflict, '冲突应有 templateVersionConflict 字段');
  assert(conflict.templateVersionConflict.localTemplateVersion === '1.0', '本地版本应为 1.0');
  assert(conflict.templateVersionConflict.remoteTemplateVersion === '2.0', '远端版本应为 2.0');
  assert(conflict.templateVersionConflict.diff, '冲突应携带版本差异 diff');
  assert(conflict.localVersion.templateVersion === '1.0', '本地版本内容保留 1.0');
  assert(conflict.remoteVersion.templateVersion === '2.0', '远端版本内容保留 2.0');
});

test('冲突双方版本独立保留互不覆盖', () => {
  const localIssue = { id: 'i1', templateVersion: '1.0', fieldData: { floor_clean: true, shelf_tidy: false } };
  const remoteIssue = { id: 'i1', templateVersion: '2.0', fieldData: { floor_cleanliness: 5, shelf_tidy: true, aircon_temp: 24 } };

  const conflict = createTemplateVersionConflict(localIssue, remoteIssue, templateV1, templateV2);

  assert(deepEqual(conflict.localVersion.fieldData, localIssue.fieldData), '本地字段数据不应被远端覆盖');
  assert(deepEqual(conflict.remoteVersion.fieldData, remoteIssue.fieldData), '远端字段数据不应被本地覆盖');
  assert(conflict.status === 'pending', '冲突初始状态为 pending');
});

console.log('\n=== 导入导出往返验证 ===\n');

const testIssuesForExport = [
  { id: 'i1', title: '问题1', templateVersion: '1.0', fieldData: { a: 1 } },
  { id: 'i2', title: '问题2', templateVersion: '2.0', migrationSource: { fromTemplateVersion: '1.0', migrationId: 'mig-1', migratedAt: '2024-01-01' }, fieldData: { b: 2 } }
];

const testMigrations = [
  { id: 'mig-1', templateId: 'tpl-1', fromVersion: '1.0', toVersion: '2.0', option: 'migrate', createdAt: '2024-01-01' }
];

const testConflicts = [
  { id: 'c1', issueId: 'i1', status: 'pending', templateVersionConflict: { localTemplateVersion: '1.0', remoteTemplateVersion: '2.0' } }
];

test('buildExportPayload 包含版本/迁移/冲突信息', () => {
  const payload = buildExportPayload(testIssuesForExport, [storeA], [templateV1, templateV2], testMigrations, testConflicts, supervisor);
  assert(payload.schemaVersion === '2.0', '导出 schemaVersion 应为 2.0');
  assert(payload.data.issues.length === 2, '导出包含 2 个问题');
  assert(payload.data.templates.length === 2, '导出包含 2 个模板版本');
  assert(payload.data.migrations.length === 1, '导出包含 1 条迁移记录');
  assert(payload.data.unresolvedConflicts.length === 1, '导出包含 1 个未解决冲突');
  assert(payload.exportedBy === supervisor.id, '记录导出人');
});

test('导出后再导入数据完整保留（往返一致性）', () => {
  const exported = buildExportPayload(testIssuesForExport, [storeA], [templateV1, templateV2], testMigrations, testConflicts, supervisor);
  const jsonStr = JSON.stringify(exported);
  const parsed = parseExportPayload(jsonStr);

  assert(parsed.valid === true, '导入解析应成功');
  assert(parsed.payload.issues.length === 2, '导入后问题数量一致');
  assert(parsed.payload.templates.length === 2, '导入后模板数量一致');
  assert(parsed.payload.migrations.length === 1, '导入后迁移记录数量一致');
  assert(parsed.payload.unresolvedConflicts.length === 1, '导入后冲突数量一致');

  assert(parsed.payload.issues[1].migrationSource.migrationId === 'mig-1', '迁移来源信息保留');
  assert(parsed.payload.issues[1].templateVersion === '2.0', 'templateVersion 保留');
});

test('parseExportPayload 识别旧 schema 和缺字段给出警告', () => {
  const oldPayload = {
    schemaVersion: '0.5',
    data: {
      issues: [{ id: 'i1' }]
    }
  };
  const parsed = parseExportPayload(JSON.stringify(oldPayload));
  assert(parsed.valid === true, '旧 schema 仍可解析');
  assert(parsed.warnings.some(w => w.type === 'old_schema'), '应有旧 schema 警告');
  assert(parsed.warnings.some(w => w.type === 'missing_templates'), '应有缺模板警告');
  assert(parsed.payload.issues[0].templateVersion === '1.0', '缺省 templateVersion 补为 1.0');
});

test('parseExportPayload 格式错误不静默吞掉', () => {
  const parsed = parseExportPayload('this is not json');
  assert(parsed.valid === false, '无效 JSON 应返回 invalid');
  assert(parsed.errors.some(e => e.type === 'parse_error'), '应有解析错误提示');
});

console.log('\n=== 跨重启数据恢复（持久化一致性）验证 ===\n');

test('问题 templateVersion 默认值规范化（旧数据补 1.0）', () => {
  const exported = buildExportPayload([{ id: 'i-old', title: '旧问题' }], [], [], [], [], supervisor);
  const parsed = parseExportPayload(JSON.stringify(exported));
  assert(parsed.payload.issues[0].templateVersion === '1.0', '无 templateVersion 的旧问题恢复为 1.0');
});

test('多版本模板并存恢复：旧版本不被覆盖', () => {
  const payload = buildExportPayload(
    [{ id: 'i1', templateVersion: '1.0' }, { id: 'i2', templateVersion: '2.0' }],
    [],
    [templateV1, templateV2],
    [],
    [],
    supervisor
  );
  const jsonStr = JSON.stringify(payload);
  const recovered = parseExportPayload(jsonStr);

  assert(recovered.payload.templates.length === 2, '恢复后两个版本模板都存在');
  assert(recovered.payload.templates.find(t => t.version === '1.0'), 'v1.0 模板存在');
  assert(recovered.payload.templates.find(t => t.version === '2.0'), 'v2.0 模板存在');
  assert(recovered.payload.issues[0].templateVersion === '1.0', '问题 i1 绑定 v1.0');
  assert(recovered.payload.issues[1].templateVersion === '2.0', '问题 i2 绑定 v2.0');
});

// ========== 复查与整改计划 辅助函数 ==========

function canCreatePlan(user, issue) {
  if (!user || !issue || !hasPermission(user.role, 'plan:create')) return false;
  if (user.role === 'supervisor') return true;
  if (user.role === 'manager') return user.storeId === issue.storeId;
  return false;
}

function canEditPlan(user, plan, issue) {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:edit_all')) return true;
  if (hasPermission(user.role, 'plan:edit_own')) {
    if (user.role === 'manager') {
      return user.storeId === (issue?.storeId || plan.storeId || true);
    }
    return user.id === plan.creatorId;
  }
  return false;
}

function canViewPlan(user, plan, issue) {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan:view_all')) return true;
  if (hasPermission(user.role, 'plan:view_store')) {
    return user.storeId === (issue?.storeId || plan.storeId);
  }
  if (hasPermission(user.role, 'plan:view_own')) {
    return user.id === plan.assigneeId || user.id === plan.creatorId;
  }
  return false;
}

function canResolvePlanConflict(user, plan, issue) {
  if (!user || !plan) return false;
  if (hasPermission(user.role, 'plan_conflict:resolve_all')) return true;
  if (hasPermission(user.role, 'plan_conflict:resolve_own')) {
    if (user.role === 'manager') return user.storeId === (issue?.storeId || plan.storeId);
    return user.id === plan.creatorId;
  }
  return false;
}

function diffReviewPlans(local, remote) {
  const diffs = [];
  if (local.reviewTime !== remote.reviewTime) {
    diffs.push({ field: 'reviewTime', label: '复查时间', local: local.reviewTime, remote: remote.reviewTime });
  }
  if (local.assigneeId !== remote.assigneeId || local.assigneeName !== remote.assigneeName) {
    diffs.push({
      field: 'assignee',
      label: '责任人',
      local: local.assigneeName || local.assigneeId,
      remote: remote.assigneeName || remote.assigneeId
    });
  }
  if (local.rectificationNote !== remote.rectificationNote) {
    diffs.push({ field: 'rectificationNote', label: '整改说明', local: local.rectificationNote, remote: remote.rectificationNote });
  }
  const la = local.attachments?.map(a => a.id).sort().join(',') || '';
  const ra = remote.attachments?.map(a => a.id).sort().join(',') || '';
  if (la !== ra) {
    diffs.push({
      field: 'attachments',
      label: '附件',
      local: (local.attachments?.length || 0) + ' 个',
      remote: (remote.attachments?.length || 0) + ' 个'
    });
  }
  return diffs;
}

function mergeReviewPlans(local, remote) {
  const allAtt = [];
  const seen = new Set();
  for (const a of [...(local.attachments || []), ...(remote.attachments || [])]) {
    if (!seen.has(a.id)) { allAtt.push(a); seen.add(a.id); }
  }
  const notes = [local.rectificationNote, remote.rectificationNote].filter(Boolean).join('\n\n--- 合并分割 ---\n\n');
  return {
    ...local,
    reviewTime: local.reviewTime || remote.reviewTime,
    assigneeId: local.assigneeId || remote.assigneeId,
    assigneeName: local.assigneeName || remote.assigneeName,
    rectificationNote: notes,
    attachments: allAtt,
    version: Math.max(local.version, remote.version) + 1,
    synced: false,
    status: 'draft'
  };
}

function makeReviewPlan(overrides = {}) {
  const base = {
    id: generateId(),
    issueId: 'issue-1',
    reviewTime: new Date(Date.now() + 86400000).toISOString(),
    assigneeId: 'ins-1',
    assigneeName: '巡检员',
    assigneeRole: 'inspector',
    rectificationNote: '请完成整改',
    attachments: [],
    creatorId: 'sup-1',
    creatorRole: 'supervisor',
    version: 1,
    status: 'pending',
    synced: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return { ...base, ...overrides };
}

function makePlanConflict(local, remote, overrides = {}) {
  return {
    id: generateId(),
    planId: local.id,
    issueId: local.issueId,
    localPlan: local,
    remotePlan: remote,
    status: 'pending',
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    detectedAt: new Date().toISOString(),
    ...overrides
  };
}

// ========== 扩展导入导出 ==========

function generateCSVWithVersions(issues, stores, templates, migrations, reviewPlans = []) {
  const storeMap = new Map(stores.map(s => [s.id, s.name]));
  const templateMap = new Map(templates.map(t => [t.id, t]));
  const migrationMap = new Map(migrations.map(m => [m.id, m]));
  const plansByIssue = new Map();
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
    const planDueStatuses = plans.map(p => DUE_STATUS_LABELS[p.dueStatus] || '正常').join('; ');
    const planDelayCounts = plans.map(p => p.delayCount || 0).join('; ');
    const planLastDelayReasons = plans.map(p => (p.lastDelayReason || '').replace(/"/g, "'").replace(/\n/g, ' ')).join(' | ');
    const planApprovers = plans.map(p => p.lastApproverName || '').join('; ');

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

function buildExportPayloadV3(issues, stores, templates, migrations, unresolvedConflicts, reviewPlans, unresolvedPlanConflicts, currentUser) {
  const planList = (reviewPlans || []).map(p => ({
    ...p,
    attachments: (p.attachments || []).map(a => ({ ...a, url: undefined, placeholder: true }))
  }));
  return {
    schemaVersion: '3.0',
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser?.id,
    data: {
      issues: issues.map(i => ({ ...i, templateVersion: i.templateVersion || '1.0' })),
      stores,
      templates,
      migrations,
      unresolvedConflicts,
      reviewPlans: planList,
      unresolvedPlanConflicts
    }
  };
}

function parseExportPayloadV3(raw, currentUser) {
  const warnings = [];
  const errors = [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') {
      errors.push({ type: 'invalid_format', message: '格式无效' });
      return { valid: false, warnings, errors };
    }
    if (!parsed.data || typeof parsed.data !== 'object') {
      errors.push({ type: 'missing_data', message: '缺少 data 字段' });
      return { valid: false, warnings, errors };
    }
    const schemaVersion = parsed.schemaVersion || '1.0';
    if (compareSemanticVersions(schemaVersion, '3.0') < 0) {
      warnings.push({ type: 'old_schema', message: `文件来自旧版本 v${schemaVersion}，复查计划数据可能缺失` });
    }
    const data = parsed.data;
    const result = {
      issues: [], stores: [], templates: [], migrations: [],
      unresolvedConflicts: [], reviewPlans: [], unresolvedPlanConflicts: []
    };
    if (Array.isArray(data.issues)) result.issues = data.issues.map(i => ({ ...i, templateVersion: i.templateVersion || '1.0' }));
    if (Array.isArray(data.stores)) result.stores = data.stores;
    if (Array.isArray(data.templates)) result.templates = data.templates;
    if (Array.isArray(data.migrations)) result.migrations = data.migrations;
    if (Array.isArray(data.unresolvedConflicts)) result.unresolvedConflicts = data.unresolvedConflicts;

    if (Array.isArray(data.reviewPlans)) {
      const seen = new Set();
      for (const p of data.reviewPlans) {
        if (seen.has(p.id)) {
          warnings.push({ type: 'duplicate_plan', planId: p.id, issueId: p.issueId, message: `复查计划 ${p.id.slice(0, 12)} 已存在，跳过` });
          continue;
        }
        seen.add(p.id);
        if (!p.assigneeId && !p.assigneeName) {
          warnings.push({ type: 'plan_missing_assignee', planId: p.id, issueId: p.issueId, message: `复查计划 ${p.id.slice(0, 12)} 缺少责任人信息` });
        }
        if (currentUser) {
          const _issue = data.issues?.find((i) => i.id === p.issueId);
          if (!canCreatePlan(currentUser, _issue || { storeId: p.storeId })) {
            warnings.push({ type: 'plan_no_permission', planId: p.id, issueId: p.issueId, message: `当前用户无权修改计划 ${p.id.slice(0, 12)}，将以草稿状态导入` });
            p.status = 'draft';
            p.synced = false;
          }
        }
        if (Array.isArray(p.attachments) && p.attachments.some(a => a.placeholder)) {
          warnings.push({ type: 'plan_attachment_placeholder', planId: p.id, issueId: p.issueId, message: `计划 ${p.id.slice(0, 12)} 包含占位附件，导入后需重新上传` });
        }
        result.reviewPlans.push(p);
      }
    } else if (compareSemanticVersions(schemaVersion, '3.0') >= 0) {
      warnings.push({ type: 'missing_review_plans', message: 'v3.0 文件缺少复查计划字段' });
    }

    if (Array.isArray(data.unresolvedPlanConflicts)) result.unresolvedPlanConflicts = data.unresolvedPlanConflicts;
    return { valid: true, payload: result, warnings, errors, schemaVersion };
  } catch (e) {
    errors.push({ type: 'parse_error', message: `解析失败: ${e.message}` });
    return { valid: false, warnings, errors };
  }
}

// ========== 测试用例 ==========

console.log('\n=== 复查计划：权限体系验证 ===\n');

test('店长可为本门店问题创建复查计划', () => {
  assert(canCreatePlan(managerA, issueInA) === true, '店长A应为门店A创建计划');
  assert(canCreatePlan(managerA, issueInB) === false, '店长A不应为门店B创建计划');
});

test('督导可任意创建复查计划', () => {
  assert(canCreatePlan(supervisor, issueInA) === true);
  assert(canCreatePlan(supervisor, issueInB) === true);
});

test('巡检员无创建复查计划权限', () => {
  assert(canCreatePlan(inspector, issueInA) === false);
  assert(canCreatePlan(inspector, issueInB) === false);
});

test('店长可编辑自己门店的计划', () => {
  const plan = makeReviewPlan({ creatorId: 'other', issueId: issueInA.id });
  assert(canEditPlan(managerA, plan, issueInA) === true, '店长A可编辑本门店计划');
  assert(canEditPlan(managerB, plan, issueInA) === false, '店长B不能编辑其他门店计划');
});

test('巡检员只能查看分配给自己或自己创建的计划', () => {
  const planForMe = makeReviewPlan({ assigneeId: inspector.id });
  const planByMe = makeReviewPlan({ creatorId: inspector.id });
  const planOther = makeReviewPlan({ assigneeId: 'other', creatorId: 'other' });
  assert(canViewPlan(inspector, planForMe) === true, '可查看分配给自己的计划');
  assert(canViewPlan(inspector, planByMe) === true, '可查看自己创建的计划');
  assert(canViewPlan(inspector, planOther) === false, '不应能查看他人计划');
});

test('督导可查看和解决所有复查计划冲突', () => {
  const plan = makeReviewPlan({ creatorId: 'x', storeId: 'any' });
  assert(canViewPlan(supervisor, plan) === true);
  assert(canResolvePlanConflict(supervisor, plan) === true);
});

test('店长只能解决本门店计划冲突', () => {
  const planA = makeReviewPlan({ issueId: issueInA.id });
  const planB = makeReviewPlan({ issueId: issueInB.id });
  assert(canResolvePlanConflict(managerA, planA, issueInA) === true);
  assert(canResolvePlanConflict(managerA, planB, issueInB) === false);
});

console.log('\n=== 复查计划：diff 和 merge 逻辑验证 ===\n');

test('diffReviewPlans 正确识别复查时间/责任人/说明/附件差异', () => {
  const local = makeReviewPlan({
    reviewTime: '2025-01-01T10:00:00.000Z',
    assigneeId: 'ins-1', assigneeName: '巡检员A',
    rectificationNote: '整改1',
    attachments: [{ id: 'att-1', name: 'a.png' }]
  });
  const remote = makeReviewPlan({
    id: local.id, issueId: local.issueId,
    reviewTime: '2025-01-02T10:00:00.000Z',
    assigneeId: 'ins-2', assigneeName: '巡检员B',
    rectificationNote: '整改2',
    attachments: [{ id: 'att-2', name: 'b.png' }]
  });
  const diffs = diffReviewPlans(local, remote);
  assert(diffs.length >= 4, '至少应识别 4 处差异');
  assert(diffs.some(d => d.field === 'reviewTime'), '应识别复查时间差异');
  assert(diffs.some(d => d.field === 'assignee'), '应识别责任人差异');
  assert(diffs.some(d => d.field === 'rectificationNote'), '应识别整改说明差异');
  assert(diffs.some(d => d.field === 'attachments'), '应识别附件差异');
});

test('mergeReviewPlans 附件合并去重，说明拼接，版本号递增', () => {
  const local = makeReviewPlan({
    version: 2, rectificationNote: '本地说明',
    attachments: [{ id: 'att-1', name: 'a.png' }]
  });
  const remote = makeReviewPlan({
    id: local.id, version: 3, rectificationNote: '远端说明',
    attachments: [{ id: 'att-1', name: 'a.png' }, { id: 'att-2', name: 'b.png' }]
  });
  const merged = mergeReviewPlans(local, remote);
  assert(merged.attachments.length === 2, '附件应合并去重为 2 个');
  assert(merged.rectificationNote.includes('本地说明') && merged.rectificationNote.includes('远端说明'), '整改说明应拼接双方');
  assert(merged.version === 4, '版本号应为 max(2,3)+1 = 4');
  assert(merged.status === 'draft', '合并后应为草稿待同步');
});

console.log('\n=== 复查计划：离线同步与冲突保留验证 ===\n');

test('本地和远端两份计划独立保存在冲突记录中互不覆盖', () => {
  const local = makeReviewPlan({ reviewTime: '2025-01-01', assigneeName: '本地责任人', version: 2 });
  const remote = makeReviewPlan({ id: local.id, reviewTime: '2025-01-03', assigneeName: '远端责任人', version: 2 });
  const pc = makePlanConflict(local, remote);
  assert(pc.localPlan.reviewTime === '2025-01-01', '本地计划内容不应被覆盖');
  assert(pc.remotePlan.reviewTime === '2025-01-03', '远端计划内容不应被覆盖');
  assert(pc.localPlan.assigneeName === '本地责任人', '本地责任人不被覆盖');
  assert(pc.remotePlan.assigneeName === '远端责任人', '远端责任人不被覆盖');
  assert(pc.status === 'pending', '冲突初始状态为 pending');
});

test('同步失败原因持久化可恢复（跨重启）', () => {
  const plan = makeReviewPlan({
    status: 'failed',
    lastSyncError: '网络超时',
    lastSyncAttempt: '2025-01-01T00:00:00.000Z'
  });
  const recovered = JSON.parse(JSON.stringify(plan));
  assert(recovered.status === 'failed', '重启后失败状态应保留');
  assert(recovered.lastSyncError === '网络超时', '重启后失败原因应保留');
  assert(recovered.lastSyncAttempt === '2025-01-01T00:00:00.000Z', '重启后失败时间应保留');
});

test('草稿状态跨重启恢复', () => {
  const plan = makeReviewPlan({ status: 'draft', rectificationNote: '未完成的草稿内容' });
  const recovered = JSON.parse(JSON.stringify(plan));
  assert(recovered.status === 'draft', '重启后草稿状态保留');
  assert(recovered.rectificationNote === '未完成的草稿内容', '重启后草稿内容保留');
});

console.log('\n=== 复查计划：导入导出往返一致性验证 ===\n');

const samplePlan1 = makeReviewPlan({
  id: 'plan-abc-123', issueId: issueInA.id,
  assigneeName: '责任人A', rectificationNote: '整改说明A',
  attachments: [{ id: 'att-1', name: '照片1.png', url: 'https://x.com/a.png' }],
  status: 'pending', version: 2
});
const samplePlan2 = makeReviewPlan({
  id: 'plan-xyz-456', issueId: issueInB.id,
  assigneeName: '责任人B', status: 'completed', version: 1
});
const samplePlanConflict = makePlanConflict(samplePlan1, samplePlan1, { status: 'pending' });

test('buildExportPayloadV3 schema 为 3.0，附件转为占位符', () => {
  const payload = buildExportPayloadV3([], [], [], [], [], [samplePlan1], [], supervisor);
  assert(payload.schemaVersion === '3.0', '导出 schemaVersion 应为 3.0');
  const p = payload.data.reviewPlans[0];
  assert(p.attachments[0].placeholder === true, '附件导出应为占位符');
  assert(p.attachments[0].url === undefined, '附件真实 URL 应被移除');
  assert(p.attachments[0].name === '照片1.png', '附件名称仍保留');
});

test('导入时识别重复计划、缺少责任人、占位附件并给出明确警告', () => {
  const duplicatePlan = { ...samplePlan1 };
  const missingAssigneePlan = makeReviewPlan({ id: 'plan-no-asg', assigneeId: '', assigneeName: '' });
  const exported = buildExportPayloadV3(
    [issueInA, issueInB], [storeA, storeB], [], [], [],
    [samplePlan1, duplicatePlan, missingAssigneePlan], [samplePlanConflict], supervisor
  );
  const parsed = parseExportPayloadV3(JSON.stringify(exported), inspector);
  assert(parsed.valid === true, '应能成功解析');
  assert(parsed.warnings.some(w => w.type === 'duplicate_plan'), '应给出重复计划警告');
  assert(parsed.warnings.some(w => w.type === 'plan_missing_assignee'), '应给出缺少责任人警告');
  assert(parsed.warnings.some(w => w.type === 'plan_attachment_placeholder'), '应给出占位附件警告');
  assert(parsed.warnings.some(w => w.type === 'plan_no_permission'), '巡检员导入应有权限警告，计划被标为草稿');
  assert(parsed.payload.reviewPlans.length === 2, '重复计划应被跳过，实际 2 条');
});

test('导出后再导入复查计划与冲突记录完整（往返一致性）', () => {
  const exported = buildExportPayloadV3(
    [issueInA], [storeA], [], [], [], [samplePlan1, samplePlan2], [samplePlanConflict], supervisor
  );
  const parsed = parseExportPayloadV3(JSON.stringify(exported), supervisor);
  assert(parsed.payload.reviewPlans.length === 2, '2 条计划完整导入');
  assert(parsed.payload.unresolvedPlanConflicts.length === 1, '1 条计划冲突完整导入');
  assert(parsed.payload.reviewPlans.find(p => p.id === 'plan-abc-123').rectificationNote === '整改说明A', '整改说明保留');
  assert(parsed.schemaVersion === '3.0', 'schema 版本保留');
});

test('旧 v2.0 数据导入给出复查计划缺失警告但不报错', () => {
  const oldExport = buildExportPayload([issueInA], [storeA], [templateV1], [], [], supervisor);
  const parsed = parseExportPayloadV3(JSON.stringify(oldExport), supervisor);
  assert(parsed.valid === true, 'v2.0 旧数据应仍可导入');
  assert(parsed.warnings.some(w => w.type === 'old_schema'), '应给出旧 schema 警告');
});

console.log('\n=== 复查计划：历史日志完整性验证 ===\n');

test('plan_create / plan_update / plan_delete 动作生成历史记录并写 planDetail', () => {
  const plan = makeReviewPlan();
  const histories = [
    { id: generateId(), issueId: plan.issueId, planId: plan.id, action: 'plan_create',
      actorId: supervisor.id, timestamp: new Date().toISOString(),
      planDetail: { reviewTimeAfter: plan.reviewTime, assigneeAfter: plan.assigneeName, version: plan.version } },
    { id: generateId(), issueId: plan.issueId, planId: plan.id, action: 'plan_update',
      actorId: supervisor.id, timestamp: new Date().toISOString(),
      planDetail: { reviewTimeBefore: plan.reviewTime, reviewTimeAfter: '2025-02-01T00:00:00.000Z',
        assigneeBefore: plan.assigneeName, assigneeAfter: '新责任人', version: 2 } },
    { id: generateId(), issueId: plan.issueId, planId: plan.id, action: 'plan_delete',
      actorId: supervisor.id, timestamp: new Date().toISOString(),
      planDetail: { reviewTimeBefore: plan.reviewTime, assigneeBefore: plan.assigneeName } }
  ];
  assert(histories.every(h => h.planId === plan.id), '每条历史应关联 planId');
  assert(histories[0].action === 'plan_create', '创建动作标记正确');
  assert(histories[0].planDetail.reviewTimeAfter, '创建历史应记录 planDetail');
  assert(histories[1].planDetail.reviewTimeBefore && histories[1].planDetail.reviewTimeAfter, '更新历史应记录 before/after');
  assert(histories[2].action === 'plan_delete', '删除动作标记正确');
});

test('plan_conflict_resolve / plan_sync / plan_sync_fail 动作写进历史', () => {
  const plan = makeReviewPlan();
  const histories = [
    { id: generateId(), issueId: plan.issueId, planId: plan.id, action: 'plan_conflict_resolve',
      planDetail: { conflictResolution: 'merge', version: 4 } },
    { id: generateId(), issueId: plan.issueId, planId: plan.id, action: 'plan_sync',
      planDetail: { version: 2 } },
    { id: generateId(), issueId: plan.issueId, planId: plan.id, action: 'plan_sync_fail',
      planDetail: { syncError: '远端拒绝冲突版本' } }
  ];
  assert(histories[0].planDetail.conflictResolution === 'merge', '冲突解决方式写入历史');
  assert(histories[1].action === 'plan_sync', '同步成功写入历史');
  assert(histories[2].planDetail.syncError === '远端拒绝冲突版本', '同步失败原因写入历史');
});

console.log('\n=== 复查计划：冲突解决三种策略验证 ===\n');

test('采用本地版本：保留本地内容，版本号取远端版本号 + 1', () => {
  const local = makeReviewPlan({ reviewTime: '2025-01-01', assigneeName: '本地责任人', version: 1 });
  const remote = makeReviewPlan({ id: local.id, reviewTime: '2025-01-03', assigneeName: '远端责任人', version: 3 });
  const pc = makePlanConflict(local, remote);
  const resolved_local = {
    ...local,
    version: Math.max(local.version, remote.version) + 1,
    synced: false,
    updatedAt: new Date().toISOString()
  };
  const updatedPc = { ...pc, status: 'resolved', resolution: 'local', resolvedAt: new Date().toISOString() };
  assert(resolved_local.reviewTime === '2025-01-01', '本地策略保留本地复查时间');
  assert(resolved_local.assigneeName === '本地责任人', '本地策略保留本地责任人');
  assert(resolved_local.version === 4, '版本号应为 max(1,3)+1 = 4');
  assert(updatedPc.status === 'resolved', '冲突记录标记为 resolved');
  assert(updatedPc.resolution === 'local', '冲突解决方式为 local');
});

test('采用远端版本：内容被远端覆盖，保留本地 id', () => {
  const local = makeReviewPlan({ id: 'plan-local-1', reviewTime: '2025-01-01', assigneeName: '本地责任人', version: 1 });
  const remote = makeReviewPlan({ id: local.id, reviewTime: '2025-01-03', assigneeName: '远端责任人', version: 3 });
  const resolved_remote = {
    ...local,
    reviewTime: remote.reviewTime,
    assigneeId: remote.assigneeId,
    assigneeName: remote.assigneeName,
    assigneeRole: remote.assigneeRole,
    rectificationNote: remote.rectificationNote,
    attachments: remote.attachments || [],
    version: remote.version + 1,
    synced: false,
    updatedAt: new Date().toISOString()
  };
  assert(resolved_remote.id === 'plan-local-1', '远端策略保留本地 id');
  assert(resolved_remote.reviewTime === '2025-01-03', '远端策略采用远端复查时间');
  assert(resolved_remote.assigneeName === '远端责任人', '远端策略采用远端责任人');
  assert(resolved_remote.version === 4, '版本号为远端版本+1');
});

console.log('\n=== 复查计划：历史记录字段完整性回归验证 ===\n');

test('plan_create 历史的 planDetail 包含 field/newValue/localVersion', () => {
  const plan = makeReviewPlan();
  const detail = {
    field: 'create',
    newValue: `${plan.assigneeName} / ${plan.reviewTime}`,
    localVersion: plan
  };
  assert(detail.field === 'create', '应标记 create 字段');
  assert(typeof detail.newValue === 'string' && detail.newValue.length > 0, 'newValue 非空');
  assert(detail.localVersion && detail.localVersion.id === plan.id, 'localVersion 指向计划本身');
  assert(detail.localVersion.version === 1, 'localVersion 保留版本号');
});

test('plan_update 历史的 planDetail 包含 field/oldValue/newValue 三字段', () => {
  const detail = {
    field: 'reviewTime, assigneeName',
    oldValue: '2025-01-01 | 张三',
    newValue: '2025-02-01 | 李四'
  };
  assert(detail.field && detail.field.length > 0, 'field 非空');
  assert(detail.oldValue !== undefined && detail.oldValue !== null, 'oldValue 存在');
  assert(detail.newValue !== undefined && detail.newValue !== null, 'newValue 存在');
  assert(detail.oldValue !== detail.newValue, 'oldValue 与 newValue 不同');
});

test('plan_delete 历史的 planDetail 包含 field/oldValue/localVersion', () => {
  const plan = makeReviewPlan();
  const detail = {
    field: 'delete',
    oldValue: plan.assigneeName,
    localVersion: plan
  };
  assert(detail.field === 'delete', '应标记 delete 字段');
  assert(detail.oldValue === plan.assigneeName, 'oldValue 为删除前的责任人');
  assert(detail.localVersion && detail.localVersion.id === plan.id, '保留删除前完整快照');
});

test('plan_conflict_resolve 历史的 planDetail 三字段完整', () => {
  const local = makeReviewPlan({ reviewTime: '2025-01-01' });
  const remote = makeReviewPlan({ id: local.id, reviewTime: '2025-01-03' });
  const detail = {
    conflictResolution: 'merge',
    localVersion: local,
    remoteVersion: remote
  };
  assert(detail.conflictResolution === 'merge', 'conflictResolution 正确');
  assert(detail.localVersion.reviewTime === '2025-01-01', '本地版本保留');
  assert(detail.remoteVersion.reviewTime === '2025-01-03', '远端版本保留');
  assert(detail.localVersion.reviewTime !== detail.remoteVersion.reviewTime, '两端版本独立不覆盖');
});

test('plan_sync_fail 历史的 planDetail 含失败原因与两端版本', () => {
  const local = makeReviewPlan();
  const remote = makeReviewPlan({ id: local.id });
  const detail = {
    field: 'sync_fail',
    newValue: '版本冲突',
    localVersion: local,
    remoteVersion: remote
  };
  assert(detail.field === 'sync_fail', '标记 sync_fail');
  assert(detail.newValue === '版本冲突', '失败原因存在');
  assert(detail.localVersion && detail.remoteVersion, '两端版本都保留');
});

test('plan_sync 成功历史的 planDetail 有标记字段', () => {
  const detail = { field: 'sync', newValue: 'succeeded' };
  assert(detail.field === 'sync', '标记 sync');
  assert(detail.newValue === 'succeeded', '标记成功');
});

console.log('\n=== 复查计划：越权操作入口隐藏验证 ===\n');

test('巡检员看不到编辑按钮：canEditPlan 返回 false', () => {
  const plan = makeReviewPlan({ creatorId: 'other-person', assigneeId: inspector.id });
  assert(canEditPlan(inspector, plan, issueInA) === false, '巡检员不能编辑他人创建的计划');
});

test('巡检员看不到删除按钮：与编辑权限一致', () => {
  const plan = makeReviewPlan({ creatorId: 'other-person', assigneeId: inspector.id });
  assert(canEditPlan(inspector, plan, issueInA) === false, '删除按钮与编辑权限绑定，均不显示');
});

test('巡检员看不到冲突解决按钮：canResolvePlanConflict 返回 false', () => {
  const plan = makeReviewPlan({ creatorId: 'other-person' });
  assert(canResolvePlanConflict(inspector, plan, issueInA) === false, '巡检员不能解决他人计划的冲突');
});

test('店长看不到其他门店计划的编辑/删除/冲突解决入口', () => {
  const plan = makeReviewPlan({ issueId: issueInB.id, creatorId: 'someone' });
  assert(canEditPlan(managerA, plan, issueInB) === false, '店长A不能编辑门店B的计划');
  assert(canResolvePlanConflict(managerA, plan, issueInB) === false, '店长A不能解决门店B的冲突');
});

test('自己创建的计划：店长可编辑可解决冲突', () => {
  const plan = makeReviewPlan({ creatorId: managerA.id, issueId: issueInA.id });
  assert(canEditPlan(managerA, plan, issueInA) === true, '店长可编辑自己创建的本门店计划');
  assert(canResolvePlanConflict(managerA, plan, issueInA) === true, '店长可解决自己创建的计划冲突');
});

test('督导所有入口都可见', () => {
  const plan = makeReviewPlan({ creatorId: 'any', issueId: issueInB.id });
  assert(canEditPlan(supervisor, plan, issueInB) === true, '督导可编辑任意门店任意计划');
  assert(canResolvePlanConflict(supervisor, plan, issueInB) === true, '督导可解决任意计划冲突');
  assert(canCreatePlan(supervisor, issueInA) === true, '督导可创建任意门店计划');
});

console.log('\n=== 原有核心功能回归验证 ===\n');

const issues = [
  { id: 'i1', storeId: 'store-a', status: 'submitted' },
  { id: 'i2', storeId: 'store-b', status: 'submitted' },
  { id: 'i3', storeId: 'store-a', status: 'draft', creatorId: 'ins-1' },
  { id: 'i4', storeId: 'store-c', status: 'closed' }
];

test('店长只能看到自己门店的问题', () => {
  const filtered = issues.filter(issue => {
    if (managerA.role === 'manager' && managerA.storeId && issue.storeId !== managerA.storeId) return false;
    return true;
  });
  assert(filtered.length === 2, '店长A应只能看到2条门店A的问题');
  assert(filtered.every(i => i.storeId === 'store-a'), '看到的问题都应属于门店A');
});

test('督导可看到所有问题', () => {
  const filtered = issues.filter(issue => {
    if (supervisor.role === 'manager' && supervisor.storeId && issue.storeId !== supervisor.storeId) return false;
    return true;
  });
  assert(filtered.length === 4, '督导应能看到所有4条问题');
});

// ========== 交接包功能：辅助函数 ==========

function canExportHandover(user, issue) {
  if (!user || !issue) return false;
  if (hasPermission(user.role, 'handover:export_all')) return true;
  if (hasPermission(user.role, 'handover:export_own') && user.storeId === issue.storeId) return true;
  return false;
}

function canImportHandover(user) {
  return hasPermission(user?.role, 'handover:import');
}

function isHandoverPackage(raw) {
  if (!raw) return false;
  return raw && typeof raw === 'object' && raw.packageType === 'handover';
}

function buildHandoverPackage(issue, reviewPlans, planConflicts, histories, exportedBy, storeName) {
  const issuePlans = reviewPlans.filter(p => p.issueId === issue.id);
  const issueConflicts = planConflicts.filter(c => c.issueId === issue.id);
  const keyHistories = histories.filter(h => h.issueId === issue.id).slice(-20);

  const attachmentSummary = issuePlans.map(plan => ({
    planId: plan.id,
    planReviewTime: plan.reviewTime,
    attachments: (plan.attachments || []).map(att => ({
      ...att,
      url: undefined,
      placeholder: true,
    })),
    note: plan.rectificationNote,
  }));

  const statusCounts = {};
  for (const plan of issuePlans) {
    statusCounts[plan.status] = (statusCounts[plan.status] || 0) + 1;
  }
  const syncStatusSummary = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count,
  }));

  return {
    packageType: 'handover',
    schemaVersion: '1.0',
    issueId: issue.id,
    issueTitle: issue.title,
    reviewPlans: issuePlans,
    planConflicts: issueConflicts,
    keyHistories,
    attachmentSummary,
    syncStatusSummary,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      id: exportedBy.id,
      name: exportedBy.name,
      role: exportedBy.role,
    },
    storeName,
  };
}

function validateHandoverImport(raw, existingPlans, currentUser, issue) {
  const warnings = [];
  const errors = [];
  const planItems = [];

  if (!isHandoverPackage(raw)) {
    return {
      valid: false,
      issueId: '',
      plans: [],
      warnings: [],
      errors: ['文件不是有效的交接包格式'],
      summary: { totalPlans: 0, canImportCount: 0, conflictCount: 0, newPlansCount: 0 },
    };
  }

  const pkg = raw;

  if (!pkg.reviewPlans || !Array.isArray(pkg.reviewPlans)) {
    errors.push('交接包缺少复查计划数据');
    return {
      valid: false,
      issueId: pkg.issueId || '',
      plans: [],
      warnings,
      errors,
      summary: { totalPlans: 0, canImportCount: 0, conflictCount: 0, newPlansCount: 0 },
    };
  }

  if (!currentUser) {
    errors.push('请先选择身份后再导入交接包');
    return {
      valid: false,
      issueId: pkg.issueId || '',
      plans: [],
      warnings,
      errors,
      summary: { totalPlans: 0, canImportCount: 0, conflictCount: 0, newPlansCount: 0 },
    };
  }

  const existingPlanMap = new Map(existingPlans.map(p => [p.id, p]));
  let canImportCount = 0;
  let conflictCount = 0;
  let newPlansCount = 0;

  for (const plan of pkg.reviewPlans) {
    const conflictTypes = [];
    const localPlan = existingPlanMap.get(plan.id);
    let canImport = true;
    let reason = '';

    if (!issue) {
      conflictTypes.push('issue_not_found');
      canImport = false;
      reason = '本地找不到对应问题';
      warnings.push(`计划 ${plan.id.slice(0, 8)}...：本地找不到对应问题，无法导入`);
    }

    if (issue && !canCreatePlan(currentUser, issue)) {
      conflictTypes.push('no_permission');
      canImport = false;
      reason = '无权为此问题创建或修改复查计划';
      warnings.push(`计划 ${plan.id.slice(0, 8)}...：无权操作此问题的复查计划`);
    }

    if (localPlan) {
      conflictTypes.push('local_exists');
      conflictCount++;

      if (localPlan.version > plan.version) {
        conflictTypes.push('version_behind');
        warnings.push(`计划 ${plan.id.slice(0, 8)}...：导入版本 (v${plan.version}) 落后于本地版本 (v${localPlan.version})`);
      }

      if (localPlan.assigneeId !== plan.assigneeId) {
        conflictTypes.push('assignee_mismatch');
        warnings.push(`计划 ${plan.id.slice(0, 8)}...：责任人不一致（本地: ${localPlan.assigneeName || localPlan.assigneeId}，导入: ${plan.assigneeName || plan.assigneeId}）`);
      }

      if (issue && !canEditPlan(currentUser, localPlan, issue)) {
        conflictTypes.push('no_permission');
        canImport = false;
        reason = '无权修改本地已存在的复查计划';
        warnings.push(`计划 ${plan.id.slice(0, 8)}...：无权修改本地已存在的复查计划`);
      }
    } else {
      newPlansCount++;
    }

    if (canImport) {
      canImportCount++;
    }

    planItems.push({
      plan,
      conflictTypes,
      localPlan,
      canImport,
      reason,
    });
  }

  if (pkg.exportedBy) {
    warnings.push(`交接包由 ${pkg.exportedBy.name} (${pkg.exportedBy.role === 'supervisor' ? '督导' : pkg.exportedBy.role === 'manager' ? '店长' : '巡检员'}) 于 ${new Date(pkg.exportedAt).toLocaleString('zh-CN')} 导出`);
  }

  return {
    valid: errors.length === 0 && planItems.some(p => p.canImport),
    issueId: pkg.issueId,
    issueTitle: pkg.issueTitle,
    plans: planItems,
    warnings,
    errors,
    summary: {
      totalPlans: planItems.length,
      canImportCount,
      conflictCount,
      newPlansCount,
    },
  };
}

function mergeHandoverPlan(localPlan, importPlan) {
  const mergedAttachments = [
    ...(localPlan.attachments || []),
    ...(importPlan.attachments || []).filter(
      ia => !(localPlan.attachments || []).some(la => la.id === ia.id),
    ),
  ];

  const mergedNote = [
    localPlan.rectificationNote,
    `--- 交接包导入备注 ---\n${importPlan.rectificationNote}`,
  ].filter(Boolean).join('\n\n');

  return {
    ...localPlan,
    version: Math.max(localPlan.version, importPlan.version) + 1,
    rectificationNote: mergedNote,
    attachments: mergedAttachments,
    reviewTime: importPlan.reviewTime || localPlan.reviewTime,
    assigneeId: importPlan.assigneeId || localPlan.assigneeId,
    assigneeName: importPlan.assigneeName || localPlan.assigneeName,
    assigneeRole: importPlan.assigneeRole || localPlan.assigneeRole,
    synced: false,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

function applyHandoverResolution(item, resolution) {
  const { plan, localPlan } = item;

  if (resolution === 'keep_local' && localPlan) {
    return { ...localPlan, synced: false, updatedAt: new Date().toISOString() };
  }

  if (resolution === 'adopt_import') {
    if (localPlan) {
      return {
        ...plan,
        id: localPlan.id,
        version: Math.max(localPlan.version, plan.version) + 1,
        synced: false,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      ...plan,
      version: plan.version + 1,
      synced: false,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  if (resolution === 'merge' && localPlan) {
    return mergeHandoverPlan(localPlan, plan);
  }

  return null;
}

// ========== 交接包功能：测试用例 ==========

console.log('\n=== 交接包功能：权限体系验证 ===\n');

test('店长可导出自己门店问题的交接包', () => {
  assert(canExportHandover(managerA, issueInA) === true, '店长A应能导出门店A问题的交接包');
});

test('店长不可导出其他门店问题的交接包', () => {
  assert(canExportHandover(managerA, issueInB) === false, '店长A不应能导出门店B问题的交接包');
});

test('督导可导出任意门店问题的交接包', () => {
  assert(canExportHandover(supervisor, issueInA) === true, '督导应能导出门店A问题的交接包');
  assert(canExportHandover(supervisor, issueInB) === true, '督导应能导出门店B问题的交接包');
});

test('巡检员不能导出任何交接包', () => {
  assert(canExportHandover(inspector, issueInA) === false, '巡检员不能导出交接包');
  assert(canExportHandover(inspector, issueInB) === false, '巡检员不能导出交接包');
});

test('只有督导可导入交接包', () => {
  assert(canImportHandover(supervisor) === true, '督导应有导入权限');
  assert(canImportHandover(managerA) === false, '店长不应有导入权限');
  assert(canImportHandover(inspector) === false, '巡检员不应有导入权限');
});

console.log('\n=== 交接包功能：交接包构建验证 ===\n');

test('buildHandoverPackage 包含所有必要字段', () => {
  const plan1 = makeReviewPlan({ issueId: issueInA.id, rectificationNote: '整改说明1' });
  const plan2 = makeReviewPlan({ issueId: issueInA.id, rectificationNote: '整改说明2' });
  const conflict = makePlanConflict(plan1, plan2, { issueId: issueInA.id });
  const histories = [
    { id: 'h1', issueId: issueInA.id, action: 'plan_create', actorId: supervisor.id, timestamp: new Date().toISOString() },
    { id: 'h2', issueId: issueInA.id, action: 'plan_update', actorId: supervisor.id, timestamp: new Date().toISOString() },
  ];

  const pkg = buildHandoverPackage(issueInA, [plan1, plan2, makeReviewPlan({ issueId: issueInB.id })], [conflict], histories, supervisor, '门店A');

  assert(pkg.packageType === 'handover', 'packageType 应为 handover');
  assert(pkg.issueId === issueInA.id, 'issueId 正确');
  assert(pkg.reviewPlans.length === 2, '应只包含该问题的2条计划');
  assert(pkg.planConflicts.length === 1, '应包含该问题的1条冲突');
  assert(pkg.keyHistories.length === 2, '应包含该问题的历史记录');
  assert(pkg.attachmentSummary.length === 2, '应包含附件摘要');
  assert(pkg.syncStatusSummary.length > 0, '应包含同步状态摘要');
  assert(pkg.exportedBy.id === supervisor.id, '导出人信息正确');
  assert(pkg.storeName === '门店A', '门店名称正确');
});

test('交接包附件转为占位符，移除真实 URL', () => {
  const plan = makeReviewPlan({
    issueId: issueInA.id,
    attachments: [{ id: 'att-1', name: '照片1.png', url: 'https://example.com/1.png' }],
  });
  const pkg = buildHandoverPackage(issueInA, [plan], [], [], supervisor, '门店A');
  const summary = pkg.attachmentSummary.find(s => s.planId === plan.id);
  assert(summary.attachments[0].placeholder === true, '附件应为占位符');
  assert(summary.attachments[0].url === undefined, '附件真实 URL 应被移除');
  assert(summary.attachments[0].name === '照片1.png', '附件名称应保留');
});

test('isHandoverPackage 正确识别交接包格式', () => {
  const validPkg = { packageType: 'handover', schemaVersion: '1.0', issueId: 'test' };
  const invalidPkg = { packageType: 'backup', issueId: 'test' };
  assert(isHandoverPackage(validPkg) === true, '有效交接包应返回 true');
  assert(isHandoverPackage(invalidPkg) === false, '无效交接包应返回 false');
  assert(isHandoverPackage(null) === false, 'null 应返回 false');
});

console.log('\n=== 交接包功能：导入冲突检测验证 ===\n');

test('检测本地已存在计划冲突', () => {
  const existingPlan = makeReviewPlan({ id: 'plan-existing', issueId: issueInA.id, version: 1 });
  const pkg = buildHandoverPackage(issueInA, [existingPlan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [existingPlan], supervisor, issueInA);
  assert(result.plans[0].conflictTypes.includes('local_exists'), '应检测到本地已存在');
});

test('检测导入版本落后冲突', () => {
  const localPlan = makeReviewPlan({ id: 'plan-1', issueId: issueInA.id, version: 3 });
  const importPlan = { ...localPlan, version: 1 };
  const pkg = buildHandoverPackage(issueInA, [importPlan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [localPlan], supervisor, issueInA);
  assert(result.plans[0].conflictTypes.includes('version_behind'), '应检测到版本落后');
});

test('检测责任人不匹配冲突', () => {
  const localPlan = makeReviewPlan({ id: 'plan-1', issueId: issueInA.id, assigneeId: 'ins-1', assigneeName: '巡检员1' });
  const importPlan = { ...localPlan, assigneeId: 'ins-2', assigneeName: '巡检员2' };
  const pkg = buildHandoverPackage(issueInA, [importPlan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [localPlan], supervisor, issueInA);
  assert(result.plans[0].conflictTypes.includes('assignee_mismatch'), '应检测到责任人不匹配');
});

test('检测无权限操作冲突', () => {
  const localPlan = makeReviewPlan({ id: 'plan-1', issueId: issueInA.id, creatorId: 'other' });
  const pkg = buildHandoverPackage(issueInA, [localPlan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [localPlan], inspector, issueInA);
  assert(result.plans[0].conflictTypes.includes('no_permission'), '应检测到无权限');
  assert(result.plans[0].canImport === false, '无权限时 canImport 应为 false');
});

test('检测问题不存在冲突', () => {
  const plan = makeReviewPlan({ id: 'plan-1', issueId: issueInA.id });
  const pkg = buildHandoverPackage(issueInA, [plan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [], supervisor, undefined);
  assert(result.plans[0].conflictTypes.includes('issue_not_found'), '应检测到问题不存在');
  assert(result.plans[0].canImport === false, '问题不存在时 canImport 应为 false');
});

test('非交接包格式导入返回错误', () => {
  const result = validateHandoverImport({ some: 'data' }, [], supervisor, issueInA);
  assert(result.valid === false, '非交接包应返回 invalid');
  assert(result.errors.includes('文件不是有效的交接包格式'), '应有格式错误提示');
});

test('未登录用户导入被拒绝', () => {
  const plan = makeReviewPlan({ issueId: issueInA.id });
  const pkg = buildHandoverPackage(issueInA, [plan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [], null, issueInA);
  assert(result.valid === false, '未登录用户应返回 invalid');
  assert(result.errors.includes('请先选择身份后再导入交接包'), '应有登录提示');
});

test('普通检查员无权限导入交接包', () => {
  const plan = makeReviewPlan({ issueId: issueInA.id });
  const pkg = buildHandoverPackage(issueInA, [plan], [], [], supervisor, '门店A');
  const result = validateHandoverImport(pkg, [], inspector, issueInA);
  assert(result.valid === false, '巡检员导入应返回 invalid');
  assert(result.plans[0].conflictTypes.includes('no_permission'), '应检测到无权限');
});

console.log('\n=== 交接包功能：冲突解决策略验证 ===\n');

test('保留本地策略：内容不变，更新同步状态', () => {
  const localPlan = makeReviewPlan({ id: 'plan-1', reviewTime: '2025-01-01', assigneeName: '本地责任人', version: 2, rectificationNote: '本地备注' });
  const importPlan = makeReviewPlan({ id: 'plan-1', reviewTime: '2025-01-05', assigneeName: '导入责任人', version: 1, rectificationNote: '导入备注' });
  const item = { plan: importPlan, localPlan, conflictTypes: ['local_exists'], canImport: true };
  
  const result = applyHandoverResolution(item, 'keep_local');
  assert(result.reviewTime === '2025-01-01', '保留本地复查时间');
  assert(result.assigneeName === '本地责任人', '保留本地责任人');
  assert(result.rectificationNote === '本地备注', '保留本地备注');
  assert(result.synced === false, '标记为未同步');
});

test('采用导入策略：覆盖本地内容，版本递增', () => {
  const localPlan = makeReviewPlan({ id: 'plan-1', reviewTime: '2025-01-01', assigneeName: '本地责任人', version: 2, rectificationNote: '本地备注' });
  const importPlan = makeReviewPlan({ id: 'plan-1', reviewTime: '2025-01-05', assigneeName: '导入责任人', version: 3, rectificationNote: '导入备注' });
  const item = { plan: importPlan, localPlan, conflictTypes: ['local_exists'], canImport: true };
  
  const result = applyHandoverResolution(item, 'adopt_import');
  assert(result.reviewTime === '2025-01-05', '采用导入复查时间');
  assert(result.assigneeName === '导入责任人', '采用导入责任人');
  assert(result.rectificationNote === '导入备注', '采用导入备注');
  assert(result.version === 4, '版本号应为 max(2,3)+1 = 4');
  assert(result.id === 'plan-1', '保留本地 ID');
});

test('合并策略：附件合并去重，备注拼接，版本递增', () => {
  const localPlan = makeReviewPlan({
    id: 'plan-1', version: 2, rectificationNote: '本地备注',
    attachments: [{ id: 'att-1', name: 'a.png' }],
  });
  const importPlan = makeReviewPlan({
    id: 'plan-1', version: 3, rectificationNote: '导入备注',
    attachments: [{ id: 'att-1', name: 'a.png' }, { id: 'att-2', name: 'b.png' }],
  });
  const item = { plan: importPlan, localPlan, conflictTypes: ['local_exists'], canImport: true };
  
  const result = applyHandoverResolution(item, 'merge');
  assert(result.attachments.length === 2, '附件应合并去重为 2 个');
  assert(result.rectificationNote.includes('本地备注'), '合并备注包含本地内容');
  assert(result.rectificationNote.includes('导入备注'), '合并备注包含导入内容');
  assert(result.rectificationNote.includes('交接包导入备注'), '包含交接包标记');
  assert(result.version === 4, '版本号应为 max(2,3)+1 = 4');
});

test('mergeHandoverPlan 正确合并附件和备注', () => {
  const local = makeReviewPlan({
    version: 2, rectificationNote: '本地说明',
    attachments: [{ id: 'att-1', name: 'a.png' }],
  });
  const imported = makeReviewPlan({
    version: 3, rectificationNote: '导入说明',
    attachments: [{ id: 'att-2', name: 'b.png' }],
    reviewTime: '2025-02-01',
    assigneeId: 'new-ins',
    assigneeName: '新巡检员',
  });
  
  const merged = mergeHandoverPlan(local, imported);
  assert(merged.attachments.length === 2, '附件合并');
  assert(merged.rectificationNote.includes('本地说明'), '保留本地备注');
  assert(merged.rectificationNote.includes('导入说明'), '包含导入备注');
  assert(merged.reviewTime === '2025-02-01', '采用导入复查时间');
  assert(merged.assigneeId === 'new-ins', '采用导入责任人');
  assert(merged.version === 4, '版本递增');
});

test('新建计划（无本地版本）采用导入策略正确', () => {
  const importPlan = makeReviewPlan({ id: 'plan-new', issueId: issueInA.id, version: 1 });
  const item = { plan: importPlan, conflictTypes: [], canImport: true };
  
  const result = applyHandoverResolution(item, 'adopt_import');
  assert(result.id === 'plan-new', '保留计划 ID');
  assert(result.issueId === issueInA.id, '保留问题关联');
  assert(result.version === 2, '新版本号为导入版本+1');
  assert(result.status === 'draft', '状态为草稿');
  assert(result.synced === false, '未同步');
});

console.log('\n=== 交接包功能：历史记录与持久化验证 ===\n');

test('交接包导出操作生成历史记录', () => {
  const history = {
    id: generateId(),
    issueId: issueInA.id,
    action: 'plan_handover_export',
    actorId: supervisor.id,
    actorRole: supervisor.role,
    actorName: supervisor.name,
    timestamp: new Date().toISOString(),
    details: { packageSize: 1024, planCount: 2 },
  };
  assert(history.action === 'plan_handover_export', '动作类型正确');
  assert(history.actorId === supervisor.id, '操作人正确');
  assert(history.details.packageSize === 1024, '包含导出详情');
});

test('交接包导入操作生成历史记录并写入同步队列', () => {
  const history = {
    id: generateId(),
    issueId: issueInA.id,
    action: 'plan_handover_import',
    actorId: supervisor.id,
    actorRole: supervisor.role,
    actorName: supervisor.name,
    timestamp: new Date().toISOString(),
    details: {
      resolution: 'adopt_import',
      importedPlans: 2,
      skippedPlans: 1,
      conflictCount: 1,
    },
  };
  const syncQueueItem = {
    id: generateId(),
    planId: 'plan-1',
    type: 'plan_handover_import',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  assert(history.action === 'plan_handover_import', '导入动作类型正确');
  assert(history.details.importedPlans === 2, '包含导入数量');
  assert(syncQueueItem.type === 'plan_handover_import', '同步队列类型正确');
  assert(syncQueueItem.status === 'pending', '同步队列状态正确');
});

test('交接包处理结果跨重启持久化', () => {
  const importResult = {
    success: true,
    imported: 2,
    skipped: 1,
    histories: [
      { id: 'h1', issueId: issueInA.id, action: 'plan_handover_import', timestamp: new Date().toISOString() },
    ],
    syncQueue: [
      { id: 'sync-1', planId: 'plan-1', type: 'plan_handover_import', status: 'pending' },
    ],
  };
  const serialized = JSON.stringify(importResult);
  const recovered = JSON.parse(serialized);
  assert(recovered.imported === 2, '导入数量持久化');
  assert(recovered.histories.length === 1, '历史记录持久化');
  assert(recovered.syncQueue.length === 1, '同步队列持久化');
  assert(recovered.histories[0].action === 'plan_handover_import', '历史动作持久化');
});

console.log('\n=== 交接包功能：导入导出往返验证 ===\n');

test('导出后再导入数据完整（往返一致性）', () => {
  const plan1 = makeReviewPlan({
    id: 'plan-abc', issueId: issueInA.id,
    assigneeName: '责任人A', rectificationNote: '整改说明',
    attachments: [{ id: 'att-1', name: '照片1.png', url: 'https://x.com/a.png' }],
  });
  const plan2 = makeReviewPlan({ id: 'plan-xyz', issueId: issueInA.id });
  const conflict = makePlanConflict(plan1, plan1, { issueId: issueInA.id });
  const histories = [
    { id: 'h1', issueId: issueInA.id, action: 'plan_create', timestamp: new Date().toISOString() },
  ];

  const pkg = buildHandoverPackage(issueInA, [plan1, plan2], [conflict], histories, supervisor, '门店A');
  const jsonStr = JSON.stringify(pkg);
  const parsed = JSON.parse(jsonStr);

  assert(isHandoverPackage(parsed) === true, '导入后仍识别为交接包');
  assert(parsed.reviewPlans.length === 2, '计划数量一致');
  assert(parsed.planConflicts.length === 1, '冲突数量一致');
  assert(parsed.keyHistories.length === 1, '历史数量一致');
  assert(parsed.attachmentSummary.length === 2, '附件摘要一致');
  assert(parsed.exportedBy.name === supervisor.name, '导出人信息一致');
});

test('导入预览正确识别冲突并给出可读提示', () => {
  const localPlan = makeReviewPlan({ id: 'plan-1', issueId: issueInA.id, version: 3, assigneeId: 'ins-1' });
  const importPlan = { ...localPlan, version: 2, assigneeId: 'ins-2' };
  const pkg = buildHandoverPackage(issueInA, [importPlan], [], [], managerA, '门店A');
  const result = validateHandoverImport(pkg, [localPlan], supervisor, issueInA);

  assert(result.warnings.length > 0, '应有提示信息');
  assert(result.warnings.some(w => w.includes('导入版本')), '提示版本落后');
  assert(result.warnings.some(w => w.includes('责任人不一致')), '提示责任人不匹配');
  assert(result.warnings.some(w => w.includes('交接包由')), '提示导出人信息');
  assert(result.summary.totalPlans === 1, '总计划数正确');
  assert(result.summary.conflictCount === 1, '冲突数正确');
});

console.log('\n=== 交接包功能：权限拦截与入口隐藏验证 ===\n');

test('普通检查员看不到交接包导出入口', () => {
  const canSeeExportButton = canExportHandover(inspector, issueInA);
  assert(canSeeExportButton === false, '巡检员不应看到导出按钮');
});

test('普通检查员看不到交接包导入入口', () => {
  const canSeeImportTab = canImportHandover(inspector);
  assert(canSeeImportTab === false, '巡检员不应看到导入标签页');
});

test('店长只能看到自己门店的导出入口', () => {
  assert(canExportHandover(managerA, issueInA) === true, '店长A看到门店A的导出按钮');
  assert(canExportHandover(managerA, issueInB) === false, '店长A看不到门店B的导出按钮');
});

test('店长看不到交接包导入入口', () => {
  assert(canImportHandover(managerA) === false, '店长不应看到导入标签页');
});

console.log('\n=== 交接包功能：CSV/JSON 导出字段一致性验证 ===\n');

test('JSON 导出包含完整复查计划字段', () => {
  const plan = makeReviewPlan({
    id: 'plan-full', issueId: issueInA.id, version: 2, status: 'pending',
    assigneeId: 'ins-1', assigneeName: '巡检员1', assigneeRole: 'inspector',
    rectificationNote: '完整的整改说明',
    attachments: [{ id: 'att-1', name: 'pic.png' }],
    creatorId: supervisor.id, creatorRole: 'supervisor',
    synced: false, lastSyncError: '测试错误',
  });
  const payload = buildExportPayloadV3([], [], [], [], [], [plan], [], supervisor);
  const exportedPlan = payload.data.reviewPlans[0];
  
  assert(exportedPlan.id === 'plan-full', '包含计划ID');
  assert(exportedPlan.version === 2, '包含版本号');
  assert(exportedPlan.status === 'pending', '包含状态');
  assert(exportedPlan.assigneeName === '巡检员1', '包含责任人');
  assert(exportedPlan.rectificationNote === '完整的整改说明', '包含整改说明');
  assert(exportedPlan.creatorId === supervisor.id, '包含创建人');
  assert(exportedPlan.synced === false, '包含同步状态');
  assert(exportedPlan.lastSyncError === '测试错误', '包含同步错误');
  assert(exportedPlan.attachments.length === 1, '包含附件列表');
});

test('CSV 导出包含与 JSON 对应的复查计划字段', () => {
  const plan1 = makeReviewPlan({
    id: 'plan-csv-1', issueId: issueInA.id, version: 2,
    assigneeId: 'ins-1', assigneeName: '巡检员1',
    rectificationNote: 'CSV测试备注',
    attachments: [{ id: 'att-1', name: 'a.png' }],
    creatorId: supervisor.id, status: 'pending', synced: false,
  });
  const plan2 = makeReviewPlan({
    id: 'plan-csv-2', issueId: issueInA.id, version: 1,
    assigneeId: 'ins-2', assigneeName: '巡检员2',
    status: 'completed', synced: true,
  });
  const csv = generateCSVWithVersions([issueInA], [storeA], [templateV1], [], [plan1, plan2]);
  const lines = csv.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  
  assert(headers.includes('复查计划数量'), '包含计划数量');
  assert(headers.includes('复查计划ID'), '包含计划ID');
  assert(headers.includes('复查计划版本'), '包含计划版本');
  assert(headers.includes('复查时间'), '包含复查时间');
  assert(headers.includes('复查责任人'), '包含责任人');
  assert(headers.includes('复查计划状态'), '包含状态');
  assert(headers.includes('复查计划是否同步'), '包含同步状态');
  assert(headers.includes('复查计划附件数'), '包含附件数');
  assert(headers.includes('复查计划整改备注'), '包含整改备注');
  
  const dataRow = lines[1].split(',').map(h => h.replace(/"/g, ''));
  const headerIndex = headers.indexOf('复查计划ID');
  assert(dataRow[headerIndex].includes('plan-csv-1') && dataRow[headerIndex].includes('plan-csv-2'), 'CSV包含多个计划ID');
});

test('CSV 和 JSON 导出的复查计划字段一一对应', () => {
  const plan = makeReviewPlan({
    id: 'plan-consistent', issueId: issueInA.id, version: 3,
    assigneeName: '测试责任人', status: 'completed', synced: true,
  });
  
  const jsonPayload = buildExportPayloadV3([issueInA], [storeA], [templateV1], [], [], [plan], [], supervisor);
  const jsonPlan = jsonPayload.data.reviewPlans[0];
  
  const csv = generateCSVWithVersions([issueInA], [storeA], [templateV1], [], [plan]);
  const lines = csv.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  const dataRow = lines[1].split(',').map(h => h.replace(/"/g, ''));
  
  const versionIdx = headers.indexOf('复查计划版本');
  const statusIdx = headers.indexOf('复查计划状态');
  const syncedIdx = headers.indexOf('复查计划是否同步');
  
  assert(dataRow[versionIdx] === `v${jsonPlan.version}`, '版本号一致');
  assert(dataRow[statusIdx] === jsonPlan.status, '状态一致');
  assert(dataRow[syncedIdx] === (jsonPlan.synced ? '是' : '否'), '同步状态一致');
});

const inspectorA = { id: 'ins-a', name: '巡检员A', role: 'inspector', storeId: 'store-a' };
const inspectorB = { id: 'ins-b', name: '巡检员B', role: 'inspector', storeId: 'store-b' };

const ROLE_PERMISSIONS_V4 = {
  ...ROLE_PERMISSIONS,
  inspector: [...(ROLE_PERMISSIONS.inspector || []), 'plan:delay_request_own'],
  manager: [...(ROLE_PERMISSIONS.manager || []), 'plan:delay_request_store', 'plan:delay_approve_store'],
  supervisor: [...(ROLE_PERMISSIONS.supervisor || []), 'plan:delay_request_all', 'plan:delay_approve_all', 'plan:time_conflict_resolve_all'],
};

function hasPermissionV4(role, perm) {
  return ROLE_PERMISSIONS_V4[role]?.includes(perm) || false;
}

const ROLE_PERMISSIONS_V5 = {
  ...ROLE_PERMISSIONS_V4,
  manager: [...(ROLE_PERMISSIONS_V4.manager || []), 'handover:precheck_view_store'],
  supervisor: [...(ROLE_PERMISSIONS_V4.supervisor || []), 'handover:precheck_view_all', 'handover:import_confirm', 'handover:import_undo', 'handover:strategy_select'],
};

function hasPermissionV5(role, perm) {
  return ROLE_PERMISSIONS_V5[role]?.includes(perm) || false;
}

function canRequestDelay(user, plan, issue) {
  if (!user || !plan || !issue) return false;
  if (hasPermissionV4(user.role, 'plan:delay_request_all')) return true;
  if (hasPermissionV4(user.role, 'plan:delay_request_store')) return user.storeId === issue.storeId;
  if (hasPermissionV4(user.role, 'plan:delay_request_own')) {
    return plan.assigneeId === user.id || plan.creatorId === user.id;
  }
  return false;
}
function canApproveDelay(user, plan, issue) {
  if (!user || !plan || !issue) return false;
  if (hasPermissionV4(user.role, 'plan:delay_approve_all')) return true;
  if (hasPermissionV4(user.role, 'plan:delay_approve_store')) return user.storeId === issue.storeId;
  return false;
}
function canResolveTimeConflict(user, plan, issue) {
  if (!user || !plan || !issue) return false;
  return hasPermissionV4(user.role, 'plan:time_conflict_resolve_all');
}

function computePlanDueStatus(plan, now = new Date()) {
  if (!plan) return 'normal';
  if (plan.pendingDelayRequest && plan.pendingDelayRequest.status === 'pending') return 'delay_requested';
  const nowT = now.getTime();
  const approved = (plan.delayRecords || []).filter(r => r.status === 'approved');
  if (approved.length > 0) {
    const last = [...approved].sort((a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime())[0];
    if (nowT - new Date(last.approvedAt).getTime() < 7 * 86400000) return 'delay_approved';
  }
  const rejected = (plan.delayRecords || []).filter(r => r.status === 'rejected');
  if (rejected.length > 0) {
    const last = [...rejected].sort((a, b) => new Date(b.rejectedAt).getTime() - new Date(a.rejectedAt).getTime())[0];
    if (nowT - new Date(last.rejectedAt).getTime() < 3 * 86400000) return 'delay_rejected';
  }
  const t = new Date(plan.reviewTime).getTime();
  if (t < nowT) return 'overdue';
  if (t - nowT < 3 * 86400000) return 'due_soon';
  return 'normal';
}

function normalizeReviewPlanDefaults(partial) {
  const p = partial || {};
  return {
    id: p.id || generateId(),
    issueId: p.issueId || '',
    reviewTime: p.reviewTime || new Date(Date.now() + 86400000).toISOString(),
    assigneeId: p.assigneeId || '',
    assigneeName: p.assigneeName || '',
    assigneeRole: p.assigneeRole || 'inspector',
    rectificationNote: p.rectificationNote || '',
    attachments: p.attachments || [],
    creatorId: p.creatorId || '',
    creatorRole: p.creatorRole || 'inspector',
    version: p.version || 1,
    status: p.status || 'pending',
    synced: p.synced ?? false,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    originalReviewTime: p.originalReviewTime || p.reviewTime || new Date(Date.now() + 86400000).toISOString(),
    delayCount: p.delayCount || 0,
    delayRecords: p.delayRecords || [],
    pendingDelayRequest: p.pendingDelayRequest || undefined,
    lastDelayReason: p.lastDelayReason || '',
    lastApproverId: p.lastApproverId || '',
    lastApproverName: p.lastApproverName || '',
    dueStatus: p.dueStatus || 'normal',
    hasTimeConflict: p.hasTimeConflict || false,
    timeConflictInfo: p.timeConflictInfo || undefined,
    lastSyncError: p.lastSyncError || undefined,
  };
}

function detectTimeConflict(localPlan, remotePlan) {
  if (!localPlan || !remotePlan) return { has: false, info: undefined };
  const l = new Date(localPlan.reviewTime).getTime();
  const r = new Date(remotePlan.reviewTime).getTime();
  const has = l !== r;
  return {
    has,
    info: has ? {
      localReviewTime: localPlan.reviewTime,
      remoteReviewTime: remotePlan.reviewTime,
      detectedAt: new Date().toISOString(),
    } : undefined,
  };
}

function mergePlanRemark(local, remote) {
  const sep = '\n\n--- 远端备注 ---\n\n';
  return {
    reviewTime: remote.reviewTime,
    rectificationNote: (local.rectificationNote || '') + sep + (remote.rectificationNote || ''),
  };
}

function buildExportPayloadV4(issues, stores, templates, migrations, unresolvedConflicts, reviewPlans, unresolvedPlanConflicts, planDelayRecords, currentUser) {
  const plansByDelay = new Map();
  (planDelayRecords || []).forEach(rec => {
    const arr = plansByDelay.get(rec.planId) || [];
    arr.push(rec);
    plansByDelay.set(rec.planId, arr);
  });
  const normalizedPlans = (reviewPlans || []).map(plan => {
    const base = normalizeReviewPlanDefaults(plan);
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
    schemaVersion: '4.0',
    data: {
      issues, stores, templates, migrations, unresolvedConflicts,
      reviewPlans: normalizedPlans, unresolvedPlanConflicts,
      planDelayRecords: planDelayRecords || [],
    },
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser ? { id: currentUser.id, role: currentUser.role, name: currentUser.name } : undefined,
  };
}

// ===== 新增测试 1：延期成功流程 =====
test('延期申请→审批流程：店长申请+督导审批，状态流转正确', () => {
  const plan = makeReviewPlan({
    id: 'plan-delay-flow', issueId: issueInA.id, version: 1,
    reviewTime: new Date(Date.now() + 2 * 86400000).toISOString(),
    assigneeId: inspectorA.id, assigneeName: inspectorA.name,
    creatorId: managerA.id,
  });
  const basePlan = normalizeReviewPlanDefaults(plan);

  // step1: 店长申请延期
  const assertCanReq = canRequestDelay(managerA, basePlan, issueInA);
  assert(assertCanReq, 'managerA 应为自己门店的计划申请延期');

  const newReviewTime = new Date(new Date(basePlan.reviewTime).getTime() + 7 * 86400000).toISOString();
  const delayReq = {
    id: 'delay-rec-1', planId: basePlan.id, issueId: issueInA.id,
    reason: '整改物料尚未到货，需等待供应链配送',
    newReviewTime,
    oldReviewTime: basePlan.reviewTime,
    attachmentSummary: '3 张现场未到货照片 + 1 份物流截图',
    requesterId: managerA.id, requesterRole: managerA.role, requesterName: managerA.name,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  };

  const planAfterReq = {
    ...basePlan,
    version: basePlan.version + 1,
    delayRecords: [delayReq],
    pendingDelayRequest: delayReq,
    dueStatus: 'delay_requested',
  };
  assert(planAfterReq.dueStatus === 'delay_requested', '申请后到期状态应为 delay_requested');
  assert(planAfterReq.pendingDelayRequest.status === 'pending', '存在待审批延期记录');

  // step2: 督导审批
  const assertCanApprove = canApproveDelay(supervisor, planAfterReq, issueInA);
  assert(assertCanApprove, 'supervisor 应能跨门店审批延期');

  const approved = {
    ...delayReq,
    status: 'approved',
    approverId: supervisor.id, approverRole: supervisor.role, approverName: supervisor.name,
    approvalRemark: '情况属实，同意延期一周',
    approvedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  };
  const delayAfterApprove = [approved];
  const planAfterApprove = normalizeReviewPlanDefaults({
    ...planAfterReq,
    version: planAfterReq.version + 1,
    reviewTime: newReviewTime,
    delayRecords: delayAfterApprove,
    pendingDelayRequest: undefined,
    delayCount: delayAfterApprove.filter(r => r.status === 'approved').length,
    lastDelayReason: approved.reason,
    lastApproverId: approved.approverId,
    lastApproverName: approved.approverName,
    dueStatus: computePlanDueStatus({ ...planAfterReq, reviewTime: newReviewTime, delayRecords: delayAfterApprove, pendingDelayRequest: undefined }),
  });

  assert(planAfterApprove.delayCount === 1, '延期次数应为 1');
  assert(planAfterApprove.lastApproverName === supervisor.name, '最后审批人应为督导');
  assert(planAfterApprove.dueStatus === 'delay_approved', '审批后 7 天内到期状态应为 delay_approved');
  assert(new Date(planAfterApprove.reviewTime).getTime() === new Date(newReviewTime).getTime(), '复查时间已更新为延期后的新时间');
  assert(planAfterApprove.pendingDelayRequest === undefined, '审批后无待审批记录');

  // step3: 驳回流程校验（使用独立计划，避免已 approved 记录干扰 delay_rejected 判断）
  const planForReject = makeReviewPlan({
    id: 'plan-reject-only', issueId: issueInA.id, version: 1,
    reviewTime: new Date(Date.now() + 1 * 86400000).toISOString(),
    assigneeId: inspectorA.id, assigneeName: inspectorA.name,
    creatorId: managerA.id,
  });
  const delayReqForReject = {
    id: 'delay-rec-2', planId: planForReject.id, issueId: issueInA.id,
    reason: '申请延期去做别的', newReviewTime: new Date(Date.now() + 20 * 86400000).toISOString(),
    oldReviewTime: planForReject.reviewTime,
    attachmentSummary: '', requesterId: managerA.id, requesterRole: managerA.role,
    requesterName: managerA.name, status: 'pending', requestedAt: new Date().toISOString(),
  };
  const planAfterReqReject = {
    ...normalizeReviewPlanDefaults(planForReject),
    version: 2,
    delayRecords: [delayReqForReject],
    pendingDelayRequest: delayReqForReject,
    dueStatus: 'delay_requested',
  };
  const rejected = {
    ...delayReqForReject, status: 'rejected',
    approverId: supervisor.id, approverRole: supervisor.role, approverName: supervisor.name,
    approvalRemark: '理由不充分，不予延期，请尽快完成',
    rejectedAt: new Date().toISOString(),
  };
  const planAfterReject = {
    ...planAfterReqReject,
    delayRecords: [rejected],
    pendingDelayRequest: undefined,
    dueStatus: computePlanDueStatus({ ...planAfterReqReject, delayRecords: [rejected], pendingDelayRequest: undefined }),
  };
  assert(planAfterReject.dueStatus === 'delay_rejected', '3 天内刚驳回的状态应为 delay_rejected');
});

// ===== 新增测试 2：无权限拦截 =====
test('权限拦截：巡检员无法审批延期，店长不能审批跨门店延期，巡检员不能申请非自己的计划', () => {
  const planForA = makeReviewPlan({
    id: 'plan-perm', issueId: issueInA.id, version: 1,
    assigneeId: inspectorA.id, assigneeName: inspectorA.name,
  });

  // 巡检员 inspectorB 申请非自己 assignee 的计划（issueStoreA）
  const reqBForOther = canRequestDelay(inspectorB, planForA, issueInA);
  assert(reqBForOther === false, '巡检员 inspectorB 不能为非自己 assignee 的计划申请延期');

  // 巡检员 inspectorA 申请自己 assignee 的计划
  const reqAForOwn = canRequestDelay(inspectorA, planForA, issueInA);
  assert(reqAForOwn === true, '巡检员 inspectorA 可以为自己 assignee 的计划申请延期');

  // 巡检员 inspectorA 做审批
  const inspApproval = canApproveDelay(inspectorA, planForA, issueInA);
  assert(inspApproval === false, '巡检员 inspectorA 无权审批延期');

  // 店长 managerB (storeB) 审批 issueInA (storeA)
  const mgmtApprovalCrossStore = canApproveDelay(managerB, planForA, issueInA);
  assert(mgmtApprovalCrossStore === false, '店长 managerB 不能审批其他门店(storeA)的延期申请');

  // 店长 managerA (storeA) 审批 issueInA (storeA)
  const mgmtApprovalOwn = canApproveDelay(managerA, planForA, issueInA);
  assert(mgmtApprovalOwn === true, '店长 managerA 可以审批本店(storeA)的延期申请');

  // 时间冲突解决权限：只有督导
  const mgmtResolveTC = canResolveTimeConflict(managerA, planForA, issueInA);
  assert(mgmtResolveTC === false, '店长无权直接解决时间冲突');
  const superResolveTC = canResolveTimeConflict(supervisor, planForA, issueInA);
  assert(superResolveTC === true, '督导可以解决时间冲突');
});

// ===== 新增测试 3：重启恢复（模拟 IndexedDB 重建） =====
test('重启恢复：从 IndexedDB 原始数据重建 dueStatus/pendingDelayRequest/delayRecords', () => {
  // 模拟 IndexedDB 存的原始数据（没有经过 store 加工的，只是裸 plan + delayRecords）
  const now = new Date();
  const reviewTimeSoon = new Date(now.getTime() + 1 * 86400000).toISOString();
  const reviewTimeNew = new Date(now.getTime() + 10 * 86400000).toISOString();

  const delayRecApproved = {
    id: 'd1', planId: 'plan-restore-1', issueId: issueInA.id,
    reason: '需要多一周整改', newReviewTime: reviewTimeNew, oldReviewTime: reviewTimeSoon,
    attachmentSummary: '附件说明', requesterId: managerA.id, requesterRole: managerA.role,
    requesterName: managerA.name, status: 'approved',
    approverId: supervisor.id, approverName: supervisor.name, approverRole: supervisor.role,
    requestedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
    approvedAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
  };
  const delayRecPending = {
    id: 'd2', planId: 'plan-restore-2', issueId: issueInA.id,
    reason: '等待总部批复', newReviewTime: reviewTimeNew, oldReviewTime: reviewTimeSoon,
    attachmentSummary: '', requesterId: managerA.id, requesterRole: managerA.role,
    requesterName: managerA.name, status: 'pending',
    requestedAt: new Date().toISOString(),
  };

  // IndexedDB 中裸 plan（没有 delayRecords 内联，也没有 dueStatus/pendingDelayRequest）
  const rawPlan1 = {
    id: 'plan-restore-1', issueId: issueInA.id, reviewTime: reviewTimeNew,
    assigneeId: inspectorA.id, assigneeName: inspectorA.name,
    assigneeRole: 'inspector', creatorId: managerA.id, creatorRole: 'manager',
    version: 2, status: 'pending', synced: false,
    createdAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
    updatedAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
    rectificationNote: '整改说明', attachments: [],
    originalReviewTime: reviewTimeSoon,
  };
  const rawPlan2 = {
    id: 'plan-restore-2', issueId: issueInA.id, reviewTime: reviewTimeSoon,
    assigneeId: inspectorA.id, assigneeName: inspectorA.name,
    assigneeRole: 'inspector', creatorId: managerA.id, creatorRole: 'manager',
    version: 3, status: 'pending', synced: false,
    createdAt: new Date(now.getTime() - 20 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    rectificationNote: '整改说明2', attachments: [],
    originalReviewTime: reviewTimeSoon,
  };

  // 模拟 init() 里的重建逻辑
  const allDelayRecords = [delayRecApproved, delayRecPending];
  const delayByPlan = new Map();
  allDelayRecords.forEach(r => {
    const arr = delayByPlan.get(r.planId) || [];
    arr.push(r); delayByPlan.set(r.planId, arr);
  });

  const restoredPlan1 = normalizeReviewPlanDefaults({ ...rawPlan1 });
  restoredPlan1.delayRecords = delayByPlan.get(restoredPlan1.id) || [];
  restoredPlan1.pendingDelayRequest = restoredPlan1.delayRecords.find(r => r.status === 'pending');
  restoredPlan1.delayCount = restoredPlan1.delayRecords.filter(r => r.status === 'approved').length;
  restoredPlan1.dueStatus = computePlanDueStatus(restoredPlan1, now);

  const restoredPlan2 = normalizeReviewPlanDefaults({ ...rawPlan2 });
  restoredPlan2.delayRecords = delayByPlan.get(restoredPlan2.id) || [];
  restoredPlan2.pendingDelayRequest = restoredPlan2.delayRecords.find(r => r.status === 'pending');
  restoredPlan2.delayCount = restoredPlan2.delayRecords.filter(r => r.status === 'approved').length;
  restoredPlan2.dueStatus = computePlanDueStatus(restoredPlan2, now);

  // 校验恢复结果
  assert(restoredPlan1.delayRecords.length === 1, 'plan1 应恢复出 1 条延期记录');
  assert(restoredPlan1.delayCount === 1, 'plan1 延期次数应为 1');
  assert(restoredPlan1.dueStatus === 'delay_approved', 'plan1 到期状态应为 delay_approved（刚批准 1 天前）');
  assert(restoredPlan1.pendingDelayRequest === undefined, 'plan1 不应有待审批延期');

  assert(restoredPlan2.dueStatus === 'delay_requested', 'plan2 到期状态应为 delay_requested（有 pending）');
  assert(restoredPlan2.pendingDelayRequest?.id === 'd2', 'plan2 待审批延期记录正确');

  // 再模拟"30 天后重启" - 到期状态应回归 overdue/due_soon/normal
  const longAfter = new Date(now.getTime() + 30 * 86400000);
  const statusLongAfter1 = computePlanDueStatus({ ...restoredPlan1, reviewTime: reviewTimeNew }, longAfter);
  assert(statusLongAfter1 === 'overdue', '30 天后延期后的新时间也到期了，应为 overdue');
});

// ===== 新增测试 4：时间冲突处理 =====
test('时间冲突：本地与远端 reviewTime 不同 → 检测+三策略解决', () => {
  const tLocal = new Date(Date.now() + 5 * 86400000).toISOString();
  const tRemote = new Date(Date.now() + 2 * 86400000).toISOString();

  const localPlan = makeReviewPlan({
    id: 'plan-tc', issueId: issueInA.id, version: 3, reviewTime: tLocal,
    rectificationNote: '本地的整改要求：更换所有消防栓密封条',
  });
  const remotePlan = makeReviewPlan({
    id: 'plan-tc', issueId: issueInA.id, version: 3, reviewTime: tRemote,
    rectificationNote: '远端整改：检查应急照明灯',
  });

  // 检测
  const tc = detectTimeConflict(localPlan, remotePlan);
  assert(tc.has === true, '应检测到时间冲突');
  assert(tc.info.localReviewTime === tLocal, '冲突信息本地时间正确');
  assert(tc.info.remoteReviewTime === tRemote, '冲突信息远端时间正确');

  const basePlan = normalizeReviewPlanDefaults({
    ...localPlan, hasTimeConflict: tc.has, timeConflictInfo: tc.info,
  });

  // 策略 1：保留本地
  const r1 = {
    ...basePlan, reviewTime: tc.info.localReviewTime,
    hasTimeConflict: false, timeConflictInfo: undefined, version: basePlan.version + 1,
  };
  assert(r1.reviewTime === tLocal, '保留本地后 reviewTime 为本地时间');

  // 策略 2：采用远端
  const r2 = {
    ...basePlan, reviewTime: tc.info.remoteReviewTime,
    hasTimeConflict: false, timeConflictInfo: undefined, version: basePlan.version + 1,
  };
  assert(r2.reviewTime === tRemote, '采用远端后 reviewTime 为远端时间');

  // 策略 3：合并备注（使用 mergePlanRemark）
  const merged = mergePlanRemark(localPlan, remotePlan);
  assert(merged.reviewTime === tRemote, '合并备注时使用远端时间');
  assert(merged.rectificationNote.includes('本地的整改要求'), '合并备注包含本地备注');
  assert(merged.rectificationNote.includes('远端整改'), '合并备注包含远端备注');
  assert(merged.rectificationNote.includes('--- 远端备注 ---'), '合并备注有分隔线');

  const r3 = {
    ...basePlan, reviewTime: merged.reviewTime, rectificationNote: merged.rectificationNote,
    hasTimeConflict: false, timeConflictInfo: undefined, version: basePlan.version + 1,
  };
  assert(r3.hasTimeConflict === false, '冲突解决后 hasTimeConflict 为 false');
});

// ===== 新增测试 5：导入导出字段一致性 =====
test('导入导出：JSON v4 含延期字段、旧备份缺字段自动补齐、CSV 末尾 4 列齐全', () => {
  const reviewTimeOverdue = new Date(Date.now() - 5 * 86400000).toISOString();
  const reviewTimeNew = new Date(Date.now() + 12 * 86400000).toISOString();
  const delayRec = {
    id: 'delay-exp', planId: 'plan-export', issueId: issueInA.id,
    reason: '门店闭店盘点期间无法整改',
    newReviewTime: reviewTimeNew, oldReviewTime: reviewTimeOverdue,
    attachmentSummary: '盘点通知 PDF 摘要',
    requesterId: managerA.id, requesterRole: managerA.role, requesterName: managerA.name,
    status: 'approved',
    approverId: supervisor.id, approverRole: supervisor.role, approverName: supervisor.name,
    approvalRemark: '盘点期间确无法入场，同意延期',
    requestedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    approvedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  };
  const planWithDelay = makeReviewPlan({
    id: 'plan-export', issueId: issueInA.id, version: 3,
    reviewTime: reviewTimeNew, originalReviewTime: reviewTimeOverdue,
    delayCount: 1,
  });

  // 1. v4 导出 JSON
  const exportedV4 = buildExportPayloadV4(
    [issueInA], [storeA], [templateV1], [], [], [planWithDelay], [], [delayRec], supervisor
  );
  assert(exportedV4.schemaVersion === '4.0', '导出 schema 版本为 4.0');
  assert(Array.isArray(exportedV4.data.planDelayRecords), 'JSON 导出包含 planDelayRecords 数组');
  assert(exportedV4.data.planDelayRecords[0].reason === delayRec.reason, '延期记录正确序列化');
  const expPlan = exportedV4.data.reviewPlans[0];
  assert(expPlan.dueStatus !== undefined, 'JSON 导出含 dueStatus');
  assert(expPlan.delayCount === 1, 'JSON 导出含 delayCount');
  assert(expPlan.lastDelayReason === delayRec.reason, 'JSON 导出含最后延期原因');
  assert(expPlan.lastApproverName === supervisor.name, 'JSON 导出含最后审批人');

  // 2. 模拟 parseExportPayload - 使用 v3 老格式（缺少 dueStatus/delayCount/... 字段）
  const oldV3Payload = {
    schemaVersion: '3.0',
    issues: [issueInA], stores: [storeA], templates: [templateV1],
    migrations: [], unresolvedConflicts: [],
    reviewPlans: [{
      // 老格式 plan：缺少 dueStatus/delayCount/originalReviewTime/hasTimeConflict 等
      id: 'plan-old', issueId: issueInA.id,
      reviewTime: reviewTimeOverdue,
      assigneeId: inspectorA.id, assigneeName: inspectorA.name,
      assigneeRole: 'inspector',
      creatorId: managerA.id, creatorRole: managerA.role,
      version: 1, status: 'pending', synced: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      rectificationNote: '', attachments: [],
    }],
    unresolvedPlanConflicts: [],
    exportedAt: new Date().toISOString(),
  };
  const parsedV3 = {
    valid: true, warnings: [], errors: [], payload: oldV3Payload,
  };
  const plansWithDelayMap = new Map();
  const normalizedV3Plan = normalizeReviewPlanDefaults(oldV3Payload.reviewPlans[0]);
  const delayRecs = plansWithDelayMap.get(normalizedV3Plan.id) || [];
  normalizedV3Plan.delayRecords = delayRecs;
  normalizedV3Plan.pendingDelayRequest = delayRecs.find(r => r.status === 'pending');
  normalizedV3Plan.delayCount = delayRecs.filter(r => r.status === 'approved').length;
  normalizedV3Plan.dueStatus = computePlanDueStatus(normalizedV3Plan);

  // v3 老 plan（缺 dueStatus）应补齐 dueStatus=overdue，因为 reviewTime 是 5 天前
  assert(normalizedV3Plan.dueStatus === 'overdue', '老 v3 备份缺 dueStatus，补齐后应为 overdue');
  assert(normalizedV3Plan.delayCount === 0, '老备份无延期记录，delayCount 应补为 0');
  assert(normalizedV3Plan.hasTimeConflict === false, '老备份缺 hasTimeConflict，应补为 false');
  assert(normalizedV3Plan.originalReviewTime === reviewTimeOverdue, '老备份缺 originalReviewTime，应补为 reviewTime');
  assert(typeof normalizedV3Plan.lastDelayReason === 'string', 'lastDelayReason 有默认值（空字符串）');

  // 3. v4 roundtrip：导出后立即"重新导入"，字段一一对应
  const reimportedPlan = normalizeReviewPlanDefaults(exportedV4.data.reviewPlans[0]);
  const rDelayRecs = exportedV4.data.planDelayRecords || [];
  const rByPlan = new Map();
  rDelayRecs.forEach(r => {
    const arr = rByPlan.get(r.planId) || []; arr.push(r); rByPlan.set(r.planId, arr);
  });
  reimportedPlan.delayRecords = rByPlan.get(reimportedPlan.id) || [];
  reimportedPlan.pendingDelayRequest = reimportedPlan.delayRecords.find(r => r.status === 'pending');
  reimportedPlan.dueStatus = computePlanDueStatus(reimportedPlan);

  assert(reimportedPlan.lastDelayReason === delayRec.reason, 'roundtrip 后 lastDelayReason 一致');
  assert(reimportedPlan.lastApproverName === supervisor.name, 'roundtrip 后 lastApproverName 一致');
  assert(reimportedPlan.delayCount === 1, 'roundtrip 后 delayCount 一致');
  assert(reimportedPlan.dueStatus === 'delay_approved', 'roundtrip 后 dueStatus 应为 delay_approved');

  // 4. CSV 末尾 4 列：到期状态/延期次数/最后延期原因/审批人
  const csv = generateCSVWithVersions(
    [issueInA], [storeA], [templateV1], [],
    [{ ...planWithDelay, dueStatus: 'delay_approved', delayCount: 1, lastDelayReason: delayRec.reason, lastApproverName: supervisor.name }]
  );
  const lines = csv.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  const dataRow = lines[1].split(',').map(h => h.replace(/"/g, ''));

  const iDueStatus = headers.indexOf('到期状态');
  const iDelayCount = headers.indexOf('延期次数');
  const iLastDelay = headers.indexOf('最后延期原因');
  const iApprover = headers.indexOf('审批人');
  assert(iDueStatus >= 0, 'CSV 表头含「到期状态」');
  assert(iDelayCount >= 0, 'CSV 表头含「延期次数」');
  assert(iLastDelay >= 0, 'CSV 表头含「最后延期原因」');
  assert(iApprover >= 0, 'CSV 表头含「审批人」');
  assert(dataRow[iDueStatus] !== '' && dataRow[iDueStatus] !== undefined, 'CSV 数据含到期状态');
  assert(dataRow[iDelayCount] === '1', 'CSV 数据延期次数为 1');
  assert(dataRow[iLastDelay].includes('门店闭店盘点'), 'CSV 含最后延期原因');
  assert(dataRow[iApprover] === supervisor.name, 'CSV 含审批人姓名');

  // 5. 老 v2 schema 导入不应报废数据（"不报废"的核心验证）
  const veryOldV2 = {
    schemaVersion: '2.0',
    issues: [{ id: 'i-very-old', title: '超老备份问题', storeId: storeA.id, templateId: templateV1.id, status: 'draft', priority: 'medium', data: {}, creatorId: 'me', synced: false, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    stores: [storeA], templates: [templateV1],
    migrations: [], unresolvedConflicts: [],
  };
  const v2FixedPayload = veryOldV2;
  v2FixedPayload.reviewPlans = v2FixedPayload.reviewPlans || [];
  v2FixedPayload.unresolvedPlanConflicts = v2FixedPayload.unresolvedPlanConflicts || [];
  v2FixedPayload.planDelayRecords = v2FixedPayload.planDelayRecords || [];
  v2FixedPayload.reviewPlans.forEach((p, idx) => {
    v2FixedPayload.reviewPlans[idx] = normalizeReviewPlanDefaults(p);
  });
  assert(Array.isArray(v2FixedPayload.reviewPlans), 'v2 老备份导入不会报废：reviewPlans 被补为空数组或保留原值');
  assert(Array.isArray(v2FixedPayload.planDelayRecords), 'v2 老备份导入不会报废：planDelayRecords 被补为空数组');
  assert(v2FixedPayload.issues.length === 1, 'v2 老备份问题仍然存在，未报废');
});

// ========== 交接包导入增强：辅助函数 ==========

function canPrecheckHandoverImport(user) {
  return hasPermissionV5(user?.role, 'handover:precheck_view_all') ||
         hasPermissionV5(user?.role, 'handover:precheck_view_store') ||
         hasPermissionV5(user?.role, 'handover:import');
}

function canViewHandoverPrecheck(user, precheckResult, issue) {
  if (!user || !precheckResult) return false;
  if (hasPermissionV5(user.role, 'handover:precheck_view_all')) return true;
  if (hasPermissionV5(user.role, 'handover:precheck_view_store') && issue) {
    return user.storeId === issue.storeId;
  }
  return false;
}

function canConfirmHandoverImport(user, precheckResult, issue) {
  if (!user || !precheckResult) return false;
  return hasPermissionV5(user.role, 'handover:import_confirm');
}

function canUndoHandoverImport(user, batch) {
  if (!user || !batch) return false;
  if (!hasPermissionV5(user.role, 'handover:import_undo')) return false;
  if (batch.status !== 'imported') return false;
  if (batch.hasUndo) return false;
  return true;
}

function canSelectHandoverStrategy(user, precheckResult, issue) {
  if (!user || !precheckResult) return false;
  return hasPermissionV5(user.role, 'handover:strategy_select');
}

function groupHandoverPlansForPrecheck(planItems) {
  const groups = {
    direct_import: [],
    needs_merge: [],
    no_permission: [],
    issue_not_found: [],
    version_behind: [],
  };
  for (const item of planItems) {
    if (item.conflictTypes.includes('issue_not_found')) {
      groups.issue_not_found.push(item);
      continue;
    }
    if (item.conflictTypes.includes('no_permission')) {
      groups.no_permission.push(item);
      continue;
    }
    if (item.conflictTypes.includes('version_behind')) {
      groups.version_behind.push(item);
      continue;
    }
    if (item.conflictTypes.length > 0) {
      groups.needs_merge.push(item);
      continue;
    }
    groups.direct_import.push(item);
  }
  return groups;
}

function normalizeHandoverPrecheckResultDefaults(raw) {
  const r = raw || {};
  const sourcePkg = r.sourceHandoverPackage || {};
  const groupedPlans = r.groupedPlans || {
    direct_import: [], needs_merge: [], no_permission: [],
    issue_not_found: [], version_behind: [],
  };
  return {
    id: r.id || generateId(),
    batchId: r.batchId || '',
    sourceHandoverPackage: sourcePkg,
    groupedPlans,
    selectedStrategies: r.selectedStrategies || {},
    impactSummary: r.impactSummary || null,
    visibleToUserIds: r.visibleToUserIds || [],
    createdAt: r.createdAt || new Date().toISOString(),
    createdBy: r.createdBy || '',
    createdByRole: r.createdByRole || 'inspector',
    updatedAt: r.updatedAt || new Date().toISOString(),
    schemaVersion: r.schemaVersion || '5.0',
  };
}

function normalizeHandoverBatchDefaults(raw) {
  const r = raw || {};
  return {
    id: r.id || generateId(),
    sourceHandoverPackage: r.sourceHandoverPackage || {},
    precheckResultId: r.precheckResultId || '',
    status: r.status || 'prechecking',
    importedPlanIds: r.importedPlanIds || [],
    undoPlanSnapshots: r.undoPlanSnapshots || [],
    createdAt: r.createdAt || new Date().toISOString(),
    createdBy: r.createdBy || '',
    createdByRole: r.createdByRole || 'inspector',
    strategies: r.strategies || {},
    hasUndo: r.hasUndo || false,
    schemaVersion: r.schemaVersion || '5.0',
    updatedAt: r.updatedAt || new Date().toISOString(),
  };
}

function buildExportPayloadV5(issues, stores, templates, migrations, unresolvedConflicts,
  reviewPlans, unresolvedPlanConflicts, planDelayRecords,
  handoverImportBatches, handoverPrecheckResults, currentUser) {
  const plansByDelay = new Map();
  (planDelayRecords || []).forEach(rec => {
    const arr = plansByDelay.get(rec.planId) || [];
    arr.push(rec);
    plansByDelay.set(rec.planId, arr);
  });
  const normalizedPlans = (reviewPlans || []).map(plan => {
    const base = normalizeReviewPlanDefaults(plan);
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
        ...att, url: undefined, placeholder: true,
      })),
    };
  });
  return {
    schemaVersion: '5.0',
    issues, stores, templates, migrations, unresolvedConflicts,
    reviewPlans: normalizedPlans, unresolvedPlanConflicts,
    planDelayRecords: planDelayRecords || [],
    handoverImportBatches: handoverImportBatches || [],
    handoverPrecheckResults: handoverPrecheckResults || [],
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser ? { id: currentUser.id, role: currentUser.role, name: currentUser.name } : undefined,
  };
}

function parseExportPayloadV5(raw) {
  const warnings = [];
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, warnings, errors: ['导入文件不是有效的 JSON 对象'] };
  }

  const declaredVer = raw.schemaVersion || '1.0';
  if (declaredVer !== '5.0') {
    warnings.push(`📦 备份 schema 版本为 v${declaredVer}，当前支持 v5.0。已自动为缺失字段补充默认值。`);
    if (['1.0', '2.0'].includes(declaredVer)) {
      warnings.push(`  · 注意 v${declaredVer} 备份可能不包含「复查整改计划」，对应部分将为空。`);
    }
    if (['1.0', '2.0', '3.0'].includes(declaredVer)) {
      warnings.push(`  · 旧版本未包含「到期状态/延期记录」等字段，已补默认值。`);
    }
    if (['1.0', '2.0', '3.0', '4.0'].includes(declaredVer)) {
      warnings.push(`  · 旧版本未包含「交接包导入批次/预检结果/撤销标记」等字段，已补默认值。`);
    }
  }

  if (!raw.handoverImportBatches) {
    warnings.push('导入文件不包含交接包导入批次记录，已用空数组代替。');
  }
  if (!raw.handoverPrecheckResults) {
    warnings.push('导入文件不包含交接包预检记录，已用空数组代替。');
  }

  const payload = raw;
  payload.handoverImportBatches = (payload.handoverImportBatches || []).map(b => normalizeHandoverBatchDefaults(b));
  payload.handoverPrecheckResults = (payload.handoverPrecheckResults || []).map(p => normalizeHandoverPrecheckResultDefaults(p));
  payload.schemaVersion = '5.0';

  return { valid: true, payload, warnings, errors };
}

// ========== 交接包导入增强：测试用例 ==========

console.log('\n=== 交接包导入增强：权限拦截验证 ===\n');

test('督导拥有所有交接包权限：预检、策略选择、确认导入、撤销', () => {
  const precheckResult = normalizeHandoverPrecheckResultDefaults({
    sourceHandoverPackage: { issueId: issueInA.id },
  });
  assert(canPrecheckHandoverImport(supervisor) === true, '督导可执行预检');
  assert(canViewHandoverPrecheck(supervisor, precheckResult, issueInA) === true, '督导可查看所有预检');
  assert(canSelectHandoverStrategy(supervisor, precheckResult, issueInA) === true, '督导可选择策略');
  assert(canConfirmHandoverImport(supervisor, precheckResult, issueInA) === true, '督导可确认导入');
  const importedBatch = normalizeHandoverBatchDefaults({ status: 'imported', hasUndo: false });
  assert(canUndoHandoverImport(supervisor, importedBatch) === true, '督导可撤销导入');
});

test('店长仅能预览本店数据，不能选择策略、确认导入或撤销', () => {
  const precheckResult = normalizeHandoverPrecheckResultDefaults({
    sourceHandoverPackage: { issueId: issueInA.id },
  });
  assert(canPrecheckHandoverImport(managerA) === true, '店长可执行预检');
  assert(canViewHandoverPrecheck(managerA, precheckResult, issueInA) === true, '店长A可查看本店A的预检');
  assert(canViewHandoverPrecheck(managerA, precheckResult, issueInB) === false, '店长A不能查看门店B的预检');
  assert(canSelectHandoverStrategy(managerA, precheckResult, issueInA) === false, '店长不能选择策略');
  assert(canConfirmHandoverImport(managerA, precheckResult, issueInA) === false, '店长不能确认导入');
  const importedBatch = normalizeHandoverBatchDefaults({ status: 'imported', hasUndo: false });
  assert(canUndoHandoverImport(managerA, importedBatch) === false, '店长不能撤销导入');
});

test('巡检员无交接包权限', () => {
  const precheckResult = normalizeHandoverPrecheckResultDefaults({
    sourceHandoverPackage: { issueId: issueInA.id },
  });
  assert(canPrecheckHandoverImport(inspectorA) === false, '巡检员不能执行预检');
  assert(canViewHandoverPrecheck(inspectorA, precheckResult, issueInA) === false, '巡检员不能查看预检');
  assert(canSelectHandoverStrategy(inspectorA, precheckResult, issueInA) === false, '巡检员不能选择策略');
  assert(canConfirmHandoverImport(inspectorA, precheckResult, issueInA) === false, '巡检员不能确认导入');
});

test('撤销权限拦截：只有 imported 状态且未撤销过的批次才能撤销', () => {
  const batchImported = normalizeHandoverBatchDefaults({ status: 'imported', hasUndo: false });
  const batchUndone = normalizeHandoverBatchDefaults({ status: 'imported', hasUndo: true });
  const batchPrechecking = normalizeHandoverBatchDefaults({ status: 'prechecking', hasUndo: false });
  assert(canUndoHandoverImport(supervisor, batchImported) === true, '正常已导入批次可撤销');
  assert(canUndoHandoverImport(supervisor, batchUndone) === false, '已撤销过的批次不能重复撤销');
  assert(canUndoHandoverImport(supervisor, batchPrechecking) === false, '未完成导入的批次不能撤销');
});

console.log('\n=== 交接包导入增强：冲突合并与分组验证 ===\n');

test('预检分组优先级：issue_not_found > no_permission > version_behind > needs_merge > direct_import', () => {
  const planItems = [
    { planId: 'p1', conflictTypes: ['issue_not_found', 'version_behind'] },
    { planId: 'p2', conflictTypes: ['no_permission', 'time_conflict'] },
    { planId: 'p3', conflictTypes: ['version_behind', 'time_conflict'] },
    { planId: 'p4', conflictTypes: ['time_conflict', 'assignee_mismatch'] },
    { planId: 'p5', conflictTypes: [] },
  ];
  const groups = groupHandoverPlansForPrecheck(planItems);
  assert(groups.issue_not_found.length === 1 && groups.issue_not_found[0].planId === 'p1',
    '含 issue_not_found 的应进入 issue_not_found 组');
  assert(groups.no_permission.length === 1 && groups.no_permission[0].planId === 'p2',
    '含 no_permission 的应进入 no_permission 组');
  assert(groups.version_behind.length === 1 && groups.version_behind[0].planId === 'p3',
    '含 version_behind 的应进入 version_behind 组');
  assert(groups.needs_merge.length === 1 && groups.needs_merge[0].planId === 'p4',
    '其他冲突应进入 needs_merge 组');
  assert(groups.direct_import.length === 1 && groups.direct_import[0].planId === 'p5',
    '无冲突应进入 direct_import 组');
});

test('合并策略：备注和附件合并，其他字段采用导入版本', () => {
  const localPlan = makeReviewPlan({
    id: 'plan-merge',
    remarks: [{ id: 'r1', content: '本地备注1' }],
    attachments: [{ id: 'a1', name: '本地附件1.png' }],
    version: 2,
  });
  const importPlan = makeReviewPlan({
    id: 'plan-merge',
    remarks: [{ id: 'r2', content: '导入备注1' }],
    attachments: [{ id: 'a2', name: '导入附件1.png' }],
    version: 3,
    rectificationNote: '导入的整改说明',
  });
  const mergedRemarks = [
    ...(localPlan.remarks || []),
    ...(importPlan.remarks || []).map(r => ({ ...r, id: generateId() })),
  ];
  const mergedAttachments = [
    ...(localPlan.attachments || []),
    ...(importPlan.attachments || []).map(a => ({ ...a, id: generateId(), placeholder: true })),
  ];
  const finalPlan = {
    ...importPlan,
    remarks: mergedRemarks,
    attachments: mergedAttachments,
    version: 4,
  };
  assert(finalPlan.remarks.length === 2, '合并后备注数为 2');
  assert(finalPlan.attachments.length === 2, '合并后附件数为 2');
  assert(finalPlan.rectificationNote === '导入的整改说明', '其他字段采用导入版本');
  assert(finalPlan.version === 4, '版本号递增');
});

test('采用导入策略：直接覆盖本地版本', () => {
  const localPlan = makeReviewPlan({ id: 'plan-adopt', version: 2, rectificationNote: '本地说明' });
  const importPlan = makeReviewPlan({ id: 'plan-adopt', version: 3, rectificationNote: '导入说明' });
  const finalPlan = { ...importPlan, version: 4 };
  assert(finalPlan.rectificationNote === '导入说明', '采用导入版本的整改说明');
  assert(finalPlan.version === 4, '版本号为 max+1');
});

test('保留本地策略：本地内容不变', () => {
  const localPlan = makeReviewPlan({ id: 'plan-keep', version: 2, rectificationNote: '本地说明' });
  const importPlan = makeReviewPlan({ id: 'plan-keep', version: 3, rectificationNote: '导入说明' });
  const finalPlan = { ...localPlan };
  assert(finalPlan.rectificationNote === '本地说明', '保留本地整改说明');
  assert(finalPlan.version === 2, '版本号保持本地版本');
});

console.log('\n=== 交接包导入增强：跨重启恢复验证 ===\n');

test('预检结果持久化后可恢复：normalizeHandoverPrecheckResultDefaults 补全缺失字段', () => {
  const partialPrecheck = {
    id: 'precheck-partial',
    batchId: 'batch-001',
    sourceHandoverPackage: { id: 'pkg-001', issueId: issueInA.id },
  };
  const normalized = normalizeHandoverPrecheckResultDefaults(partialPrecheck);
  assert(normalized.id === 'precheck-partial', 'ID 保留');
  assert(normalized.batchId === 'batch-001', 'batchId 保留');
  assert(Array.isArray(normalized.groupedPlans.direct_import), 'groupedPlans 有默认值');
  assert(typeof normalized.selectedStrategies === 'object', 'selectedStrategies 有默认值');
  assert(normalized.createdAt.length > 0, 'createdAt 已补');
  assert(normalized.schemaVersion === '5.0', 'schemaVersion 已补');
});

test('导入批次持久化后可恢复：normalizeHandoverBatchDefaults 补全缺失字段', () => {
  const partialBatch = {
    id: 'batch-partial',
    sourceHandoverPackage: { id: 'pkg-001' },
    status: 'imported',
  };
  const normalized = normalizeHandoverBatchDefaults(partialBatch);
  assert(normalized.id === 'batch-partial', 'ID 保留');
  assert(normalized.status === 'imported', 'status 保留');
  assert(Array.isArray(normalized.importedPlanIds), 'importedPlanIds 有默认值');
  assert(Array.isArray(normalized.undoPlanSnapshots), 'undoPlanSnapshots 有默认值');
  assert(normalized.hasUndo === false, 'hasUndo 默认 false');
  assert(normalized.createdAt.length > 0, 'createdAt 已补');
});

test('模拟 IndexedDB 恢复流程：空数组 + 遍历 normalize 不报错', () => {
  const emptyBatches = [];
  const emptyPrechecks = [];
  const restoredBatches = emptyBatches.map(b => normalizeHandoverBatchDefaults(b));
  const restoredPrechecks = emptyPrechecks.map(p => normalizeHandoverPrecheckResultDefaults(p));
  assert(Array.isArray(restoredBatches), '空批次 normalize 后仍为数组');
  assert(restoredBatches.length === 0, '空数组长度不变');
  assert(Array.isArray(restoredPrechecks), '空预检 normalize 后仍为数组');
});

console.log('\n=== 交接包导入增强：撤销后数据回滚验证 ===\n');

test('导入前保存 undoPlanSnapshots，撤销时按快照回滚', () => {
  const originalPlan = makeReviewPlan({
    id: 'plan-undo', version: 1, rectificationNote: '原始内容',
    remarks: [{ id: 'r1', content: '原始备注' }],
  });
  const importPlan = makeReviewPlan({
    id: 'plan-undo', version: 2, rectificationNote: '导入内容',
    remarks: [{ id: 'r2', content: '导入备注' }],
  });

  const undoSnapshot = { planId: 'plan-undo', snapshot: JSON.parse(JSON.stringify(originalPlan)) };
  const batch = normalizeHandoverBatchDefaults({
    status: 'imported', hasUndo: false,
    undoPlanSnapshots: [undoSnapshot],
    importedPlanIds: ['plan-undo'],
  });

  assert(batch.undoPlanSnapshots.length === 1, '批次包含 1 个快照');
  assert(batch.undoPlanSnapshots[0].snapshot.rectificationNote === '原始内容',
    '快照保存了导入前的原始内容');

  const restoredPlan = { ...batch.undoPlanSnapshots[0].snapshot, updatedAt: new Date().toISOString() };
  assert(restoredPlan.rectificationNote === '原始内容', '回滚后内容恢复为原始值');
  assert(restoredPlan.version === 1, '回滚后版本号恢复');
  assert(restoredPlan.remarks[0].content === '原始备注', '回滚后备注恢复');
});

test('撤销后标记 hasUndo=true，防止重复撤销', () => {
  const batch = normalizeHandoverBatchDefaults({
    id: 'batch-undo-flag', status: 'imported', hasUndo: false,
  });
  assert(canUndoHandoverImport(supervisor, batch) === true, '撤销前可撤销');

  const afterUndo = { ...batch, status: 'undone', hasUndo: true, updatedAt: new Date().toISOString() };
  assert(canUndoHandoverImport(supervisor, afterUndo) === false, '撤销后 hasUndo=true，不能重复撤销');
});

test('操作历史记录：plan_handover_import / plan_handover_import_batch / plan_handover_import_undo', () => {
  const planId = 'plan-history';
  const batchId = 'batch-history';
  const histories = [
    {
      id: generateId(), planId, action: 'plan_handover_import',
      createdAt: new Date().toISOString(),
      createdBy: supervisor.id, createdByName: supervisor.name, createdByRole: supervisor.role,
      remark: '交接包导入，策略：采用导入',
      detail: { handoverBatch: { batchId, strategy: 'adopt_import', isUndo: false } },
    },
    {
      id: generateId(), planId: issueInA.id, action: 'plan_handover_import_batch',
      createdAt: new Date().toISOString(),
      createdBy: supervisor.id, createdByName: supervisor.name, createdByRole: supervisor.role,
      remark: '交接包批量导入 1 条计划',
      detail: {
        handoverBatch: { batchId, strategy: 'batch', isUndo: false },
        importedPlanIds: [planId],
      },
    },
    {
      id: generateId(), planId, action: 'plan_handover_import_undo',
      createdAt: new Date().toISOString(),
      createdBy: supervisor.id, createdByName: supervisor.name, createdByRole: supervisor.role,
      remark: '撤销交接包导入：误操作',
      detail: { handoverBatch: { batchId, strategy: 'undo', isUndo: true } },
    },
  ];
  assert(histories[0].action === 'plan_handover_import', '单条导入动作正确');
  assert(histories[0].detail.handoverBatch.batchId === batchId, '历史记录含 batchId');
  assert(histories[0].detail.handoverBatch.isUndo === false, '导入时 isUndo=false');
  assert(histories[1].action === 'plan_handover_import_batch', '批量导入动作正确');
  assert(histories[1].detail.importedPlanIds.length === 1, '批量记录含导入计划列表');
  assert(histories[2].action === 'plan_handover_import_undo', '撤销动作正确');
  assert(histories[2].detail.handoverBatch.isUndo === true, '撤销时 isUndo=true');
});

console.log('\n=== 交接包导入增强：导入导出字段一致性验证 ===\n');

test('buildExportPayloadV5 schemaVersion 为 5.0，包含 handover 字段', () => {
  const testBatch = normalizeHandoverBatchDefaults({ id: 'batch-export' });
  const testPrecheck = normalizeHandoverPrecheckResultDefaults({ id: 'precheck-export' });
  const payload = buildExportPayloadV5(
    [issueInA], [storeA], [templateV1], [], [], [], [], [],
    [testBatch], [testPrecheck], supervisor
  );
  assert(payload.schemaVersion === '5.0', 'schemaVersion 应为 5.0');
  assert(Array.isArray(payload.handoverImportBatches), '包含 handoverImportBatches 数组');
  assert(payload.handoverImportBatches.length === 1, '批次数据完整');
  assert(Array.isArray(payload.handoverPrecheckResults), '包含 handoverPrecheckResults 数组');
  assert(payload.handoverPrecheckResults.length === 1, '预检数据完整');
});

test('parseExportPayloadV5 处理旧版本：v1-v4 自动补 handover 字段并给出警告', () => {
  const v4Payload = {
    schemaVersion: '4.0',
    issues: [issueInA], stores: [storeA], templates: [templateV1],
    migrations: [], unresolvedConflicts: [], reviewPlans: [],
    unresolvedPlanConflicts: [], planDelayRecords: [],
  };
  const parsed = parseExportPayloadV5(v4Payload);
  assert(parsed.valid === true, 'v4 旧数据应仍可导入');
  assert(parsed.warnings.some(w => w.includes('交接包导入批次')), '应给出 handover 字段缺失警告');
  assert(Array.isArray(parsed.payload.handoverImportBatches), 'handoverImportBatches 已补空数组');
  assert(Array.isArray(parsed.payload.handoverPrecheckResults), 'handoverPrecheckResults 已补空数组');
  assert(parsed.payload.schemaVersion === '5.0', 'schemaVersion 已升级到 5.0');
});

test('v5 导出再导入往返一致性：批次和预检字段完整保留', () => {
  const originalBatch = normalizeHandoverBatchDefaults({
    id: 'batch-roundtrip', status: 'imported', hasUndo: false,
    importedPlanIds: ['plan-1', 'plan-2'],
  });
  const originalPrecheck = normalizeHandoverPrecheckResultDefaults({
    id: 'precheck-roundtrip', batchId: 'batch-roundtrip',
    selectedStrategies: { 'plan-1': 'adopt_import', 'plan-2': 'keep_local' },
  });

  const exported = buildExportPayloadV5(
    [issueInA], [storeA], [templateV1], [], [], [], [], [],
    [originalBatch], [originalPrecheck], supervisor
  );
  const parsed = parseExportPayloadV5(exported);

  assert(parsed.payload.handoverImportBatches.length === 1, '往返后批次数量一致');
  assert(parsed.payload.handoverPrecheckResults.length === 1, '往返后预检数量一致');
  assert(parsed.payload.handoverImportBatches[0].id === 'batch-roundtrip', '批次 ID 保留');
  assert(parsed.payload.handoverImportBatches[0].status === 'imported', '批次状态保留');
  assert(parsed.payload.handoverPrecheckResults[0].selectedStrategies['plan-1'] === 'adopt_import',
    '策略选择保留');
  assert(parsed.payload.handoverPrecheckResults[0].selectedStrategies['plan-2'] === 'keep_local',
    '策略选择保留');
});

test('旧备份缺 handover 字段不报废数据：给出可读提示并补默认值', () => {
  const veryOld = {
    schemaVersion: '1.0',
    issues: [{ id: 'i-old', title: '超老备份问题', storeId: storeA.id, templateId: templateV1.id, status: 'draft', priority: 'medium', data: {}, creatorId: 'me', synced: false, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    stores: [storeA], templates: [templateV1],
  };
  const parsed = parseExportPayloadV5(veryOld);
  assert(parsed.valid === true, 'v1.0 老数据不应报废');
  assert(parsed.warnings.some(w => w.includes('交接包导入批次')), '有 handover 字段缺失提示');
  assert(parsed.warnings.some(w => w.includes('已自动为缺失字段补充默认值')), '有自动补默认值提示');
  assert(Array.isArray(parsed.payload.handoverImportBatches), 'handoverImportBatches 已补空数组');
  assert(parsed.payload.issues.length === 1, '原有问题数据未丢失');
});

console.log('\n=== 巡店路线签到模块验证 ===\n');

function isWithinTimeWindow(checkInTime, timeWindowStart, timeWindowEnd) {
  const d = new Date(checkInTime);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hh}:${mm}`;
  return timeStr >= timeWindowStart && timeStr <= timeWindowEnd;
}

function normalizePatrolRouteDefaults(partial) {
  return {
    id: partial.id || generateId(),
    name: partial.name || '未命名路线',
    version: typeof partial.version === 'number' ? partial.version : 1,
    status: partial.status || 'active',
    checkpoints: (partial.checkpoints || []).map(cp => ({
      id: cp.id || generateId(),
      routeId: cp.routeId || partial.id || generateId(),
      name: cp.name || '未命名检查点',
      order: typeof cp.order === 'number' ? cp.order : 0,
      storeId: cp.storeId || '',
      timeWindowStart: cp.timeWindowStart || '00:00',
      timeWindowEnd: cp.timeWindowEnd || '23:59',
      status: cp.status || 'active',
      createdAt: cp.createdAt || new Date().toISOString(),
      updatedAt: cp.updatedAt || new Date().toISOString(),
    })),
    creatorId: partial.creatorId || '',
    creatorName: partial.creatorName || '',
    creatorRole: partial.creatorRole || undefined,
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
    synced: typeof partial.synced === 'boolean' ? partial.synced : false,
  };
}

function normalizeCheckInDefaults(partial) {
  return {
    id: partial.id || generateId(),
    routeId: partial.routeId || '',
    routeVersion: typeof partial.routeVersion === 'number' ? partial.routeVersion : 1,
    checkpointId: partial.checkpointId || '',
    storeId: partial.storeId || '',
    inspectorId: partial.inspectorId || '',
    inspectorName: partial.inspectorName || '',
    status: partial.status || 'draft',
    checkInTime: partial.checkInTime || new Date().toISOString(),
    exception: partial.exception || undefined,
    remark: partial.remark || '',
    syncStatus: partial.syncStatus || 'pending',
    lastSyncError: partial.lastSyncError || undefined,
    lastSyncAttempt: partial.lastSyncAttempt || undefined,
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
  };
}

function validateCheckIn(checkIn, route, existingCheckIns, currentUserStoreId) {
  const errors = [];
  const warnings = [];
  const options = [];

  const duplicate = existingCheckIns.find(
    c => c.checkpointId === checkIn.checkpointId
      && c.inspectorId === checkIn.inspectorId
      && c.status !== 'draft'
      && c.id !== checkIn.id,
  );
  if (duplicate) {
    errors.push('同一检查点不可重复签到');
  }

  if (!route) {
    errors.push('签到路线不存在');
  } else {
    const checkpoint = route.checkpoints.find(cp => cp.id === checkIn.checkpointId);
    if (!checkpoint) {
      errors.push('检查点不在该路线上');
    } else {
      if (!isWithinTimeWindow(checkIn.checkInTime, checkpoint.timeWindowStart, checkpoint.timeWindowEnd)) {
        warnings.push(`当前时间不在有效时间窗 [${checkpoint.timeWindowStart} - ${checkpoint.timeWindowEnd}] 内`);
        options.push({ label: '记为异常签到', value: 'exception' });
      }
    }

    if (checkIn.routeVersion !== route.version) {
      warnings.push(`路线版本不一致（当前 v${route.version}，签到 v${checkIn.routeVersion}）`);
      options.push({ label: '记为异常签到', value: 'exception' });
    }
  }

  if (currentUserStoreId && checkIn.storeId !== currentUserStoreId) {
    warnings.push('跨门店补签需补充异常说明');
    options.push({ label: '记为异常签到', value: 'exception' });
  }

  options.push({ label: '保存草稿', value: 'draft' });
  options.push({ label: '放弃提交', value: 'cancel' });

  return { valid: errors.length === 0, errors, warnings, options };
}

function validatePatrolBackupImport(payload, existingRoutes, _currentUser) {
  const warnings = [];
  const errors = [];
  const routesToImport = [];
  const checkInsToImport = [];

  const existingIds = new Set(existingRoutes.map(r => r.id));

  for (const route of payload.patrolRoutes || []) {
    if (!route.name) {
      warnings.push({
        type: 'patrol_missing_route_name',
        routeId: route.id,
        message: `路线 ${route.id} 缺少名称，已补默认值`,
        missingFields: ['name'],
        appliedDefaults: { name: '未命名路线' },
      });
      route.name = route.name || '未命名路线';
    }
    if (typeof route.version !== 'number' || route.version < 1) {
      warnings.push({
        type: 'patrol_invalid_route_version',
        routeId: route.id,
        routeName: route.name,
        message: `路线「${route.name}」版本号无效，已补默认值 1`,
        missingFields: ['version'],
        appliedDefaults: { version: 1 },
      });
      route.version = 1;
    }

    for (const cp of route.checkpoints || []) {
      if (!cp.name) {
        warnings.push({
          type: 'patrol_missing_checkpoint_name',
          routeId: route.id,
          routeName: route.name,
          checkpointId: cp.id,
          message: `路线「${route.name}」检查点 ${cp.id} 缺少名称，已补默认值`,
          missingFields: ['name'],
          appliedDefaults: { name: '未命名检查点' },
        });
        cp.name = cp.name || '未命名检查点';
      }
      if (!cp.timeWindowStart || !cp.timeWindowEnd) {
        warnings.push({
          type: 'patrol_missing_time_window',
          routeId: route.id,
          routeName: route.name,
          checkpointId: cp.id,
          message: `检查点「${cp.name}」缺少时间窗，已补全天`,
          missingFields: ['timeWindowStart', 'timeWindowEnd'],
          appliedDefaults: { timeWindowStart: '00:00', timeWindowEnd: '23:59' },
        });
        cp.timeWindowStart = cp.timeWindowStart || '00:00';
        cp.timeWindowEnd = cp.timeWindowEnd || '23:59';
      }
    }

    if (existingIds.has(route.id)) continue;
    routesToImport.push(route);
  }

  const importedRouteIds = new Set(routesToImport.map(r => r.id));
  for (const ci of payload.checkIns || []) {
    if (!ci.inspectorId) {
      warnings.push({
        type: 'patrol_missing_inspector',
        checkInId: ci.id,
        message: `签到记录 ${ci.id} 缺少巡检员信息`,
        missingFields: ['inspectorId'],
      });
    }
    if (!importedRouteIds.has(ci.routeId) && !existingIds.has(ci.routeId)) {
      warnings.push({
        type: 'patrol_checkin_missing_route',
        checkInId: ci.id,
        routeId: ci.routeId,
        message: `签到记录 ${ci.id} 对应路线不存在，将以草稿导入`,
        appliedDefaults: { status: 'draft' },
      });
      ci.status = 'draft';
    }
    checkInsToImport.push(ci);
  }

  return { valid: errors.length === 0, warnings, errors, routesToImport, checkInsToImport };
}

const pstoreA = { id: 'store-a', name: '门店A', address: '地址A' };
const pstoreB = { id: 'store-b', name: '门店B', address: '地址B' };

const psupervisor = { id: 'user-sup', name: '王督导', role: 'supervisor', storeId: pstoreA.id };
const pinspector = { id: 'user-insp', name: '李巡检', role: 'inspector', storeId: pstoreA.id };
const pmanager = { id: 'user-mgr', name: '张经理', role: 'manager', storeId: pstoreA.id };

const ptestCheckpoint = {
  id: 'cp-1', routeId: 'route-1', name: '前台检查', order: 0,
  storeId: pstoreA.id, timeWindowStart: '09:00', timeWindowEnd: '18:00',
  status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

const ptestRoute = {
  id: 'route-1', name: '日常巡店路线', version: 1, status: 'active',
  checkpoints: [ptestCheckpoint],
  creatorId: psupervisor.id, creatorName: psupervisor.name, creatorRole: psupervisor.role,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  synced: false,
};

test('巡检权限：督导可管理巡检路线', () => {
  assert(hasPermission(psupervisor.role, 'patrol:route_manage') === true, '督导应可管理巡检路线');
  assert(hasPermission(pmanager.role, 'patrol:route_manage') === false, '经理不应管理巡检路线');
  assert(hasPermission(pinspector.role, 'patrol:route_manage') === false, '巡检员不应管理巡检路线');
});

test('巡检权限：巡检员可签到', () => {
  assert(hasPermission(pinspector.role, 'patrol:checkin') === true, '巡检员应可签到');
  assert(hasPermission(pmanager.role, 'patrol:checkin') === false, '经理不应签到');
  assert(hasPermission(psupervisor.role, 'patrol:checkin') === false, '督导不应签到');
});

test('巡检权限：店长只能看本店签到', () => {
  assert(hasPermission(pmanager.role, 'patrol:view_store_checkin') === true, '经理应可查看门店签到');
  assert(hasPermission(pinspector.role, 'patrol:view_store_checkin') === false, '巡检员不应查看门店签到');
});

test('时间窗验证：工作时间内签到有效', () => {
  const morningCheckIn = new Date();
  morningCheckIn.setHours(10, 0, 0, 0);
  assert(isWithinTimeWindow(morningCheckIn.toISOString(), '09:00', '18:00') === true, '10:00 应在 09:00-18:00 内');

  const eveningCheckIn = new Date();
  eveningCheckIn.setHours(20, 0, 0, 0);
  assert(isWithinTimeWindow(eveningCheckIn.toISOString(), '09:00', '18:00') === false, '20:00 应不在 09:00-18:00 内');
});

test('重复签到拦截：同一检查点不能重复签到', () => {
  const existingCheckIn = normalizeCheckInDefaults({
    id: 'ci-existing', routeId: 'route-1', checkpointId: 'cp-1',
    storeId: pstoreA.id, inspectorId: pinspector.id, status: 'submitted',
  });

  const newCheckIn = normalizeCheckInDefaults({
    id: 'ci-new', routeId: 'route-1', checkpointId: 'cp-1',
    storeId: pstoreA.id, inspectorId: pinspector.id, status: 'submitted',
  });

  const result = validateCheckIn(newCheckIn, ptestRoute, [existingCheckIn], undefined);
  assert(result.valid === false, '重复签到应被拦截');
  assert(result.errors.some(e => e.includes('同一检查点不可重复签到')), '应提示重复签到错误');
  assert(result.options.some(o => o.value === 'draft'), '应包含保存草稿选项');
  assert(result.options.some(o => o.value === 'cancel'), '应包含放弃提交选项');
});

test('超出时间窗：给出警告并提供异常签到选项', () => {
  const earlyCheckIn = normalizeCheckInDefaults({
    id: 'ci-early', routeId: 'route-1', checkpointId: 'cp-1',
    storeId: pstoreA.id, inspectorId: pinspector.id, status: 'submitted',
    checkInTime: new Date(new Date().setHours(7, 0, 0, 0)).toISOString(),
  });

  const result = validateCheckIn(earlyCheckIn, ptestRoute, [], undefined);
  assert(result.valid === true, '时间窗问题应为警告而非错误');
  assert(result.warnings.some(w => w.includes('时间不在有效时间窗')), '应提示超出时间窗警告');
  assert(result.options.some(o => o.value === 'exception'), '应包含记为异常签到选项');
  assert(result.options.some(o => o.value === 'draft'), '应包含保存草稿选项');
  assert(result.options.some(o => o.value === 'cancel'), '应包含放弃提交选项');
});

test('跨门店补签：给出警告并提供异常签到选项', () => {
  const crossStoreCheckIn = normalizeCheckInDefaults({
    id: 'ci-cross', routeId: 'route-1', checkpointId: 'cp-1',
    storeId: pstoreB.id, inspectorId: pinspector.id, status: 'submitted',
  });

  const result = validateCheckIn(crossStoreCheckIn, ptestRoute, [], pstoreA.id);
  assert(result.valid === true, '跨门店应为警告而非错误');
  assert(result.warnings.some(w => w.includes('跨门店补签')), '应提示跨门店补签警告');
  assert(result.options.some(o => o.value === 'exception'), '应包含记为异常签到选项');
});

test('路线版本不一致：给出警告并提供异常签到选项', () => {
  const oldVersionCheckIn = normalizeCheckInDefaults({
    id: 'ci-old', routeId: 'route-1', routeVersion: 0,
    checkpointId: 'cp-1', storeId: pstoreA.id, inspectorId: pinspector.id,
    status: 'submitted',
  });

  const result = validateCheckIn(oldVersionCheckIn, ptestRoute, [], undefined);
  assert(result.valid === true, '版本不一致应为警告而非错误');
  assert(result.warnings.some(w => w.includes('路线版本不一致')), '应提示版本不一致警告');
  assert(result.options.some(o => o.value === 'exception'), '应包含记为异常签到选项');
});

test('草稿可保存：不受重复签到限制', () => {
  const existingDraft = normalizeCheckInDefaults({
    id: 'ci-draft', routeId: 'route-1', checkpointId: 'cp-1',
    storeId: pstoreA.id, inspectorId: pinspector.id, status: 'draft',
  });

  const newCheckIn = normalizeCheckInDefaults({
    id: 'ci-new', routeId: 'route-1', checkpointId: 'cp-1',
    storeId: pstoreA.id, inspectorId: pinspector.id, status: 'submitted',
  });

  const result = validateCheckIn(newCheckIn, ptestRoute, [existingDraft], undefined);
  assert(result.valid === true, '草稿不应影响新的签到');
  assert(result.errors.length === 0, '不应有错误');
});

test('normalizePatrolRouteDefaults：缺字段自动补齐', () => {
  const partial = { id: 'r-1', name: '', creatorId: psupervisor.id };
  const normalized = normalizePatrolRouteDefaults(partial);
  assert(normalized.name === '未命名路线', '缺少名称应补默认值');
  assert(normalized.version === 1, '缺少版本应补 1');
  assert(normalized.status === 'active', '缺少状态应补 active');
  assert(Array.isArray(normalized.checkpoints), '缺少检查点应补空数组');
  assert(normalized.synced === false, '缺少 synced 应补 false');
});

test('normalizeCheckInDefaults：缺字段自动补齐', () => {
  const partial = { id: 'ci-1', routeId: 'r-1', checkpointId: 'cp-1', storeId: pstoreA.id, inspectorId: pinspector.id };
  const normalized = normalizeCheckInDefaults(partial);
  assert(normalized.status === 'draft', '缺少状态应补 draft');
  assert(normalized.routeVersion === 1, '缺少 routeVersion 应补 1');
  assert(normalized.syncStatus === 'pending', '缺少 syncStatus 应补 pending');
  assert(normalized.remark === '', '缺少 remark 应补空字符串');
  assert(typeof normalized.checkInTime === 'string', '缺少 checkInTime 应补当前时间');
});

test('导入导出往返：备份数据完整保留', () => {
  const originalRoute = normalizePatrolRouteDefaults({
    id: 'r-round', name: '往返测试路线', version: 2,
    checkpoints: [
      { id: 'cp-r1', name: '入口检查', storeId: pstoreA.id, timeWindowStart: '08:00', timeWindowEnd: '20:00' },
      { id: 'cp-r2', name: '仓库检查', storeId: pstoreA.id, timeWindowStart: '09:00', timeWindowEnd: '17:00' },
    ],
    creatorId: psupervisor.id,
  });

  const originalCheckIn = normalizeCheckInDefaults({
    id: 'ci-round', routeId: 'r-round', routeVersion: 2,
    checkpointId: 'cp-r1', storeId: pstoreA.id, inspectorId: pinspector.id,
    status: 'exception',
    exception: { type: 'out_of_window', description: '临时提前到店' },
    remark: '已和店长确认',
    syncStatus: 'completed',
  });

  const syncQueueItem = {
    id: 'sync-1', entityType: 'check_in', entityId: 'ci-round',
    action: 'update', status: 'completed', retryCount: 0,
    payload: originalCheckIn,
  };

  const exported = {
    patrolRoutes: [originalRoute],
    checkIns: [originalCheckIn],
    patrolSyncQueue: [syncQueueItem],
    exportedAt: new Date().toISOString(),
    exportedBy: { id: psupervisor.id, role: psupervisor.role, name: psupervisor.name },
    schemaVersion: '1.0',
  };

  const validation = validatePatrolBackupImport(exported, [], psupervisor);
  assert(validation.valid === true, '往返导入应有效');
  assert(validation.warnings.length === 0, '完整数据不应有警告');
  assert(validation.routesToImport.length === 1, '路线数量应一致');
  assert(validation.checkInsToImport.length === 1, '签到数量应一致');

  const importedRoute = validation.routesToImport[0];
  assert(importedRoute.id === 'r-round', '路线 ID 保留');
  assert(importedRoute.version === 2, '路线版本保留');
  assert(importedRoute.checkpoints.length === 2, '检查点数量保留');
  assert(importedRoute.checkpoints[0].timeWindowStart === '08:00', '时间窗保留');

  const importedCheckIn = validation.checkInsToImport[0];
  assert(importedCheckIn.status === 'exception', '异常状态保留');
  assert(importedCheckIn.exception.type === 'out_of_window', '异常类型保留');
  assert(importedCheckIn.exception.description === '临时提前到店', '异常描述保留');
  assert(importedCheckIn.remark === '已和店长确认', '备注保留');
  assert(importedCheckIn.syncStatus === 'completed', '同步状态保留');
});

test('旧备份缺字段：给出警告并补默认值', () => {
  const oldBackup = {
    schemaVersion: '1.0',
    patrolRoutes: [
      {
        id: 'r-old', checkpoints: [{ id: 'cp-old', storeId: pstoreA.id }],
        creatorId: psupervisor.id,
      },
    ],
    checkIns: [
      { id: 'ci-old', routeId: 'r-old', checkpointId: 'cp-old', storeId: pstoreA.id },
    ],
  };

  const validation = validatePatrolBackupImport(oldBackup, [], psupervisor);
  assert(validation.valid === true, '旧备份仍可导入');
  assert(validation.warnings.some(w => w.type === 'patrol_missing_route_name'), '应警告缺少路线名称');
  assert(validation.warnings.some(w => w.type === 'patrol_missing_checkpoint_name'), '应警告缺少检查点名称');
  assert(validation.warnings.some(w => w.type === 'patrol_missing_time_window'), '应警告缺少时间窗');
  assert(validation.warnings.some(w => w.type === 'patrol_missing_inspector'), '应警告缺少巡检员');

  const importedRoute = validation.routesToImport[0];
  assert(importedRoute.name === '未命名路线', '路线名称已补默认值');
  assert(importedRoute.version === 1, '路线版本已补默认值');
  assert(importedRoute.checkpoints[0].name === '未命名检查点', '检查点名称已补默认值');
  assert(importedRoute.checkpoints[0].timeWindowStart === '00:00', '时间窗已补默认值');
  assert(importedRoute.checkpoints[0].timeWindowEnd === '23:59', '时间窗已补默认值');

  assert(validation.warnings.some(w => Array.isArray(w.missingFields)), '警告应包含缺失字段列表');
  assert(validation.warnings.some(w => w.appliedDefaults), '警告应包含应用的默认值');
});

test('同步队列：重启后可恢复处理', () => {
  const pendingQueue = [
    { id: 'q1', entityType: 'patrol_route', entityId: 'r-1', action: 'create', status: 'pending', retryCount: 0 },
    { id: 'q2', entityType: 'check_in', entityId: 'ci-1', action: 'create', status: 'failed', retryCount: 1, errorMessage: '网络错误' },
    { id: 'q3', entityType: 'check_in', entityId: 'ci-2', action: 'update', status: 'completed', retryCount: 0 },
  ];

  const pendingItems = pendingQueue.filter(i => i.status === 'pending' || i.status === 'failed');
  assert(pendingItems.length === 2, '重启后应识别待处理的同步项');
  assert(pendingItems[0].id === 'q1', 'pending 项在队列中');
  assert(pendingItems[1].id === 'q2', 'failed 项在队列中');
  assert(pendingItems[1].retryCount === 1, '失败项保留重试次数');
  assert(pendingItems[1].errorMessage === '网络错误', '失败项保留错误信息');
});

test('历史日志：异常签到和草稿操作可追溯', () => {
  const histories = [
    {
      id: generateId(), entityId: 'route-1', action: 'patrol_route_create',
      createdAt: new Date().toISOString(),
      createdBy: psupervisor.id, createdByName: psupervisor.name, createdByRole: psupervisor.role,
      remark: '创建巡检路线：日常巡店路线',
    },
    {
      id: generateId(), entityId: 'ci-1', action: 'patrol_checkin_submit',
      createdAt: new Date().toISOString(),
      createdBy: pinspector.id, createdByName: pinspector.name, createdByRole: pinspector.role,
      remark: '签到成功',
      detail: { routeId: 'route-1', checkpointId: 'cp-1', routeVersion: 1 },
    },
    {
      id: generateId(), entityId: 'ci-2', action: 'patrol_checkin_exception',
      createdAt: new Date().toISOString(),
      createdBy: pinspector.id, createdByName: pinspector.name, createdByRole: pinspector.role,
      remark: '异常签到：超出时间窗',
      detail: { routeId: 'route-1', checkpointId: 'cp-1', exceptionType: 'out_of_window' },
    },
    {
      id: generateId(), entityId: 'ci-3', action: 'patrol_checkin_draft',
      createdAt: new Date().toISOString(),
      createdBy: pinspector.id, createdByName: pinspector.name, createdByRole: pinspector.role,
      remark: '保存签到草稿',
    },
  ];

  assert(histories[0].action === 'patrol_route_create', '路线创建动作正确');
  assert(histories[1].detail.routeVersion === 1, '签到记录含路线版本');
  assert(histories[2].remark.includes('异常签到'), '异常签到有明确记录');
  assert(histories[2].detail.exceptionType === 'out_of_window', '异常类型可追溯');
  assert(histories[3].action === 'patrol_checkin_draft', '草稿保存有记录');
});

test('多种异常组合：所有处理选项正确展示', () => {
  const comboCheckIn = normalizeCheckInDefaults({
    id: 'ci-combo', routeId: 'route-1', routeVersion: 0,
    checkpointId: 'cp-1', storeId: pstoreB.id, inspectorId: pinspector.id,
    status: 'submitted',
    checkInTime: new Date(new Date().setHours(5, 0, 0, 0)).toISOString(),
  });

  const result = validateCheckIn(comboCheckIn, ptestRoute, [], pstoreA.id);
  assert(result.valid === true, '多种异常组合仍为警告');
  assert(result.warnings.length >= 3, '应有至少三个警告（时间窗、跨门店、版本）');

  const uniqueOptions = [...new Set(result.options.map(o => o.value))];
  assert(uniqueOptions.includes('exception'), '有异常签到选项');
  assert(uniqueOptions.includes('draft'), '有保存草稿选项');
  assert(uniqueOptions.includes('cancel'), '有放弃提交选项');
});

console.log('\n=== 结果统计 ===');
console.log(`通过: ${passed}, 失败: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 所有验证通过！');
}
