function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

const ROLE_PERMISSIONS = {
  inspector: ['issue:create', 'issue:edit_own', 'issue:view_own'],
  manager: ['issue:view_all', 'issue:close', 'export:data'],
  supervisor: ['issue:view_all', 'issue:close', 'issue:reject', 'issue:create', 'template:import', 'store:manage', 'sync:manage', 'conflict:resolve', 'export:data']
};

function hasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
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

function syncToServer(issue, simulateConflict) {
  const remoteVersion = { ...issue, version: issue.version + 1, title: issue.title + ' (服务器已更新)' };
  if (simulateConflict) {
    return { success: false, conflict: true, remoteVersion };
  }
  return { success: true, version: issue.version + 1 };
}

function createConflict(localVersion, remoteVersion) {
  return {
    id: generateId(),
    issueId: localVersion.id,
    localVersion,
    remoteVersion,
    status: 'pending',
    detectedAt: new Date().toISOString(),
    resolution: null,
    resolvedAt: null,
    resolvedBy: null
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   错误: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

const storeA = { id: 'store-a', name: '门店A', address: '地址A' };
const storeB = { id: 'store-b', name: '门店B', address: '地址B' };

const managerA = { id: 'mgr-a', name: '店长A', role: 'manager', storeId: 'store-a' };
const managerB = { id: 'mgr-b', name: '店长B', role: 'manager', storeId: 'store-b' };
const supervisor = { id: 'sup-1', name: '督导', role: 'supervisor' };
const inspector = { id: 'ins-1', name: '巡检员', role: 'inspector' };

const issueInA = { id: 'issue-1', title: '问题1', storeId: 'store-a', status: 'submitted', version: 1 };
const issueInB = { id: 'issue-2', title: '问题2', storeId: 'store-b', status: 'submitted', version: 1 };

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

console.log('\n=== 冲突链路验证 ===\n');

test('模拟同步冲突会返回冲突标记和远端版本', () => {
  const result = syncToServer(issueInA, true);
  assert(result.success === false, '冲突时 success 应为 false');
  assert(result.conflict === true, 'conflict 应为 true');
  assert(result.remoteVersion, '应包含 remoteVersion');
  assert(result.remoteVersion.version === issueInA.version + 1, '远端版本号应更高');
});

test('冲突保留本地和远端两份完整内容', () => {
  const localVersion = { ...issueInA };
  const remoteVersion = { ...issueInA, version: 2, title: '服务器修改后的标题', description: '服务器增加的描述' };
  const conflict = createConflict(localVersion, remoteVersion);

  assert(conflict.localVersion.id === localVersion.id, '冲突应包含本地版本');
  assert(conflict.remoteVersion.title === '服务器修改后的标题', '冲突应包含远端版本');
  assert(conflict.localVersion.title === '问题1', '本地版本内容不应被远端覆盖');
  assert(conflict.status === 'pending', '冲突状态应为 pending');
  assert(conflict.detectedAt, '应有检测时间');
});

test('非冲突场景同步成功', () => {
  const result = syncToServer(issueInA, false);
  assert(result.success === true, '正常同步应成功');
  assert(result.conflict === undefined, '正常同步不应有冲突');
  assert(result.version === issueInA.version + 1, '版本号应递增');
});

console.log('\n=== 列表过滤验证 ===\n');

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
