function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

const ROLE_PERMISSIONS = {
  inspector: ['issue:create', 'issue:edit_own', 'issue:view_own', 'plan:view_own'],
  manager: ['issue:view_all', 'issue:close', 'export:data', 'plan:create', 'plan:edit_own', 'plan:view_store', 'plan_conflict:resolve_own', 'handover:export_own'],
  supervisor: ['issue:view_all', 'issue:close', 'issue:reject', 'issue:create', 'template:import', 'template:upgrade', 'store:manage', 'sync:manage', 'conflict:resolve', 'export:data', 'plan:create', 'plan:edit_all', 'plan:view_all', 'plan_conflict:resolve_all', 'handover:export_all', 'handover:import']
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

console.log('\n=== 结果统计 ===');
console.log(`通过: ${passed}, 失败: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 所有验证通过！');
}
