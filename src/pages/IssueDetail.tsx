import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { IssueStatus, Issue, ReviewPlan, PlanConflict, PlanAttachment, UserRole } from '@/types';
import { hasPermission, canManageIssue, canCreatePlan, canEditPlan, canResolvePlanConflict, canViewPlan, canExportHandover } from '@/utils/permissions';
import { IssueStatusBadge, PriorityBadge } from '@/components/StatusBadge';
import { formatDate, ACTION_LABELS, getRoleName, PLAN_SYNC_STATUS_LABELS, PLAN_SYNC_STATUS_COLORS } from '@/utils/helpers';
import {
  ArrowLeft, Store, Calendar, User, FileText, CloudOff, Cloud, AlertTriangle,
  CheckCircle, XCircle, Edit3, Image as ImageIcon, MessageSquare, AlertCircle,
  History as HistoryIcon, GitBranch, Shield, RefreshCw, ArrowRight, Plus,
  ClipboardCheck, Trash2, Save, X, File, ChevronDown, ChevronUp, Download,
  Package
} from 'lucide-react';
import { diffReviewPlans } from '@/services/syncService';
import { generateId } from '@/utils/helpers';
import { cn } from '@/lib/utils';

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    issues, stores, templates, currentUser, histories, conflicts, migrations,
    reviewPlans, planConflicts,
    updateIssueStatus, resolveConflict, addToast, getTemplateForIssue,
    createReviewPlan, updateReviewPlan, deleteReviewPlan, resolvePlanConflict,
    getReviewPlansForIssue, exportHandover,
  } = useAppStore();

  const [showConflict, setShowConflict] = useState(false);
  const [rejectRemark, setRejectRemark] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ReviewPlan | null>(null);
  const [planForm, setPlanForm] = useState({
    reviewTime: '',
    assigneeId: '',
    assigneeName: '',
    assigneeRole: 'inspector' as UserRole,
    rectificationNote: '',
  });
  const [showPlanConflict, setShowPlanConflict] = useState<string | null>(null);

  const issue = issues.find(i => i.id === id);
  const store = stores.find(s => s.id === issue?.storeId);
  const template = issue ? getTemplateForIssue(issue) : undefined;
  const issueHistories = histories.filter(h => h.issueId === id).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const pendingConflict = conflicts.find(c => c.issueId === id && c.status === 'pending');

  const visiblePlans = useMemo(() => {
    if (!id) return [];
    return getReviewPlansForIssue(id).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [id, reviewPlans, currentUser, issues]);

  const issuePlanConflicts = useMemo(() =>
    planConflicts.filter(pc => pc.issueId === id && pc.status === 'pending'),
    [planConflicts, id]
  );

  const canAddPlan = issue ? canCreatePlan(currentUser, issue) : false;

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm({
      reviewTime: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
      assigneeId: '',
      assigneeName: '',
      assigneeRole: 'inspector',
      rectificationNote: '',
    });
    setShowPlanForm(true);
  };

  const openEditPlan = (plan: ReviewPlan) => {
    if (!canEditPlan(currentUser, plan, issue)) {
      addToast('error', '无权编辑此复查计划');
      return;
    }
    setEditingPlan(plan);
    setPlanForm({
      reviewTime: plan.reviewTime.slice(0, 16),
      assigneeId: plan.assigneeId,
      assigneeName: plan.assigneeName || '',
      assigneeRole: plan.assigneeRole || 'inspector',
      rectificationNote: plan.rectificationNote,
    });
    setShowPlanForm(true);
  };

  const handleSubmitPlan = async () => {
    if (!planForm.reviewTime) {
      addToast('error', '请选择复查时间');
      return;
    }
    if (!planForm.assigneeId && !planForm.assigneeName) {
      addToast('error', '请指定复查责任人');
      return;
    }
    const reviewTimeISO = new Date(planForm.reviewTime).toISOString();

    if (editingPlan) {
      const res = await updateReviewPlan(editingPlan.id, {
        reviewTime: reviewTimeISO,
        assigneeId: planForm.assigneeId || planForm.assigneeName,
        assigneeName: planForm.assigneeName || planForm.assigneeId,
        assigneeRole: planForm.assigneeRole,
        rectificationNote: planForm.rectificationNote,
      });
      if (res.success) setShowPlanForm(false);
    } else {
      const res = await createReviewPlan({
        issueId: id!,
        reviewTime: reviewTimeISO,
        assigneeId: planForm.assigneeId || planForm.assigneeName,
        assigneeName: planForm.assigneeName || planForm.assigneeId,
        assigneeRole: planForm.assigneeRole,
        rectificationNote: planForm.rectificationNote,
      });
      if (res.success) setShowPlanForm(false);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    if (!window.confirm('确定要删除此复查计划吗？')) return;
    await deleteReviewPlan(planId);
  };

  const handleResolvePlanConflict = async (pcId: string, resolution: 'local' | 'remote' | 'merge') => {
    await resolvePlanConflict(pcId, resolution);
    setShowPlanConflict(null);
  };

  const isCurrentTemplateLatest = useMemo(() => {
    if (!issue || !templates.length) return true;
    const sameIdTemplates = templates.filter(t => t.id === issue.templateId && !t.deprecated);
    return sameIdTemplates.length === 0 || sameIdTemplates.some(t => t.version === issue.templateVersion);
  }, [issue, templates]);

  const migrationInfo = useMemo(() => {
    if (!issue?.migrationSource) return null;
    return migrations.find(m => m.id === issue.migrationSource!.migrationId);
  }, [issue, migrations]);

  useEffect(() => {
    if (pendingConflict) {
      setShowConflict(true);
    }
  }, [pendingConflict]);

  if (!issue) {
    return (
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/issues')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
        >
          <ArrowLeft size={20} />
          返回列表
        </button>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <AlertCircle size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">问题不存在</h3>
          <p className="text-gray-500">该问题可能已被删除或不存在</p>
        </div>
      </div>
    );
  }

  const canEdit = currentUser && hasPermission(currentUser.role, 'issue:edit_own') &&
    issue.creatorId === currentUser.id && issue.status === 'draft';
  const canClose = currentUser && issue && canManageIssue(currentUser, issue, 'close') &&
    (issue.status === 'submitted' || issue.status === 'rejected');
  const canReject = currentUser && issue && canManageIssue(currentUser, issue, 'reject') &&
    issue.status === 'submitted';
  const canSubmit = currentUser && issue.creatorId === currentUser.id && issue.status === 'draft';
  const canResolveConflict = currentUser && hasPermission(currentUser.role, 'conflict:resolve');

  const handleStatusChange = async (status: IssueStatus, remark?: string) => {
    if (!currentUser) return;
    const result = await updateIssueStatus(issue.id, status, currentUser.id, remark);
    if (result.success) {
      setShowRejectModal(false);
      setRejectRemark('');
    } else if (result.error) {
      addToast('error', result.error);
    }
  };

  const handleResolveConflict = (resolution: 'local' | 'remote' | 'merge') => {
    if (!pendingConflict) return;
    resolveConflict(pendingConflict.id, resolution);
    setShowConflict(false);
  };

  const renderFieldValue = (key: string, value: any) => {
    if (value === undefined || value === null || value === '') return <span className="text-gray-400">未填写</span>;
    if (typeof value === 'boolean') return value ? '是' : '否';
    return value;
  };

  const ConflictCard = () => {
    if (!pendingConflict) return null;
    const { localVersion, remoteVersion, templateVersionConflict } = pendingConflict;

    const compareIssues = (a: Issue, b: Issue) => {
      const diffs: { field: string; local: any; remote: any }[] = [];
      const allFields = new Set([...Object.keys(a.data), ...Object.keys(b.data)]);
      allFields.forEach(field => {
        if (a.data[field] !== b.data[field]) {
          diffs.push({ field, local: a.data[field], remote: b.data[field] });
        }
      });
      if (a.title !== b.title) diffs.push({ field: 'title', local: a.title, remote: b.title });
      return diffs;
    };

    const diffs = compareIssues(localVersion, remoteVersion);

    return (
      <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-xl p-6 animate-pulse-slow">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-red-800 text-lg">版本冲突</h3>
            <p className="text-red-600 text-sm mt-1">
              本地版本与远程版本存在差异，请选择保留哪一方或合并
            </p>
            {templateVersionConflict && (
              <p className="text-red-700 text-xs mt-1 font-medium">
                模板版本不一致：本地 v{templateVersionConflict.localTemplateVersion} vs 远端 v{templateVersionConflict.remoteTemplateVersion}
              </p>
            )}
            <p className="text-red-500 text-xs mt-1">
              检测时间: {formatDate(pendingConflict.detectedAt)}
            </p>
          </div>
        </div>

        {templateVersionConflict?.diff && (
          <div className="bg-red-100/50 rounded-lg p-3 mb-4 border border-red-200">
            <p className="text-sm font-medium text-red-800 mb-2">模板字段差异：</p>
            <div className="flex flex-wrap gap-2">
              {templateVersionConflict.diff.addedFields.length > 0 && (
                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                  新增 {templateVersionConflict.diff.addedFields.length} 字段
                </span>
              )}
              {templateVersionConflict.diff.removedFields.length > 0 && (
                <span className="text-xs px-2 py-1 bg-red-200 text-red-800 rounded">
                  删除 {templateVersionConflict.diff.removedFields.length} 字段
                </span>
              )}
              {templateVersionConflict.diff.modifiedFields.length > 0 && (
                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                  修改 {templateVersionConflict.diff.modifiedFields.length} 字段
                </span>
              )}
              {templateVersionConflict.diff.renamedFields.length > 0 && (
                <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                  重命名 {templateVersionConflict.diff.renamedFields.length} 字段
                </span>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-4 py-2 text-left font-medium text-gray-600">字段</th>
                <th className="px-4 py-2 text-left font-medium text-blue-600">本地版本 (v{localVersion.templateVersion || '1.0'})</th>
                <th className="px-4 py-2 text-left font-medium text-orange-600">远程版本 (v{remoteVersion.templateVersion || '1.0'})</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((diff, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-4 py-2 font-medium text-gray-700">{diff.field}</td>
                  <td className="px-4 py-2 bg-blue-50">{renderFieldValue(diff.field, diff.local)}</td>
                  <td className="px-4 py-2 bg-orange-50">{renderFieldValue(diff.field, diff.remote)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canResolveConflict ? (
          <div className="flex gap-3">
            <button
              onClick={() => handleResolveConflict('local')}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              保留本地版本
            </button>
            <button
              onClick={() => handleResolveConflict('remote')}
              className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
            >
              采用远程版本
            </button>
            <button
              onClick={() => handleResolveConflict('merge')}
              className="flex-1 py-2.5 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors font-medium"
            >
              合并双方内容
            </button>
          </div>
        ) : (
          <p className="text-center text-red-600 text-sm">请联系督导处理此冲突</p>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/issues')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <ArrowLeft size={20} />
        返回列表
      </button>

      {showConflict && pendingConflict && <ConflictCard />}

      {issue.migrationSource && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <GitBranch className="text-purple-600 flex-shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-purple-800 flex-1">
              <p className="font-medium">此问题已从模板旧版本迁移</p>
              <p className="text-purple-700">
                v{issue.migrationSource.fromTemplateVersion} → v{issue.templateVersion}
                {migrationInfo && ` · 迁移策略：${
                  migrationInfo.option === 'keep_old' ? '保留旧草稿' :
                  migrationInfo.option === 'migrate' ? '按映射迁移' : '仅非草稿迁移'
                }`}
              </p>
              <p className="text-xs text-purple-500 mt-1">
                迁移时间：{formatDate(issue.migrationSource.migratedAt)} · 迁移ID：{issue.migrationSource.migrationId.slice(0, 12)}...
              </p>
            </div>
          </div>
        </div>
      )}

      {!isCurrentTemplateLatest && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-yellow-800 flex-1">
              <p className="font-medium">
                该问题使用的模板版本 v{issue.templateVersion} 不是最新版本
              </p>
              {currentUser?.role === 'supervisor' ? (
                <p className="text-yellow-700 mt-1">
                  您可在 <button onClick={() => navigate('/config')} className="underline font-medium">配置管理</button> 中进行模板迁移升级
                </p>
              ) : (
                <p className="text-yellow-700 mt-1">
                  如需升级，请联系督导进行模板迁移操作
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 border-b bg-gray-50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-gray-900">{issue.title}</h1>
                <IssueStatusBadge status={issue.status} />
                {issue.priority && <PriorityBadge priority={issue.priority} />}
              </div>
              <p className="text-sm text-gray-500 font-mono">编号: {issue.id}</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {issue.synced ? (
                <span className="flex items-center gap-1 text-green-600">
                  <Cloud size={16} />
                  已同步
                </span>
              ) : (
                <span className="flex items-center gap-1 text-orange-600">
                  <CloudOff size={16} />
                  未同步
                </span>
              )}
              <span className="text-gray-300">|</span>
              <span>数据 v{issue.version}</span>
              <span className="text-gray-300">|</span>
              <span className="flex items-center gap-1">
                <FileText size={14} />
                模板 v{issue.templateVersion}
              </span>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Store className="text-blue-600" size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">门店</p>
                <p className="font-medium text-gray-800">{store?.name || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <FileText className="text-green-600" size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">检查模板</p>
                <p className="font-medium text-gray-800">
                  {template?.name || '-'}
                  <span className="text-xs text-gray-500 ml-1">v{template?.version || issue.templateVersion}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <User className="text-purple-600" size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">创建人</p>
                <p className="font-medium text-gray-800">
                  {issue.creatorId.slice(0, 8)}...
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <Calendar className="text-orange-600" size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">创建时间</p>
                <p className="font-medium text-gray-800">{formatDate(issue.createdAt)}</p>
              </div>
            </div>
          </div>

          {template && (
            <div className="border-t pt-6 mb-8">
              <h3 className="font-semibold text-gray-800 mb-4">检查项详情</h3>
              <div className="grid grid-cols-2 gap-4">
                {template.fields.map(field => (
                  <div key={field.key} className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs text-gray-500">{field.label}</p>
                      {field.required && <span className="text-xs text-red-500">*</span>}
                    </div>
                    <p className="font-medium text-gray-800">
                      {renderFieldValue(field.key, issue.data[field.key])}
                    </p>
                  </div>
                ))}
                {Object.keys(issue.data).filter(key => !template.fields.some(f => f.key === key)).map(key => (
                  <div key={key} className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs text-yellow-600">{key} <span className="italic">（旧模板字段）</span></p>
                    </div>
                    <p className="font-medium text-gray-800">
                      {renderFieldValue(key, issue.data[key])}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {issue.images && issue.images.length > 0 && (
            <div className="border-t pt-6">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <ImageIcon size={18} />
                现场图片 ({issue.images.length})
              </h3>
              <div className="grid grid-cols-4 gap-3">
                {issue.images.map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`现场图片 ${idx + 1}`}
                    className="w-full aspect-square object-cover rounded-lg hover:opacity-80 transition-opacity cursor-pointer"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-gray-50">
          <div className="flex flex-wrap gap-3">
            {canEdit && (
              <button
                onClick={() => navigate(`/issues/${issue.id}/edit`)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Edit3 size={18} />
                编辑
              </button>
            )}
            {canSubmit && (
              <button
                onClick={() => handleStatusChange('submitted')}
                className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
              >
                <CheckCircle size={18} />
                提交
              </button>
            )}
            {canClose && (
              <button
                onClick={() => handleStatusChange('closed')}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <CheckCircle size={18} />
                关闭问题
              </button>
            )}
            {canReject && (
              <button
                onClick={() => setShowRejectModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <XCircle size={18} />
                驳回
              </button>
            )}
            {issue.status === 'closed' && (
              <button
                onClick={() => handleStatusChange('submitted')}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
              >
                <MessageSquare size={18} />
                重新打开
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <ClipboardCheck size={18} className="text-[#1e3a5f]" />
            复查与整改计划
            {issuePlanConflicts.length > 0 && (
              <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                {issuePlanConflicts.length} 个待处理冲突
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {canExportHandover(currentUser, issue) && visiblePlans.length > 0 && (
              <button
                onClick={() => exportHandover(id!)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#1e3a5f] border border-[#1e3a5f]/30 text-sm rounded-lg hover:bg-blue-50 transition-colors"
                title="导出交接包"
              >
                <Package size={16} />
                导出交接包
              </button>
            )}
            {canAddPlan && (issue?.status === 'rejected' || issue?.status === 'submitted') && (
              <button
                onClick={openCreatePlan}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2d4a6f] transition-colors"
              >
                <Plus size={16} />
                新建计划
              </button>
            )}
          </div>
        </div>

        {issuePlanConflicts.length > 0 && issuePlanConflicts.map(pc => (
          <div key={pc.id} className="bg-red-50 border-b border-red-200 p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-red-500 mt-0.5" size={20} />
                <div>
                  <p className="font-medium text-red-800">复查计划版本冲突</p>
                  <p className="text-sm text-red-600">本地与远程的复查时间或责任人不一致，需人工选择</p>
                  <p className="text-xs text-red-500 mt-1">检测时间：{formatDate(pc.detectedAt)}</p>
                </div>
              </div>
              <button
                onClick={() => setShowPlanConflict(showPlanConflict === pc.id ? null : pc.id)}
                className="text-red-600 hover:text-red-800 text-sm flex items-center gap-1"
              >
                {showPlanConflict === pc.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showPlanConflict === pc.id ? '收起' : '查看差异'}
              </button>
            </div>

            {showPlanConflict === pc.id && (() => {
              const diffs = diffReviewPlans(pc.localPlan, pc.remotePlan);
              const canResolve = canResolvePlanConflict(currentUser, pc.localPlan, issue);
              return (
                <div>
                  <div className="bg-white rounded-lg overflow-hidden border border-red-200 mb-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-red-100">
                          <th className="px-3 py-2 text-left font-medium text-red-800">字段</th>
                          <th className="px-3 py-2 text-left font-medium text-blue-700">本地版本</th>
                          <th className="px-3 py-2 text-left font-medium text-orange-700">远程版本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-4 text-center text-gray-500">无实质差异</td>
                          </tr>
                        ) : diffs.map((d, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2 font-medium text-gray-700">{d.label}</td>
                            <td className="px-3 py-2 bg-blue-50">{String(d.local ?? '-')}</td>
                            <td className="px-3 py-2 bg-orange-50">{String(d.remote ?? '-')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {canResolve ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResolvePlanConflict(pc.id, 'local')}
                        className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                      >采用本地版本</button>
                      <button
                        onClick={() => handleResolvePlanConflict(pc.id, 'remote')}
                        className="flex-1 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 text-sm font-medium"
                      >采用远程版本</button>
                      <button
                        onClick={() => handleResolvePlanConflict(pc.id, 'merge')}
                        className="flex-1 py-2 bg-[#1e3a5f] text-white rounded hover:bg-[#2d4a6f] text-sm font-medium"
                      >合并保留双方</button>
                    </div>
                  ) : (
                    <p className="text-center text-sm text-red-600">请联系督导或创建人处理此冲突</p>
                  )}
                </div>
              );
            })()}
          </div>
        ))}

        <div className="p-6">
          {visiblePlans.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <ClipboardCheck size={40} className="mx-auto text-gray-300 mb-3" />
              <p>暂无复查整改计划</p>
              {canAddPlan && (issue?.status === 'rejected' || issue?.status === 'submitted') && (
                <button
                  onClick={openCreatePlan}
                  className="mt-3 text-sm text-[#1e3a5f] hover:underline"
                >+ 立即新建一个复查计划</button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {visiblePlans.map(plan => {
                const canEdit = canEditPlan(currentUser, plan, issue);
                const hasConflict = issuePlanConflicts.some(pc => pc.planId === plan.id);
                return (
                  <div key={plan.id} className={cn(
                    'border rounded-lg p-4 transition-colors',
                    hasConflict ? 'border-red-200 bg-red-50/40' : 'border-gray-200'
                  )}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded text-white"
                            style={{ backgroundColor: PLAN_SYNC_STATUS_COLORS[plan.status] }}>
                            {PLAN_SYNC_STATUS_LABELS[plan.status]}
                          </span>
                          {plan.lastSyncError && (
                            <span className="text-xs text-red-600 flex items-center gap-1">
                              <AlertCircle size={12} /> {plan.lastSyncError}
                            </span>
                          )}
                          {hasConflict && (
                            <span className="text-xs text-red-600 flex items-center gap-1">
                              <AlertTriangle size={12} /> 存在冲突
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono">
                          {plan.id.slice(0, 16)}... · 创建于 {formatDate(plan.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <>
                            <button
                              onClick={() => openEditPlan(plan)}
                              className="p-1.5 text-gray-500 hover:text-[#1e3a5f] hover:bg-gray-100 rounded"
                              title="编辑"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan.id)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                              title="删除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-start gap-2">
                        <Calendar size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">复查时间</p>
                          <p className="font-medium text-gray-800">{formatDate(plan.reviewTime)}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <User size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">责任人</p>
                          <p className="font-medium text-gray-800">
                            {plan.assigneeName || plan.assigneeId}
                            {plan.assigneeRole && <span className="text-xs text-gray-500 ml-1">（{getRoleName(plan.assigneeRole)}）</span>}
                          </p>
                        </div>
                      </div>
                      {plan.rectificationNote && (
                        <div className="col-span-2 flex items-start gap-2">
                          <FileText size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-xs text-gray-500">整改说明</p>
                            <p className="text-gray-700 whitespace-pre-wrap">{plan.rectificationNote}</p>
                          </div>
                        </div>
                      )}
                      {plan.attachments && plan.attachments.length > 0 && (
                        <div className="col-span-2 flex items-start gap-2">
                          <File size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-xs text-gray-500 mb-1">附件 ({plan.attachments.length})</p>
                            <div className="flex flex-wrap gap-2">
                              {plan.attachments.map(att => (
                                <span key={att.id} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs">
                                  <File size={12} />
                                  {att.name}
                                  {att.placeholder && <span className="text-orange-600">（占位）</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showPlanForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900">
                {editingPlan ? '编辑复查计划' : '新建复查计划'}
              </h3>
              <button
                onClick={() => setShowPlanForm(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">复查时间 *</label>
                <input
                  type="datetime-local"
                  value={planForm.reviewTime}
                  onChange={e => setPlanForm(f => ({ ...f, reviewTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">责任人姓名 *</label>
                  <input
                    type="text"
                    value={planForm.assigneeName}
                    onChange={e => setPlanForm(f => ({ ...f, assigneeName: e.target.value }))}
                    placeholder="请输入责任人姓名"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">角色</label>
                  <select
                    value={planForm.assigneeRole}
                    onChange={e => setPlanForm(f => ({ ...f, assigneeRole: e.target.value as UserRole }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40"
                  >
                    <option value="inspector">巡检员</option>
                    <option value="manager">店长</option>
                    <option value="supervisor">督导</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">责任人 ID</label>
                <input
                  type="text"
                  value={planForm.assigneeId}
                  onChange={e => setPlanForm(f => ({ ...f, assigneeId: e.target.value }))}
                  placeholder="选填，可留空"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">整改说明</label>
                <textarea
                  rows={4}
                  value={planForm.rectificationNote}
                  onChange={e => setPlanForm(f => ({ ...f, rectificationNote: e.target.value }))}
                  placeholder="请描述整改要求和注意事项..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40 resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t bg-gray-50 flex gap-3 justify-end">
              <button
                onClick={() => setShowPlanForm(false)}
                className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >取消</button>
              <button
                onClick={handleSubmitPlan}
                className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] flex items-center gap-2"
              >
                <Save size={16} />
                {editingPlan ? '保存修改' : '创建计划'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <HistoryIcon size={18} />
          操作历史
        </h3>
        <div className="space-y-4">
          {issueHistories.length === 0 ? (
            <p className="text-gray-500 text-center py-8">暂无操作记录</p>
          ) : (
            issueHistories.map((history, idx) => (
              <div key={history.id} className={cn(
                'flex gap-4',
                idx !== issueHistories.length - 1 && 'pb-4 border-b'
              )}>
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    history.action === 'close' ? 'bg-green-100' :
                    history.action === 'reject' ? 'bg-red-100' :
                    history.action === 'submit' ? 'bg-blue-100' :
                    history.action === 'migrate' ? 'bg-purple-100' :
                    String(history.action).startsWith('plan_') ? 'bg-teal-100' :
                    'bg-gray-100'
                  )}>
                    {history.action === 'close' ? <CheckCircle size={14} className="text-green-600" /> :
                     history.action === 'reject' ? <XCircle size={14} className="text-red-600" /> :
                     history.action === 'migrate' ? <GitBranch size={14} className="text-purple-600" /> :
                     String(history.action).startsWith('plan_') ? <ClipboardCheck size={14} className="text-teal-600" /> :
                     <Edit3 size={14} className="text-gray-600" />}
                  </div>
                  {idx !== issueHistories.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-gray-800">
                      {ACTION_LABELS[history.action]}
                    </span>
                    {history.fromStatus && history.toStatus && (
                      <span className="text-sm text-gray-500">
                        ({history.fromStatus} → {history.toStatus})
                      </span>
                    )}
                    {history.templateVersion && (
                      <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">
                        模板 v{history.templateVersion}
                      </span>
                    )}
                    {history.migrationInfo && (
                      <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded flex items-center gap-1">
                        <RefreshCw size={10} />
                        v{history.migrationInfo.fromVersion} <ArrowRight size={10} /> v{history.migrationInfo.toVersion}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span>{getRoleName(history.operatorRole)}</span>
                    <span>•</span>
                    <span>{formatDate(history.timestamp)}</span>
                  </div>
                  {history.remark && (
                    <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded p-3">
                      {history.remark}
                    </p>
                  )}
                  {history.planDetail && (
                    <div className="mt-2 text-xs text-gray-600 bg-teal-50 border border-teal-100 rounded p-3">
                      <p className="font-medium text-teal-700 mb-1.5">复查计划变更详情</p>
                      <div className="space-y-1">
                        {history.planDetail.conflictResolution && (
                          <>
                            <p>
                              冲突解决方式：
                              <span className={cn(
                                'font-medium',
                                history.planDetail.conflictResolution === 'local' && 'text-blue-600',
                                history.planDetail.conflictResolution === 'remote' && 'text-orange-600',
                                history.planDetail.conflictResolution === 'merge' && 'text-teal-700'
                              )}>
                                {history.planDetail.conflictResolution === 'local' ? '采用本地版本' :
                                 history.planDetail.conflictResolution === 'remote' ? '采用远程版本' :
                                 '合并保留双方'}
                              </span>
                            </p>
                            {history.planDetail.localVersion && history.planDetail.remoteVersion && (() => {
                              const diffs = diffReviewPlans(history.planDetail.localVersion, history.planDetail.remoteVersion);
                              if (diffs.length === 0) return null;
                              return (
                                <div className="mt-2 bg-white/60 rounded p-2 space-y-0.5">
                                  <p className="text-teal-600 font-medium mb-1">差异字段：</p>
                                  {diffs.map((d, i) => (
                                    <p key={i}>
                                      <span className="text-gray-500">{d.label}：</span>
                                      <span className="text-blue-600">本地 {String(d.local ?? '空')}</span>
                                      <span className="text-gray-400 mx-1">vs</span>
                                      <span className="text-orange-600">远程 {String(d.remote ?? '空')}</span>
                                    </p>
                                  ))}
                                </div>
                              );
                            })()}
                          </>
                        )}
                        {history.planDetail.field && !history.planDetail.conflictResolution && (
                          <p>
                            变更字段：<span className="font-medium text-teal-700">{history.planDetail.field}</span>
                          </p>
                        )}
                        {history.planDetail.oldValue !== undefined && history.planDetail.newValue !== undefined && (
                          <p>
                            变更内容：
                            <span className="text-gray-500">{String(history.planDetail.oldValue).slice(0, 30) || '空'}</span>
                            <span className="mx-1">→</span>
                            <span className="text-teal-700 font-medium">{String(history.planDetail.newValue).slice(0, 30) || '空'}</span>
                          </p>
                        )}
                        {history.planDetail.localVersion && !history.planDetail.conflictResolution && (
                          <p>
                            本地版本号：<span className="font-mono text-teal-700">v{history.planDetail.localVersion.version}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">驳回问题</h3>
            <p className="text-sm text-gray-600 mb-4">请填写驳回原因，该原因将反馈给巡检员</p>
            <textarea
              value={rejectRemark}
              onChange={e => setRejectRemark(e.target.value)}
              placeholder="请输入驳回原因..."
              rows={4}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => rejectRemark.trim() && handleStatusChange('rejected', rejectRemark)}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                disabled={!rejectRemark.trim()}
              >
                确认驳回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
