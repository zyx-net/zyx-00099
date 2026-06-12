import { useState, useRef, useMemo } from 'react';
import { useAppStore, PendingTemplateUpgrade } from '@/store';
import { Store, Template, MigrationOption, FieldDiff, HandoverPlanItem } from '@/types';
import { generateId, formatDate, PLAN_SYNC_STATUS_LABELS, PLAN_SYNC_STATUS_COLORS } from '@/utils/helpers';
import { canUpgradeTemplate, canImportHandover } from '@/utils/permissions';
import {
  Upload, FileJson, Store as StoreIcon, FileText, CheckCircle, AlertCircle, XCircle,
  Download, Trash2, ArrowUp, ArrowDown, ArrowRight, Plus, Minus, Settings2,
  Shield, RefreshCw, GitBranch, Database, Package, ClipboardCheck, User,
  Calendar, File
} from 'lucide-react';
import { cn } from '@/lib/utils';

const sampleStores: Store[] = [
  { id: 'ST001', name: '朝阳路店', address: '北京市朝阳区朝阳路1号', manager: '张店长' },
  { id: 'ST002', name: '海淀区店', address: '北京市海淀区中关村大街2号', manager: '李店长' },
  { id: 'ST003', name: '西城区店', address: '北京市西城区金融街3号', manager: '王店长' },
];

const sampleTemplates: Template[] = [
  {
    id: 'TPL001',
    name: '环境卫生检查',
    version: '1.0',
    createdAt: new Date().toISOString(),
    fields: [
      { key: 'description', label: '问题描述', type: 'textarea', required: true },
      { key: 'location', label: '问题位置', type: 'select', required: true, options: ['入口', '收银台', '货架', '仓库', '洗手间', '其他'] },
      { key: 'severity', label: '严重程度', type: 'select', required: true, options: ['轻微', '一般', '严重'] },
      { key: 'expected', label: '整改要求', type: 'textarea', required: false },
    ]
  },
  {
    id: 'TPL002',
    name: '商品陈列检查',
    version: '1.0',
    createdAt: new Date().toISOString(),
    fields: [
      { key: 'description', label: '问题描述', type: 'textarea', required: true },
      { key: 'category', label: '商品类别', type: 'select', required: true, options: ['食品', '日用品', '家电', '服装', '其他'] },
      { key: 'shelfNumber', label: '货架编号', type: 'text', required: true },
      { key: 'quantity', label: '涉及数量', type: 'number', required: false },
    ]
  },
  {
    id: 'TPL003',
    name: '服务质量检查',
    version: '1.0',
    createdAt: new Date().toISOString(),
    fields: [
      { key: 'description', label: '问题描述', type: 'textarea', required: true },
      { key: 'staffName', label: '涉事员工', type: 'text', required: false },
      { key: 'customerImpact', label: '客户影响', type: 'select', required: true, options: ['无影响', '轻微不满', '投诉', '严重投诉'] },
      { key: 'suggestion', label: '改进建议', type: 'textarea', required: false },
    ]
  },
];

function DiffBadge({ type }: { type: FieldDiff['changeType'] }) {
  const styles: Record<FieldDiff['changeType'], string> = {
    added: 'bg-green-100 text-green-700',
    removed: 'bg-red-100 text-red-700',
    modified: 'bg-yellow-100 text-yellow-700',
    renamed: 'bg-purple-100 text-purple-700',
    unchanged: 'bg-gray-100 text-gray-600',
  };
  const labels: Record<FieldDiff['changeType'], string> = {
    added: '新增',
    removed: '删除',
    modified: '修改',
    renamed: '重命名',
    unchanged: '不变',
  };
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded font-medium', styles[type])}>
      {labels[type]}
    </span>
  );
}

