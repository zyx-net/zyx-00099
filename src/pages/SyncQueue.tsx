import { useAppStore } from '@/store';
import { SyncStatusBadge } from '@/components/StatusBadge';
import { formatDate } from '@/utils/helpers';
import { hasPermission } from '@/utils/permissions';
import {
  RefreshCw, Trash2, AlertCircle, CheckCircle, Clock, XCircle,
  Play, TrendingUp, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SyncQueue() {
  const { syncQueue, issues, currentUser, isOnline, processSyncQueue, forceConflictSync, retrySyncItem, clearCompletedSync } = useAppStore();

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

  const stats = [
    { label: '待同步', count: pendingItems.length, color: 'bg-yellow-100 text-yellow-700', icon: Clock },
    { label: '同步中', count: syncingItems.length, color: 'bg-blue-100 text-blue-700', icon: RefreshCw },
    { label: '失败', count: failedItems.length, color: 'bg-red-100 text-red-700', icon: XCircle },
    { label: '已完成', count: completedItems.length, color: 'bg-green-100 text-green-700', icon: CheckCircle },
  ];

  const allItems = [...syncQueue].sort((a, b) => {
    const order: Record<string, number> = { failed: 0, pending: 1, syncing: 2, completed: 3 };
    return order[a.status] - order[b.status];
  });

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
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">问题</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">重试次数</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">最后尝试</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {allItems.map(item => {
                const Icon = statusIcon[item.status];
                return (
                  <tr key={item.id} className={cn(
                    'hover:bg-gray-50 transition-colors',
                    item.status === 'failed' && 'bg-red-50/50'
                  )}>
                    <td className="px-6 py-4">
                      <SyncStatusBadge status={item.status} />
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
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600">
                        {item.action === 'create' ? '创建' : item.action === 'update' ? '更新' : '删除'}
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
                    <td className="px-6 py-4 text-right">
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
              })}
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
