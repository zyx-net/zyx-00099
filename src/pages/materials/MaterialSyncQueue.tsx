import { useMemo } from 'react';
import { useAppStore } from '@/store';
import {
  RefreshCw, CheckCircle2, AlertCircle, Clock,
  PlayCircle, ChevronRight
} from 'lucide-react';
import type { MaterialSyncQueueItem, SyncStatus } from '@/types';
import { cn } from '@/lib/utils';

const STATUS_META: Record<SyncStatus, { icon: any; label: string; color: string; bgColor: string }> = {
  pending: { icon: Clock, label: '等待同步', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  syncing: { icon: RefreshCw, label: '同步中', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  failed: { icon: AlertCircle, label: '同步失败', color: 'text-red-700', bgColor: 'bg-red-100' },
  completed: { icon: CheckCircle2, label: '已同步', color: 'text-green-700', bgColor: 'bg-green-100' },
};

const ENTITY_LABELS: Record<MaterialSyncQueueItem['entityType'], string> = {
  material: '物资目录',
  material_batch: '库存批次',
  material_borrow: '借用单据',
  material_record: '操作记录',
};

export default function MaterialSyncQueue() {
  const { materialSyncQueue, addToast, processMaterialSyncQueue, retryMaterialSyncItem } = useAppStore();

  const sortedQueue = useMemo(() => {
    return [...materialSyncQueue].sort((a, b) => {
      const order: Record<SyncStatus, number> = { pending: 0, syncing: 1, failed: 2, completed: 3 };
      const d = order[a.status] - order[b.status];
      if (d !== 0) return d;
      const aTime = a.lastAttempt ? new Date(a.lastAttempt).getTime() : 0;
      const bTime = b.lastAttempt ? new Date(b.lastAttempt).getTime() : 0;
      return bTime - aTime;
    });
  }, [materialSyncQueue]);

  const stats = useMemo(() => {
    const s = { total: materialSyncQueue.length, pending: 0, syncing: 0, completed: 0, failed: 0 };
    for (const item of materialSyncQueue) {
      if (item.status in s) (s as any)[item.status]++;
    }
    return s;
  }, [materialSyncQueue]);

  const handleSyncAll = async () => {
    addToast('info', '开始同步物资数据...');
    await processMaterialSyncQueue();
  };

  const handleRetryItem = async (item: MaterialSyncQueueItem) => {
    addToast('info', '正在重试...');
    await retryMaterialSyncItem(item.id);
  };

  const renderPayloadSummary = (item: MaterialSyncQueueItem) => {
    try {
      const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      if (!payload) return '';
      const keys = Object.keys(payload).filter(k =>
        !['id', 'createdAt', 'updatedAt', 'createdBy', 'timestamp'].includes(k)
      ).slice(0, 3);
      return keys.map(k => `${k}: ${typeof payload[k] === 'string' ? payload[k].slice(0, 20) : payload[k]}`).join(', ');
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg',
              stats.pending > 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-gray-50 text-gray-500')}>
              <Clock size={14} />
              等待中 {stats.pending}
            </div>
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg',
              stats.syncing > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500')}>
              <RefreshCw size={14} />
              同步中 {stats.syncing}
            </div>
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg',
              stats.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500')}>
              <AlertCircle size={14} />
              失败 {stats.failed}
            </div>
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg',
              stats.completed > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500')}>
              <CheckCircle2 size={14} />
              已完成 {stats.completed}
            </div>
          </div>
          <button
            onClick={handleSyncAll}
            disabled={stats.pending === 0 && stats.failed === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1e3a5f]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayCircle size={16} />
            同步全部
          </button>
        </div>

        {sortedQueue.length === 0 ? (
          <div className="py-16 text-center">
            <CheckCircle2 size={40} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">暂无同步任务</h3>
            <p className="text-sm text-gray-400">所有数据变更已自动入队</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto -mx-4 -mb-4 px-4 pb-4">
            {sortedQueue.map(item => {
              const meta = STATUS_META[item.status];
              const Icon = meta.icon;
              const summary = renderPayloadSummary(item);
              return (
                <div key={item.id} className="py-3 hover:bg-gray-50/50 rounded-lg px-2 -mx-2 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`${meta.bgColor} p-2 rounded-lg shrink-0`}>
                      <Icon size={16} className={meta.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-gray-800 text-sm">
                          {ENTITY_LABELS[item.entityType] || item.entityType}
                        </span>
                        <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                          meta.bgColor, meta.color)}>
                          {meta.label}
                        </span>
                        <ChevronRight size={12} className="text-gray-300" />
                        <span className="text-xs text-gray-500">{item.action}</span>
                      </div>
                      {summary && (
                        <div className="text-xs text-gray-600 mb-1 font-mono truncate max-w-md" title={summary}>
                          {summary}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                        <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">
                          {item.entityId?.slice(0, 10)}
                        </span>
                        {item.retryCount !== undefined && item.retryCount > 0 && (
                          <span>重试 {item.retryCount} 次</span>
                        )}
                        {item.errorMessage && (
                          <span className="text-red-500 truncate max-w-xs" title={item.errorMessage}>
                            {item.errorMessage}
                          </span>
                        )}
                        {item.lastAttempt && (
                          <span>{new Date(item.lastAttempt).toLocaleString('zh-CN')}</span>
                        )}
                      </div>
                    </div>
                    {(item.status === 'failed' || item.status === 'pending') && (
                      <button
                        onClick={() => handleRetryItem(item)}
                        className="text-xs text-[#1e3a5f] hover:underline shrink-0 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        重试
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
