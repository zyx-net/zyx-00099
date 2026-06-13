import { useState, useRef, useMemo } from 'react';
import { useAppStore } from '@/store';
import { HandoverPrecheckGroup, HandoverPlanItem, HandoverImportPrecheckResult, HandoverImportBatch } from '@/types';
import { formatDate } from '@/utils/helpers';
import {
  canViewHandoverPrecheck, canConfirmHandoverImport,
  canSelectHandoverStrategy, canUndoHandoverImport,
} from '@/utils/permissions';
import {
  Upload, FileJson, CheckCircle, AlertCircle, XCircle, Shield,
  Download, Trash2, ArrowRight, Plus, Minus, Settings2,
  RefreshCw, GitBranch, Database, Package, ClipboardCheck, User,
  Calendar, File, History, Undo2, Eye, Store as StoreIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const GROUP_LABELS: Record<HandoverPrecheckGroup, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  direct_import: { label: '可直接导入', color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: <CheckCircle size={18} className="text-green-600" /> },
  needs_merge: { label: '需要合并', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', icon: <GitBranch size={18} className="text-yellow-600" /> },
  no_permission: { label: '权限不足', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: <Shield size={18} className="text-red-600" /> },
  issue_not_found: { label: '缺关联问题', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: <AlertCircle size={18} className="text-orange-600" /> },
  version_behind: { label: '版本落后', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', icon: <XCircle size={18} className="text-purple-600" /> },
};

const STRATEGY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  adopt_import: { label: '采用导入', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  keep_local: { label: '保留本地', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' },
  merge: { label: '合并备注附件', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
};

function StrategySelector({
  planId,
  currentStrategy,
  disabled,
  onChange,
}: {
  planId: string;
  currentStrategy: 'keep_local' | 'adopt_import' | 'merge';
  disabled: boolean;
  onChange: (planId: string, strategy: 'keep_local' | 'adopt_import' | 'merge') => void;
}) {
  const strategies: Array<{ value: 'keep_local' | 'adopt_import' | 'merge'; label: string; desc: string }> = [
    { value: 'adopt_import', label: '采用导入', desc: '使用导入版本覆盖本地' },
    { value: 'keep_local', label: '保留本地', desc: '保持本地版本不变' },
    { value: 'merge', label: '合并备注附件', desc: '合并双方备注和附件，其他使用导入版本' },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">导入策略：</p>
      <div className="flex flex-wrap gap-2">
        {strategies.map(s => (
          <button
            key={s.value}
            onClick={() => !disabled && onChange(planId, s.value)}
            disabled={disabled}
            className={cn(
              'px-3 py-1.5 text-xs rounded-lg border transition-all',
              currentStrategy === s.value
                ? cn(STRATEGY_LABELS[s.value].bg, STRATEGY_LABELS[s.value].color, 'border-current font-medium')
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
            title={s.desc}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanItemCard({
  item,
  group,
  currentUser,
  issue,
  precheckResult,
  onStrategyChange,
  canEdit,
}: {
  item: HandoverPlanItem;
  group: HandoverPrecheckGroup;
  currentUser: any;
  issue: any;
  precheckResult: HandoverImportPrecheckResult;
  onStrategyChange: (planId: string, strategy: 'keep_local' | 'adopt_import' | 'merge') => void;
  canEdit: boolean;
}) {
  const strategy = precheckResult.selectedStrategies[item.plan.id] || item.selectedResolution || 'adopt_import';

  if (!canViewHandoverPrecheck(currentUser, precheckResult, issue)) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', GROUP_LABELS[group].bg, GROUP_LABELS[group].color)}>
              {GROUP_LABELS[group].label}
            </span>
            {item.conflictTypes.length > 0 && (
              <span className="text-xs text-gray-500">
                冲突类型：{item.conflictTypes.join('、')}
              </span>
            )}
          </div>
          <h4 className="font-medium text-gray-800 mb-1 truncate">
            {item.plan.rectificationNote || item.plan.id}
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
            <div className="flex items-center gap-1">
              <User size={14} />
              <span>责任人：{item.plan.assigneeName || '-'}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar size={14} />
              <span>复查时间：{formatDate(item.plan.reviewTime)}</span>
            </div>
            <div className="flex items-center gap-1">
              <StoreIcon size={14} />
              <span>门店：{issue?.storeId || '-'}</span>
            </div>
            <div className="flex items-center gap-1">
              <File size={14} />
              <span>版本：v{item.plan.version}</span>
            </div>
          </div>
          {item.plan.attachments?.length > 0 && (
            <p className="text-xs text-gray-500">
              <ClipboardCheck size={14} className="inline mr-1" />
              附件：{item.plan.attachments.length} 个
            </p>
          )}
        </div>
        <div className="flex-shrink-0 w-64">
          <StrategySelector
            planId={item.plan.id}
            currentStrategy={strategy}
            disabled={!canEdit}
            onChange={onStrategyChange}
          />
        </div>
      </div>
    </div>
  );
}

function GroupSection({
  group,
  items,
  currentUser,
  issues,
  precheckResult,
  onStrategyChange,
  canEdit,
}: {
  group: HandoverPrecheckGroup;
  items: HandoverPlanItem[];
  currentUser: any;
  issues: any[];
  precheckResult: HandoverImportPrecheckResult;
  onStrategyChange: (planId: string, strategy: 'keep_local' | 'adopt_import' | 'merge') => void;
  canEdit: boolean;
}) {
  if (items.length === 0) return null;

  const groupConfig = GROUP_LABELS[group];
  const visibleItems = items.filter(item => {
    const issue = issues.find(i => i.id === precheckResult.handoverPackage.issueId);
    return canViewHandoverPrecheck(currentUser, precheckResult, issue);
  });

  if (visibleItems.length === 0) return null;

  return (
    <div className={cn('rounded-2xl border-2 overflow-hidden', groupConfig.bg)}>
      <div className="px-6 py-4 border-b border-current border-opacity-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', 'bg-white bg-opacity-60')}>
            {groupConfig.icon}
          </div>
          <div>
            <h3 className={cn('font-bold', groupConfig.color)}>
              {groupConfig.label}
            </h3>
            <p className="text-sm text-gray-600">
              共 {visibleItems.length} 条计划
            </p>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {visibleItems.map(item => (
          <PlanItemCard
            key={item.plan.id}
            item={item}
            group={group}
            currentUser={currentUser}
            issue={issues.find(i => i.id === precheckResult.handoverPackage.issueId)}
            precheckResult={precheckResult}
            onStrategyChange={onStrategyChange}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}

function ImpactSummary({ precheckResult }: { precheckResult: HandoverImportPrecheckResult }) {
  const { groupedPlans, selectedStrategies } = precheckResult;
  const allItems = Object.values(groupedPlans).flat();
  const stats = {
    total: allItems.length,
    directImport: groupedPlans.direct_import.length,
    needsMerge: groupedPlans.needs_merge.length,
    noPermission: groupedPlans.no_permission.length,
    issueNotFound: groupedPlans.issue_not_found.length,
    versionBehind: groupedPlans.version_behind.length,
    willImport: allItems.filter(i => selectedStrategies[i.plan.id] !== 'keep_local').length,
    willKeep: allItems.filter(i => selectedStrategies[i.plan.id] === 'keep_local').length,
  };

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200 p-6">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
        <ClipboardCheck size={20} className="text-blue-600" />
        影响摘要
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
          <p className="text-sm text-gray-600">总计计划</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-green-600">{stats.directImport}</p>
          <p className="text-sm text-gray-600">可直接导入</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-yellow-600">{stats.needsMerge}</p>
          <p className="text-sm text-gray-600">需要合并</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-red-600">{stats.noPermission + stats.issueNotFound + stats.versionBehind}</p>
          <p className="text-sm text-gray-600">存在问题</p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">
              按当前策略，将导入 <span className="font-bold text-blue-600">{stats.willImport}</span> 条，
              保留 <span className="font-bold text-gray-600">{stats.willKeep}</span> 条
            </p>
          </div>
          <div className="flex gap-2">
            <span className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
              导入：{stats.willImport}
            </span>
            <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-medium">
              保留：{stats.willKeep}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LatestBatchCard({
  batch,
  currentUser,
  onUndo,
}: {
  batch: HandoverImportBatch | null;
  currentUser: any;
  onUndo: (remark?: string) => void;
}) {
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const [undoRemark, setUndoRemark] = useState('');

  if (!batch || batch.status !== 'imported') return null;

  const canUndo = canUndoHandoverImport(currentUser, batch);

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl border-2 border-indigo-200 p-6 mb-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
            <History size={22} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-800">最近一次导入</h3>
            <p className="text-sm text-gray-600">
              {formatDate(batch.createdAt)} · {batch.importedPlanIds.length} 条计划
              {batch.hasUndo && <span className="ml-2 text-orange-600">· 已撤销</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!showUndoConfirm && canUndo && (
            <button
              onClick={() => setShowUndoConfirm(true)}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Undo2 size={16} />
              撤销导入
            </button>
          )}
          {showUndoConfirm && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={undoRemark}
                onChange={(e) => setUndoRemark(e.target.value)}
                placeholder="撤销原因（可选）"
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                onClick={() => {
                  onUndo(undoRemark || undefined);
                  setShowUndoConfirm(false);
                  setUndoRemark('');
                }}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                确认撤销
              </button>
              <button
                onClick={() => {
                  setShowUndoConfirm(false);
                  setUndoRemark('');
                }}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HandoverPrecheck() {
  const {
    currentUser, issues, handoverPrecheckResults, currentHandoverPrecheckId,
    precheckHandoverImportBatch, updateHandoverImportStrategy,
    confirmHandoverImportBatch, undoLatestHandoverImport,
    getLatestHandoverImportBatch, getCurrentHandoverPrecheck,
    clearCurrentHandoverPrecheck,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentPrecheck = getCurrentHandoverPrecheck();
  const latestBatch = getLatestHandoverImportBatch();
  const issue = currentPrecheck ? issues.find(i => i.id === currentPrecheck.handoverPackage.issueId) : null;

  const canEdit = currentUser && currentPrecheck && issue
    ? canSelectHandoverStrategy(currentUser, currentPrecheck, issue)
    : false;
  const canConfirm = currentUser && currentPrecheck && issue
    ? canConfirmHandoverImport(currentUser, currentPrecheck, issue)
    : false;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const text = await file.text();
      const rawData = JSON.parse(text);
      await precheckHandoverImportBatch(rawData);
    } catch (error) {
      console.error('上传失败:', error);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleStrategyChange = async (planId: string, strategy: 'keep_local' | 'adopt_import' | 'merge') => {
    await updateHandoverImportStrategy(planId, strategy);
  };

  const handleConfirm = async () => {
    if (!window.confirm('确认导入？此操作将更新本地数据并生成同步队列。')) return;
    setIsProcessing(true);
    try {
      await confirmHandoverImportBatch();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUndo = async (remark?: string) => {
    if (!window.confirm('确认撤销此次导入？此操作将回滚所有变更。')) return;
    setIsProcessing(true);
    try {
      await undoLatestHandoverImport(remark);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <p className="text-gray-500">请先登录</p>
      </div>
    );
  }

  if (!currentPrecheck) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <LatestBatchCard batch={latestBatch} currentUser={currentUser} onUndo={handleUndo} />
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Upload size={36} className="text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">交接包批量预检</h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto">
            上传交接包后，系统将自动预检并按可导入、需合并、权限不足等分组展示，
            您可以逐条选择导入策略，确认后批量导入。
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="px-8 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-xl font-medium transition-colors inline-flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                处理中…
              </>
            ) : (
              <>
                <FileJson size={18} />
                上传交接包
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  const groups: HandoverPrecheckGroup[] = ['issue_not_found', 'no_permission', 'version_behind', 'needs_merge', 'direct_import'];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <LatestBatchCard batch={latestBatch} currentUser={currentUser} onUndo={handleUndo} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
            <Package size={24} className="text-blue-600" />
            交接包预检结果
          </h1>
          <p className="text-gray-500 mt-1">
            交接包：{currentPrecheck.handoverPackage.issueTitle || currentPrecheck.handoverPackage.exportedBy.name + ' ' + formatDate(currentPrecheck.handoverPackage.exportedAt)}
            {issue && <span className="ml-2">· 问题：{issue.title}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={clearCurrentHandoverPrecheck}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors text-sm"
          >
            关闭
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm flex items-center gap-2"
          >
            <RefreshCw size={16} />
            重新上传
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="hidden"
          />
          {canConfirm && (
            <button
              onClick={handleConfirm}
              disabled={isProcessing}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  导入中…
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  确认导入
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {!canConfirm && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
          <Eye size={20} className="text-yellow-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-800">预览模式</p>
            <p className="text-sm text-yellow-600">您当前为店长角色，仅可预览本店数据，无法确认导入。请联系督导操作。</p>
          </div>
        </div>
      )}

      <ImpactSummary precheckResult={currentPrecheck} />

      <div className="space-y-6">
        {groups.map(group => (
          <GroupSection
            key={group}
            group={group}
            items={currentPrecheck.groupedPlans[group]}
            currentUser={currentUser}
            issues={issues}
            precheckResult={currentPrecheck}
            onStrategyChange={handleStrategyChange}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}
