import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { SyncStatusBadge, DueStatusBadge } from '@/components/StatusBadge';
import { formatDate, DUE_STATUS_LABELS, getRoleName } from '@/utils/helpers';
import { hasPermission } from '@/utils/permissions';
import {
  RefreshCw, Trash2, AlertCircle, CheckCircle, Clock, XCircle,
  Play, TrendingUp, AlertTriangle, Filter, Calendar, ChevronDown, ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlanDueStatus } from '@/types';

const DUE_FILTER_OPTIONS: (PlanDueStatus | 'all')[] = [
  'all', 'overdue', 'due_soon', 'delay_requested', 'delay_approved', 'delay_rejected', 'normal'
];

export default function SyncQueue() {
  const navigate = useNavigate();
  const { syncQueue, issues, currentUser, reviewPlans, isOnline, processSyncQueue, forceConflictSync, retrySyncItem, clearCompletedSync } = useAppStore();
  const [dueFilter, setDueFilter] = useState<PlanDueStatus | 'all'>('all');
  const [showDueFilter, setShowDueFilter] = useState(false);

  const canManage = currentUser && hasPermission(currentUser.role, 'sync:manage');

  const pendingItems = syncQueue.filter(i => i.status === 'pending');
  const syncingItems = syncQueue.filter(i => i.status === 'syncing');
  const failedItems = syncQueue.filter(i => i.status === 'failed');
  const completedItems = syncQueue.filter(i => i.status === 'completed');

  const statusIcon = {
    pending: Clock,
    syncing: RefreshCw,
    failed: XCircle,
    completed: CheckCircle
  };

  const getIssueTitle = (issueId: string) => {
    const issue = issues.find(i => i.id === issueId);
    return issue?.title || issueId;
  };

  const getPlanForSyncItem = (item: any) => {
    if (item.planPayload?.id) return reviewPlans.find(p => p.id === item.planPayload.id);
    if (item.entityType === 'review_plan' && item.entityId) return reviewPlans.find(p => p.id === item.entityId);
    return undefined;
  };

  const filteredItems = useMemo(() => {
    const items = [...syncQueue].sort((a, b) => {
      const order: Record<string, number> = { failed: 0, pending: 1, syncing: 2, completed: 3 };
      return order[a.status] - order[b.status];
    });
    if (dueFilter === 'all') return items;
    return items.filter(item => {
      const plan = getPlanForSyncItem(item);
      return plan?.dueStatus === dueFilter;
    });
  }, [syncQueue, dueFilter, reviewPlans]);

  const dueFilterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('all', syncQueue.length);
    DUE_FILTER_OPTIONS.forEach(s => {
      if (s === 'all') return;
      const n = syncQueue.filter(item => {
        const plan = getPlanForSyncItem(item);
        return plan?.dueStatus === s;
      }).length;
      counts.set(s, n);
    });
    return counts;
  }, [syncQueue, reviewPlans]);

  const stats = [
    { label: '待同步', count: pendingItems.length, color: 'bg-yellow-100 text-yellow-700', icon: Clock },
    { label: '同步中', count: syncingItems.length, color: 'bg-blue-100 text-blue-700', icon: RefreshCw },
    { label: '失败', count: failedItems.length, color: 'bg-red-100 text-red-700', icon: XCircle },
    { label: '已完成', count: completedItems.length, color: 'bg-green-100 text-green-700', icon: CheckCircle },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-800">同步队列</h2>
          {!isOnline && (
            <span className="flex items-center gap-1.5 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
              <AlertCircle size={14} />
              当前离线
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <button
              onClick={() => setShowDueFilter(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Filter size={16} />
              {dueFilter === 'all' ? '全部到期状态' : DUE_STATUS_LABELS[dueFilter]}
              <ChevronDown size={14} className={cn('transition-transform', showDueFilter && 'rotate-180')} />
            </button>
            {showDueFilter && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-40 overflow-hidden">
                {DUE_FILTER_OPTIONS.map(opt => {
                  const label = opt === 'all' ? '全部' : DUE_STATUS_LABELS[opt];
                  const count = dueFilterCounts.get(opt) || 0;
                  const selected = dueFilter === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => { setDueFilter(opt); setShowDueFilter(false); }}
                      className={cn(
                        'w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors',
                        selected && 'bg-blue-50 text-[#1e3a5f] font-medium'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {opt !== 'all' && <DueStatusBadge status={opt} />}
                        {opt === 'all' && label}
                        {opt !== 'all' && <span className="ml-2">{label}</span>}
                      </span>
                      <span className="text-xs text-gray-400">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => clearCompletedSync()}
            disabled={completedItems.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            清除已完成
          </button>
          <button
            onClick={() => processSyncQueue(true)}
            disabled={!isOnline || (pendingItems.length === 0 && failedItems.length === 0)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            同步全部
          </button>
          <button
            onClick={() => forceConflictSync()}
            disabled={!isOnline || (pendingItems.length === 0 && failedItems.length === 0)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="强制触发所有待同步项的版本冲突，用于验证冲突处理流程"
          >
            <AlertTriangle size={16} />
            模拟冲突
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{stat.count}</p>
                </div>
                <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.color)}>
                  <Icon size={20} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {dueFilter !== 'all' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <Filter size={16} />
            按到期状态筛选：<DueStatusBadge status={dueFilter} />（{filteredItems.length} 条）
          </div>
          <button
            onClick={() => setDueFilter('all')}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
          >清除筛选</button>
        </div>
      )}

      {syncQueue.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-gray-400">
            <TrendingUp size={48} className="mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">同步队列为空</h3>
            <p className="text-gray-500">所有数据已同步完成</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">同步状态</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">到期状态</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">问题</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">复查时间</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">重试次数</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">最后尝试</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    没有符合筛选条件的同步项
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const Icon = statusIcon[item.status];
                  const plan = getPlanForSyncItem(item);
                  const isReviewPlan = item.entityType === 'review_plan' || plan;
                  return (
                    <tr key={item.id} className={cn(
                      'hover:bg-gray-50 transition-colors cursor-pointer',
                      item.status === 'failed' && 'bg-red-50/50 hover:bg-red-50'
                    )}
                      onClick={() => item.issueId && navigate(`/issues/${item.issueId}`)}
                    >
                      <td className="px-6 py-4">
                        <SyncStatusBadge status={item.status} />
                      </td>
                      <td className="px-6 py-4">
                        {plan ? (
                          <DueStatusBadge status={plan.dueStatus} />
                        ) : (
                          isReviewPlan ? (
                            <span className="text-xs text-gray-400">计划未加载</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Icon size={16} className={cn(
                            item.status === 'syncing' && 'animate-spin',
                            item.status === 'failed' && 'text-red-500',
                            item.status === 'completed' && 'text-green-500',
                            item.status === 'pending' && 'text-yellow-500'
                          )} />
                          <div>
                            <p className="font-medium text-gray-800">{getIssueTitle(item.issueId)}</p>
                            <p className="text-xs text-gray-500 font-mono">{item.issueId.slice(0, 20)}...</p>
                            {plan && (
                              <p className="text-xs text-purple-600 mt-0.5">
                                {plan.delayCount > 0 && `已延期${plan.delayCount}次 `}
                                {plan.pendingDelayRequest && '⏳待审批'}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {plan ? (
                          <div className="flex items-start gap-2">
                            <Calendar size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className={cn(
                                'text-sm font-medium',
                                plan.dueStatus === 'overdue' && 'text-red-600',
                                plan.dueStatus === 'due_soon' && 'text-yellow-700'
                              )}>
                                {formatDate(plan.reviewTime)}
                              </p>
                              {plan.lastApproverName && (
                                <p className="text-xs text-gray-500">审批人：{plan.lastApproverName}</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-600">
                          {item.action === 'create' ? '创建' : item.action === 'update' ? '更新' : '删除'}
                          {isReviewPlan && ' · 复查计划'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          'text-sm',
                          item.retryCount > 0 ? 'text-red-600 font-medium' : 'text-gray-600'
                        )}>
                          {item.retryCount} 次
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-600">
                          {item.lastAttempt ? formatDate(item.lastAttempt) : '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                        {item.status === 'failed' && canManage && (
                          <button
                            onClick={() => retrySyncItem(item.id)}
                            disabled={!isOnline}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                          >
                            <RefreshCw size={14} />
                            重试
                          </button>
                        )}
                        {item.errorMessage && (
                          <p className="text-xs text-red-500 mt-1">{item.errorMessage}</p>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-blue-500 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">同步说明</p>
            <ul className="space-y-1 text-blue-700">
              <li>• 离线时所有操作会保存在本地，联网后自动同步</li>
              <li>• 可通过"到期状态"筛选快速定位逾期、即将到期或已申请延期的复查计划</li>
              <li>• 同步失败的项目会保留，可手动重试</li>
              <li>• 点击「同步全部」可模拟冲突场景（约 30% 概率触发）</li>
              <li>• 版本冲突需要人工处理，双方内容都会保留</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