function TemplateUpgradePanel({
  upgrade,
  index,
}: {
  upgrade: PendingTemplateUpgrade;
  index: number;
}) {
  const { setUpgradeOption } = useAppStore();
  const { existing, incoming, diff, selectedOption } = upgrade;

  const options: Array<{ value: MigrationOption; label: string; desc: string; icon: React.ReactNode }> = [
    {
      value: 'keep_old',
      label: '保留旧草稿',
      desc: '已有草稿和待同步问题继续使用旧版本模板，新问题使用新版本',
      icon: <Shield size={18} />,
    },
    {
      value: 'migrate',
      label: '按映射迁移草稿',
      desc: '将所有旧版本问题的数据迁移到新版本模板，按字段映射自动转换',
      icon: <RefreshCw size={18} />,
    },
    {
      value: 'new_only',
      label: '只对新问题生效',
      desc: '草稿保留旧版本，已提交/已关闭问题迁移到新版本',
      icon: <GitBranch size={18} />,
    },
  ];

  return (
    <div className="bg-white rounded-xl border-2 border-yellow-300 overflow-hidden">
      <div className="px-6 py-4 bg-yellow-50 border-b border-yellow-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
            <ArrowUp size={20} className="text-yellow-700" />
          </div>
          <div>
            <h3 className="font-bold text-gray-800">
              模板升级 #{index + 1}: {incoming.name}
            </h3>
            <p className="text-sm text-yellow-700">
              v{existing.version} → v{incoming.version}
              {diff.impactSummary.hasBreakingChanges && (
                <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                  ⚠️ 含破坏性变更
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="text-right text-sm text-gray-600">
          <p>影响 <span className="font-bold text-yellow-700">{diff.impactSummary.draftCountAffected}</span> 个草稿</p>
          <p>影响 <span className="font-bold text-yellow-700">{diff.impactSummary.pendingSyncCountAffected}</span> 个待同步</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div>
          <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
            <Settings2 size={16} />
            字段变更详情
          </h4>
          <div className="bg-gray-50 rounded-lg overflow-hidden border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-24">变更</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">旧字段</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-10"></th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">新字段</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 w-32">说明</th>
                </tr>
              </thead>
              <tbody>
                {diff.fieldDiffs.map((fd, idx) => (
                  <tr key={idx} className={cn(
                    'border-t',
                    fd.changeType === 'added' && 'bg-green-50/50',
                    fd.changeType === 'removed' && 'bg-red-50/50',
                    fd.changeType === 'modified' && 'bg-yellow-50/50',
                    fd.changeType === 'renamed' && 'bg-purple-50/50',
                  )}>
                    <td className="px-4 py-2"><DiffBadge type={fd.changeType} /></td>
                    <td className="px-4 py-2">
                      {fd.oldLabel ? (
                        <div>
                          <span className="font-mono text-xs text-gray-500">{fd.renamedFrom || fd.key}</span>
                          <div className="text-gray-800">{fd.oldLabel}</div>
                          <div className="text-xs text-gray-500">
                            {fd.oldType}{fd.oldRequired ? ' *' : ''}
                          </div>
                        </div>
                      ) : <span className="text-gray-400 italic">（无）</span>}
                    </td>
                    <td className="px-4 py-2 text-center text-gray-400">
                      {fd.changeType !== 'removed' && fd.changeType !== 'unchanged' && <ArrowRight size={16} />}
                    </td>
                    <td className="px-4 py-2">
                      {fd.newLabel ? (
                        <div>
                          <span className="font-mono text-xs text-gray-500">{fd.renamedTo || fd.key}</span>
                          <div className="text-gray-800">{fd.newLabel}</div>
                          <div className="text-xs text-gray-500">
                            {fd.newType}{fd.newRequired ? ' *' : ''}
                          </div>
                        </div>
                      ) : <span className="text-gray-400 italic">（已删除）</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {fd.oldOptions && fd.newOptions &&
                        JSON.stringify(fd.oldOptions) !== JSON.stringify(fd.newOptions) && (
                        <div>选项变更</div>
                      )}
                      {fd.oldType !== fd.newType && fd.oldType && fd.newType && (
                        <div className="text-red-600">类型变更！</div>
                      )}
                      {fd.oldRequired !== fd.newRequired && (
                        <div>必填: {fd.oldRequired ? '是' : '否'} → {fd.newRequired ? '是' : '否'}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
            <Database size={16} />
            选择迁移策略
          </h4>
          <div className="grid grid-cols-3 gap-4">
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => setUpgradeOption(existing.id, opt.value)}
                className={cn(
                  'p-4 rounded-xl border-2 text-left transition-all',
                  selectedOption === opt.value
                    ? 'border-[#1e3a5f] bg-blue-50 ring-2 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center mb-3',
                  selectedOption === opt.value ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-500'
                )}>
                  {opt.icon}
                </div>
                <p className={cn(
                  'font-medium mb-1',
                  selectedOption === opt.value ? 'text-[#1e3a5f]' : 'text-gray-800'
                )}>
                  {opt.label}
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HandoverPlanRow({ item, index, resolution, onResolutionChange }: {
  item: HandoverPlanItem;
  index: number;
  resolution?: 'keep_local' | 'adopt_import' | 'merge';
  onResolutionChange: (res: 'keep_local' | 'adopt_import' | 'merge') => void;
}) {
  const conflictLabels: Record<string, { label: string; color: string }> = {
    local_exists: { label: '本地已存在', color: 'bg-yellow-100 text-yellow-700' },
    version_behind: { label: '导入版本较旧', color: 'bg-orange-100 text-orange-700' },
    assignee_mismatch: { label: '责任人不匹配', color: 'bg-purple-100 text-purple-700' },
    no_permission: { label: '无操作权限', color: 'bg-red-100 text-red-700' },
    issue_not_found: { label: '问题不存在', color: 'bg-gray-100 text-gray-700' },
  };

  return (
    <div className={cn(
      'p-4 hover:bg-gray-50 transition-colors',
      !item.canImport && 'bg-gray-50 opacity-75'
    )}>
      <div className="flex items-start gap-4">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 text-blue-600 font-medium text-sm">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-800">
              复查计划 - {formatDate(item.plan.reviewTime)}
            </h4>
            {item.conflictTypes.length > 0 && item.conflictTypes.map(ct => (
              <span key={ct} className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                conflictLabels[ct]?.color || 'bg-gray-100 text-gray-700'
              )}>
                {conflictLabels[ct]?.label || ct}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              复查时间：{formatDate(item.plan.reviewTime)}
            </span>
            <span className="flex items-center gap-1">
              <User size={12} />
              责任人：{item.plan.assigneeName || item.plan.assigneeId || '未指定'}
            </span>
            {item.localPlan && (
              <span className="flex items-center gap-1">
                <File size={12} />
                本地版本 v{item.localPlan.version} vs 导入 v{item.plan.version}
              </span>
            )}
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              PLAN_SYNC_STATUS_COLORS[item.plan.status] || 'bg-gray-100 text-gray-600'
            )}>
              {PLAN_SYNC_STATUS_LABELS[item.plan.status] || item.plan.status}
            </span>
          </div>

          {item.canImport && item.conflictTypes.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-gray-600">处理策略：</span>
              <div className="flex gap-1">
                <button
                  onClick={() => onResolutionChange('keep_local')}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md border transition-colors',
                    resolution === 'keep_local'
                      ? 'bg-gray-700 text-white border-gray-700'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  )}
                >
                  保留本地
                </button>
                <button
                  onClick={() => onResolutionChange('adopt_import')}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md border transition-colors',
                    resolution === 'adopt_import'
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  )}
                >
                  采用导入
                </button>
                <button
                  onClick={() => onResolutionChange('merge')}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md border transition-colors',
                    resolution === 'merge'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  )}
                >
                  合并备注/附件
                </button>
              </div>
            </div>
          )}

          {!item.canImport && item.reason && (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
              <XCircle size={12} />
              {item.reason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConfigImport() {
  const {
    stores, templates, importStores, importTemplates, addToast,
    currentUser, pendingUpgrades, confirmTemplateUpgrades, cancelPendingUpgrades,
    importBackup, lastImportValidation, migrations,
    previewHandoverImport, confirmHandoverImport, clearHandoverValidation,
    lastHandoverValidation, reviewPlans,
  } = useAppStore();
  const [activeTab, setActiveTab] = useState<'stores' | 'templates' | 'handover'>('stores');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const handoverInputRef = useRef<HTMLInputElement>(null);
  const [handoverResolutions, setHandoverResolutions] = useState<Record<string, 'keep_local' | 'adopt_import' | 'merge'>>({});

  const canUpgrade = useMemo(() => canUpgradeTemplate(currentUser), [currentUser]);
  const canHandoverImport = useMemo(() => canImportHandover(currentUser), [currentUser]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (activeTab === 'stores') {
          const storesData = Array.isArray(data) ? data : data.stores;
          if (!Array.isArray(storesData)) {
            throw new Error('门店数据格式不正确');
          }
          importStores(storesData);
        } else {
          const templatesData = Array.isArray(data) ? data : data.templates;
          if (!Array.isArray(templatesData)) {
            throw new Error('模板数据格式不正确');
          }
          if (!canUpgrade) {
            addToast('error', '仅督导可导入模板，请切换到督导身份');
            return;
          }
          importTemplates(templatesData);
        }
      } catch (err) {
        addToast('error', '文件解析失败，请检查 JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleBackupUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const result = await importBackup(data);
        if (result.success) {
          addToast('success', `备份导入成功，共 ${result.warnings.length} 条提示`);
        } else {
          addToast('error', `备份导入失败：${result.errors.join('；')}`);
        }
      } catch (err) {
        addToast('error', '备份文件解析失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleHandoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const result = previewHandoverImport(data);
        if (result && result.plans.length > 0) {
          const defaultResolutions: Record<string, 'keep_local' | 'adopt_import' | 'merge'> = {};
          for (const plan of result.plans) {
            if (!plan.canImport) continue;
            if (plan.conflictTypes.length > 0) {
              defaultResolutions[plan.plan.id] = 'adopt_import';
            } else {
              defaultResolutions[plan.plan.id] = 'adopt_import';
            }
          }
          setHandoverResolutions(defaultResolutions);
        }
      } catch (err) {
        addToast('error', '交接包文件解析失败，请检查 JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmHandoverImport = async () => {
    if (!lastHandoverValidation) return;
    const result = await confirmHandoverImport(handoverResolutions);
    if (result.success) {
      setHandoverResolutions({});
    }
  };

  const handleCancelHandover = () => {
    clearHandoverValidation();
    setHandoverResolutions({});
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/json') {
      const input = document.createElement('input');
      input.type = 'file';
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleFileUpload({ target: input } as React.ChangeEvent<HTMLInputElement>);
    } else {
      addToast('error', '请上传 JSON 格式文件');
    }
  };

  const loadSampleData = () => {
    if (activeTab === 'stores') {
      importStores(sampleStores);
    } else {
      if (!canUpgrade) {
        addToast('error', '仅督导可导入模板');
        return;
      }
      importTemplates(sampleTemplates);
    }
  };

  const downloadSample = () => {
    const data = activeTab === 'stores' ? sampleStores : sampleTemplates;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sample-${activeTab === 'stores' ? 'stores' : 'templates'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (pendingUpgrades.length > 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">模板升级确认</h2>
            <p className="text-sm text-gray-500 mt-1">
              检测到 {pendingUpgrades.length} 个模板新版本，请确认迁移策略
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={cancelPendingUpgrades}
              className="px-5 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消升级
            </button>
            <button
              onClick={confirmTemplateUpgrades}
              disabled={!canUpgrade}
              className="px-5 py-2.5 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors font-medium flex items-center gap-2 disabled:opacity-50"
            >
              <CheckCircle size={18} />
              确认升级并迁移
            </button>
          </div>
        </div>

        {!canUpgrade && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Shield size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">
                仅督导可确认模板升级。当前身份为
                <span className="font-medium">
                  {currentUser?.role === 'manager' ? '店长' : currentUser?.role === 'inspector' ? '巡检员' : '未知'}
                </span>
                ，请先切换到督导身份。
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {pendingUpgrades.map((u, idx) => (
            <TemplateUpgradePanel key={u.existing.id} upgrade={u} index={idx} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('stores')}
          className={cn(
            'flex items-center gap-2 px-6 py-3 font-medium border-b-2 transition-colors',
            activeTab === 'stores'
              ? 'border-[#1e3a5f] text-[#1e3a5f]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <StoreIcon size={18} />
          门店清单
          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{stores.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={cn(
            'flex items-center gap-2 px-6 py-3 font-medium border-b-2 transition-colors',
            activeTab === 'templates'
              ? 'border-[#1e3a5f] text-[#1e3a5f]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <FileText size={18} />
          检查模板
          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{templates.length}</span>
          {migrations.length > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
              {migrations.length} 次迁移
            </span>
          )}
        </button>
        {canHandoverImport && (
          <button
            onClick={() => setActiveTab('handover')}
            className={cn(
              'flex items-center gap-2 px-6 py-3 font-medium border-b-2 transition-colors',
              activeTab === 'handover'
                ? 'border-[#1e3a5f] text-[#1e3a5f]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            <Package size={18} />
            交接包导入
            {lastHandoverValidation && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                待确认
              </span>
            )}
          </button>
        )}
      </div>

      {lastImportValidation && lastImportValidation.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="font-medium text-yellow-800">导入提示（{lastImportValidation.warnings.length} 条）</p>
          </div>
          <ul className="space-y-1 ml-7">
            {lastImportValidation.warnings.map((w, i) => (
              <li key={i} className="text-sm text-yellow-700">• {w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {activeTab !== 'handover' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-1 space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'bg-white rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer',
                dragOver
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload size={32} className="text-blue-600" />
              </div>
              <h3 className="font-medium text-gray-800 mb-2">
                上传 {activeTab === 'stores' ? '门店' : '模板'} 文件
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                点击或拖拽 JSON 文件到此处
              </p>
              {activeTab === 'templates' && !canUpgrade && (
                <p className="text-xs text-red-600 mb-3">⚠️ 仅督导可导入模板</p>
              )}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeTab === 'templates' && !canUpgrade) {
                      addToast('error', '仅督导可导入模板');
                      return;
                    }
                    loadSampleData();
                  }}
                  className="w-full py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors text-sm"
                >
                  加载示例数据
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); downloadSample(); }}
                  className="w-full py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <Download size={14} />
                  下载模板
                </button>
              </div>
            </div>

            <div
              onClick={() => backupInputRef.current?.click()}
              className="bg-white rounded-xl border border-gray-200 p-5 text-center cursor-pointer hover:bg-purple-50 hover:border-purple-200 transition-colors"
            >
              <input
                ref={backupInputRef}
                type="file"
                accept=".json"
                onChange={handleBackupUpload}
                className="hidden"
              />
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Database size={24} className="text-purple-600" />
              </div>
              <h3 className="font-medium text-gray-800 mb-1">导入完整备份</h3>
              <p className="text-xs text-gray-500">恢复包含模板版本、迁移记录、冲突的数据</p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium mb-1">导入说明</p>
                  <p className="text-yellow-700">
                    {activeTab === 'stores'
                      ? '门店数据需包含 id、name、address、manager 字段'
                      : '模板数据需包含 id、name、version、fields 数组；同名不同版本将触发升级流程'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
                <h3 className="font-medium text-gray-800">
                  已导入{activeTab === 'stores' ? '门店' : '模板'}
                </h3>
                {activeTab === 'stores' ? stores.length : templates.length} 条
              </div>

              {activeTab === 'stores' ? (
                stores.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <StoreIcon size={48} className="mx-auto mb-3 opacity-50" />
                    <p>暂无门店数据</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {stores.map(store => (
                      <div key={store.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <StoreIcon size={20} className="text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-800">{store.name}</p>
                            <p className="text-sm text-gray-500">{store.address}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-700">{store.manager}</p>
                            <p className="text-xs text-gray-500 font-mono">{store.id}</p>
                          </div>
                          <CheckCircle size={18} className="text-green-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                templates.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <FileText size={48} className="mx-auto mb-3 opacity-50" />
                    <p>暂无模板数据</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {templates.map(template => (
                      <div key={template.id} className={cn(
                        'p-4 flex items-center justify-between hover:bg-gray-50',
                        template.deprecated && 'bg-gray-50 opacity-70'
                      )}>
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            'w-10 h-10 rounded-lg flex items-center justify-center',
                            template.deprecated ? 'bg-gray-200' : 'bg-purple-100'
                          )}>
                            <FileText size={20} className={template.deprecated ? 'text-gray-500' : 'text-purple-600'} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-800">{template.name}</p>
                              {template.deprecated && (
                                <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full">
                                  已废弃
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500">
                              {template.fields.length} 个检查项 · 版本 v{template.version}
                              {template.supersededBy && ` → 已升级到 v${template.supersededBy.slice(-3)}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-xs text-gray-500 font-mono">{template.id}</p>
                            <div className="flex gap-1 mt-1 justify-end">
                              {template.fields.slice(0, 3).map(field => (
                                <span key={field.key} className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                                  {field.label}
                                </span>
                              ))}
                              {template.fields.length > 3 && (
                                <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                                  +{template.fields.length - 3}
                                </span>
                              )}
                            </div>
                          </div>
                          <CheckCircle size={18} className="text-green-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {migrations.length > 0 && activeTab === 'templates' && (
              <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50">
                  <h3 className="font-medium text-gray-800 flex items-center gap-2">
                    <GitBranch size={16} />
                    模板迁移记录（{migrations.length}）
                  </h3>
                </div>
                <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                  {migrations.slice().reverse().map(m => (
                    <div key={m.id} className="px-6 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">
                          {templates.find(t => t.id === m.templateId)?.name || m.templateId}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(m.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        v{m.fromVersion} → v{m.toVersion} · 策略：{
                          m.option === 'keep_old' ? '保留旧草稿' :
                          m.option === 'migrate' ? '按映射迁移' : '仅非草稿迁移'
                        } · 迁移 {m.migratedIssueIds.length} 条，保留 {m.keptOldIssueIds.length} 条
                      </div>
                      {m.remark && <div className="text-xs text-purple-600 mt-1">{m.remark}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'handover' && lastHandoverValidation && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-800 flex items-center gap-2">
                  <Package size={18} className="text-[#1e3a5f]" />
                  交接包导入预览
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  问题：{lastHandoverValidation.issueTitle || '未知问题'} · 共 {lastHandoverValidation.summary.totalPlans} 条计划
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCancelHandover}
                  className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmHandoverImport}
                  disabled={lastHandoverValidation.summary.canImportCount === 0}
                  className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors text-sm disabled:opacity-50"
                >
                  确认导入 ({lastHandoverValidation.summary.canImportCount})
                </button>
              </div>
            </div>

            {lastHandoverValidation.warnings.length > 0 && (
              <div className="px-6 py-4 bg-yellow-50 border-b border-yellow-200">
                <div className="flex items-start gap-2 mb-2">
                  <AlertCircle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="font-medium text-yellow-800 text-sm">导入提示（{lastHandoverValidation.warnings.length} 条）</p>
                </div>
                <ul className="space-y-1 ml-6">
                  {lastHandoverValidation.warnings.slice(0, 5).map((w, i) => (
                    <li key={i} className="text-sm text-yellow-700">• {w}</li>
                  ))}
                  {lastHandoverValidation.warnings.length > 5 && (
                    <li className="text-sm text-yellow-600">...还有 {lastHandoverValidation.warnings.length - 5} 条提示</li>
                  )}
                </ul>
              </div>
            )}

            {lastHandoverValidation.errors.length > 0 && (
              <div className="px-6 py-4 bg-red-50 border-b border-red-200">
                <div className="flex items-start gap-2">
                  <XCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800 text-sm mb-1">导入错误</p>
                    <ul className="space-y-1 ml-4">
                      {lastHandoverValidation.errors.map((e, i) => (
                        <li key={i} className="text-sm text-red-700">• {e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="divide-y divide-gray-100">
              {lastHandoverValidation.plans.map((item, idx) => (
                <HandoverPlanRow
                  key={item.plan.id}
                  item={item}
                  index={idx}
                  resolution={handoverResolutions[item.plan.id]}
                  onResolutionChange={(res) => setHandoverResolutions(prev => ({ ...prev, [item.plan.id]: res }))}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'handover' && !lastHandoverValidation && (
        <div className="grid grid-cols-2 gap-6">
          <div className="col-span-1">
            <div
              onClick={() => handoverInputRef.current?.click()}
              className="bg-white rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 p-12 text-center cursor-pointer transition-colors"
            >
              <input
                ref={handoverInputRef}
                type="file"
                accept=".json"
                onChange={handleHandoverUpload}
                className="hidden"
              />
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Package size={40} className="text-blue-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-800 mb-2">上传交接包</h3>
              <p className="text-sm text-gray-500 mb-4">
                点击或拖拽 JSON 格式的交接包文件到此处
              </p>
              <p className="text-xs text-gray-400">
                交接包包含复查计划、附件摘要、同步状态、冲突处理记录和关键历史
              </p>
            </div>

            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">交接包说明</p>
                  <ul className="space-y-1 text-blue-700 text-xs">
                    <li>• 仅督导可导入交接包</li>
                    <li>• 导入时会自动检测本地已有计划、版本差异、责任人不匹配等情况</li>
                    <li>• 可选择保留本地、采用导入或合并备注与附件</li>
                    <li>• 处理结果会写入历史记录和同步队列</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                <ClipboardCheck size={18} className="text-[#1e3a5f]" />
                导入流程
              </h3>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-600 font-medium text-sm">1</div>
                  <div>
                    <p className="font-medium text-gray-700 text-sm">上传交接包</p>
                    <p className="text-xs text-gray-500 mt-1">选择由督导或店长导出的交接包 JSON 文件</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-600 font-medium text-sm">2</div>
                  <div>
                    <p className="font-medium text-gray-700 text-sm">预览与校验</p>
                    <p className="text-xs text-gray-500 mt-1">系统自动检测冲突、版本差异和权限问题</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-600 font-medium text-sm">3</div>
                  <div>
                    <p className="font-medium text-gray-700 text-sm">选择处理策略</p>
                    <p className="text-xs text-gray-500 mt-1">对每条计划选择保留本地、采用导入或合并</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-600 font-medium text-sm">4</div>
                  <div>
                    <p className="font-medium text-gray-700 text-sm">确认导入</p>
                    <p className="text-xs text-gray-500 mt-1">结果写入历史记录和同步队列，页面重启后可见</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
