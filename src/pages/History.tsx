import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { formatDate, ACTION_LABELS, getRoleName } from '@/utils/helpers';
import {
  History as HistoryIcon, Edit3, CheckCircle, XCircle, RefreshCw,
  FileText, Store as StoreIcon, User, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function History() {
  const { histories, issues, stores, conflicts } = useAppStore();

  const sortedHistories = useMemo(() => {
    return [...histories].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [histories]);

  const pendingConflicts = conflicts.filter(c => c.status === 'pending');

  const getIssueTitle = (issueId: string) => {
    const issue = issues.find(i => i.id === issueId);
    return issue?.title || issueId;
  };

  const getStoreName = (issueId: string) => {
    const issue = issues.find(i => i.id === issueId);
    if (!issue) return '-';
    const store = stores.find(s => s.id === issue.storeId);
    return store?.name || '-';
  };

  const actionIcon = {
    create: Edit3,
    update: RefreshCw,
    submit: CheckCircle,
    reject: XCircle,
    close: CheckCircle,
    reopen: RefreshCw
  };

  const actionColor = {
    create: 'bg-blue-100 text-blue-600',
    update: 'bg-gray-100 text-gray-600',
    submit: 'bg-blue-100 text-blue-600',
    reject: 'bg-red-100 text-red-600',
    close: 'bg-green-100 text-green-600',
    reopen: 'bg-orange-100 text-orange-600'
  };

  const stats = useMemo(() => {
    const last7Days = sortedHistories.filter(h => {
      const date = new Date(h.timestamp);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return date >= weekAgo;
    });
    return {
      total: histories.length,
      last7Days: last7Days.length,
      conflicts: pendingConflicts.length
    };
  }, [histories.length, pendingConflicts.length, sortedHistories]);

  if (histories.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">总操作记录</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">近7天操作</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{stats.last7Days}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">待处理冲突</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{stats.conflicts}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-gray-400">
            <HistoryIcon size={48} className="mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">暂无操作记录</h3>
            <p className="text-gray-500">创建或修改问题后，操作记录将显示在这里</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">总操作记录</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stats.total}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <HistoryIcon size={20} className="text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">近7天操作</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stats.last7Days}</p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-green-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">待处理冲突</p>
              <p className={cn(
                'text-2xl font-bold mt-1',
                stats.conflicts > 0 ? 'text-red-600' : 'text-gray-800'
              )}>{stats.conflicts}</p>
            </div>
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertTriangle size={20} className={cn(
                stats.conflicts > 0 ? 'text-red-600' : 'text-gray-400'
              )} />
            </div>
          </div>
        </div>
      </div>

      {pendingConflicts.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <h4 className="font-medium text-red-800 mb-2">待处理的版本冲突</h4>
              <div className="space-y-2">
                {pendingConflicts.map(conflict => (
                  <div key={conflict.id} className="bg-white rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="text-gray-500" />
                      <div>
                        <p className="font-medium text-gray-800">{getIssueTitle(conflict.issueId)}</p>
                        <p className="text-xs text-gray-500">
                          检测时间: {formatDate(conflict.detectedAt)}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm text-red-600 font-medium">需要人工处理</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="font-medium text-gray-800 flex items-center gap-2">
            <HistoryIcon size={18} />
            操作历史
          </h3>
        </div>

        <div className="divide-y divide-gray-100">
          {sortedHistories.map((history, idx) => {
            const Icon = actionIcon[history.action];
            const hasConflict = pendingConflicts.some(c => c.issueId === history.issueId);

            return (
              <div
                key={history.id}
                className={cn(
                  'flex gap-4 p-4 hover:bg-gray-50 transition-colors',
                  hasConflict && 'bg-red-50/30'
                )}
              >
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
                    actionColor[history.action]
                  )}>
                    <Icon size={18} />
                  </div>
                  {idx !== sortedHistories.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-800">
                          {ACTION_LABELS[history.action]}
                        </span>
                        {history.fromStatus && history.toStatus && (
                          <span className="text-sm text-gray-500">
                            ({history.fromStatus} → {history.toStatus})
                          </span>
                        )}
                        {hasConflict && (
                          <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full">
                            存在冲突
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-gray-600 mb-1">
                        <span className="font-medium">{getIssueTitle(history.issueId)}</span>
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <StoreIcon size={12} />
                          {getStoreName(history.issueId)}
                        </span>
                        <span className="flex items-center gap-1">
                          <User size={12} />
                          {getRoleName(history.operatorRole)}
                        </span>
                        <span className="flex items-center gap-1">
                          <HistoryIcon size={12} />
                          {formatDate(history.timestamp)}
                        </span>
                      </div>

                      {history.remark && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-600">
                            <span className="font-medium text-gray-700">备注: </span>
                            {history.remark}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
