import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import {
  History, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Plus,
  Minus, Search, Filter, Package, Building2
} from 'lucide-react';
import type { MaterialRecord, MaterialRecordType } from '@/types';

const TYPE_META: Record<MaterialRecordType, { icon: any; label: string; color: string; bgColor: string }> = {
  borrow: { icon: ArrowUpFromLine, label: '借出', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  return: { icon: ArrowDownToLine, label: '归还', color: 'text-green-700', bgColor: 'bg-green-100' },
  loss: { icon: AlertTriangle, label: '报损', color: 'text-red-700', bgColor: 'bg-red-100' },
  restock: { icon: Plus, label: '入库', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  adjust: { icon: Package, label: '调整', color: 'text-amber-700', bgColor: 'bg-amber-100' },
};

const LOSS_REASON_LABELS: Record<string, string> = {
  damage: '损坏', lost: '遗失', expired: '过期', wear: '正常损耗', other: '其他',
};

export default function MaterialHistory() {
  const { currentUser, materialRecords, materials, stores, materialBorrowForms } = useAppStore();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStore, setFilterStore] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('30');

  const visibleStores = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'supervisor') return stores;
    return stores.filter(s => s.id === currentUser.storeId);
  }, [currentUser, stores]);

  const filteredRecords = useMemo(() => {
    const storeIds = visibleStores.map(s => s.id);
    let records = materialRecords.slice();

    if (currentUser?.role === 'manager' || currentUser?.role === 'inspector') {
      records = records.filter(r => storeIds.includes(r.storeId));
      if (currentUser?.role === 'inspector') {
        const myFormIds = materialBorrowForms.filter(f => f.borrowerId === currentUser.id).map(f => f.id);
        records = records.filter(r =>
          r.formId ? myFormIds.includes(r.formId) : true
        );
      }
    }

    if (filterType !== 'all') {
      records = records.filter(r => r.type === filterType);
    }

    if (filterStore !== 'all') {
      records = records.filter(r => r.storeId === filterStore);
    }

    if (dateRange !== 'all') {
      const days = parseInt(dateRange);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      records = records.filter(r => new Date(r.timestamp).getTime() >= cutoff);
    }

    if (search) {
      const lower = search.toLowerCase();
      records = records.filter(r => {
        const m = materials.find(mm => mm.id === r.materialId);
        const s = stores.find(ss => ss.id === r.storeId);
        return (
          m?.name.toLowerCase().includes(lower) ||
          m?.code.toLowerCase().includes(lower) ||
          s?.name.toLowerCase().includes(lower) ||
          r.remark?.toLowerCase().includes(lower) ||
          r.operatorName?.toLowerCase().includes(lower)
        );
      });
    }

    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return records;
  }, [materialRecords, visibleStores, filterType, filterStore, dateRange, search, materials, stores, currentUser, materialBorrowForms]);

  const typeStats = useMemo(() => {
    const stats: Record<string, number> = { all: materialRecords.length };
    for (const r of materialRecords) {
      stats[r.type] = (stats[r.type] || 0) + 1;
    }
    return stats;
  }, [materialRecords]);

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || '-';
  const getMaterialCode = (id: string) => materials.find(m => m.id === id)?.code || '-';
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || '-';

  const getRecordSummary = (r: MaterialRecord) => {
    if (r.type === 'loss') {
      return `原因: ${LOSS_REASON_LABELS[r.remark || ''] || r.remark || '-'}`;
    }
    if (r.type === 'restock') {
      return r.batchId ? `批次: ${r.batchId}` : '';
    }
    if (r.type === 'borrow' && r.formId) {
      const borrowForm = materialBorrowForms.find(f => f.id === r.formId);
      return borrowForm?.expectedReturnDate ? `预计归还: ${borrowForm.expectedReturnDate}` : '';
    }
    if (r.remark) return `备注: ${r.remark}`;
    return '';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索物资、门店、经手人..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-gray-400" />
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            >
              <option value="all">全部类型 ({typeStats.all || 0})</option>
              {Object.entries(TYPE_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label} ({typeStats[k] || 0})</option>
              ))}
            </select>

            <select
              value={filterStore}
              onChange={e => setFilterStore(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            >
              <option value="all">全部门店</option>
              {visibleStores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            >
              <option value="7">最近7天</option>
              <option value="30">最近30天</option>
              <option value="90">最近90天</option>
              <option value="all">全部时间</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <History size={18} className="text-[#1e3a5f]" />
            历史记录
          </h3>
          <span className="text-sm text-gray-500">
            共 {filteredRecords.length} 条
          </span>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="p-12 text-center">
            <History size={40} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">暂无记录</h3>
            <p className="text-sm text-gray-400">没有符合条件的操作记录</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
            {filteredRecords.map(r => {
              const meta = TYPE_META[r.type];
              const Icon = meta.icon;
              const summary = getRecordSummary(r);
              return (
                <div key={r.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`${meta.bgColor} p-2 rounded-lg shrink-0`}>
                        <Icon size={16} className={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.bgColor} ${meta.color}`}>
                            {meta.label}
                          </span>
                          <span className="font-mono text-xs text-gray-400">{getMaterialCode(r.materialId)}</span>
                        </div>
                        <div className="font-medium text-gray-800 mb-1">
                          {getMaterialName(r.materialId)}
                          <span className="ml-2 text-sm text-gray-500">× {r.quantity}</span>
                          {r.afterStock !== undefined && r.afterStock !== -1 && (
                            <span className="ml-2 text-xs text-gray-400">(库存: {r.afterStock})</span>
                          )}
                        </div>
                        {summary && (
                          <div className="text-sm text-gray-600 mb-1">{summary}</div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Building2 size={10} />
                            {getStoreName(r.storeId)}
                          </span>
                          {r.operatorName && <span>经手人: {r.operatorName}</span>}
                          {r.relatedUserName && <span>关联人: {r.relatedUserName}</span>}
                          {r.formId && (
                            <span className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">
                              单据: {r.formId.slice(0, 8)}
                            </span>
                          )}
                          <span>{new Date(r.timestamp).toLocaleString('zh-CN')}</span>
                        </div>
                      </div>
                    </div>
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
