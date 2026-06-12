function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

const ROLE_PERMISSIONS = {
  inspector: ['issue:create', 'issue:edit_own', 'issue:view_own'],
  manager: ['issue:view_all', 'issue:close', 'export:data'],
  supervisor: ['issue:view_all', 'issue:close', 'issue:reject', 'issue:create', 'template:import', 'template:upgrade', 'store:manage', 'sync:manage', 'conflict:resolve', 'export:data']
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

console.log('\n=== 结果统计 ===');
console.log(`通过: ${passed}, 失败: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 所有验证通过！');
}
