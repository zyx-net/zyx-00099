import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  Plus, Search, X, Check, Package,
  Warehouse, ArrowRightLeft, Eye
} from 'lucide-react';
import { Material, MaterialStockBatch } from '@/types';
import {
  formatDate, generateBatchNumber
} from '@/utils/helpers';
import { canManageStock } from '@/utils/permissions';

interface StockEntry {
  materialId: string;
  storeId: string;
  quantity: number;
  receivedDate: string;
  remark: string;
}

interface AdjustmentEntry {
  materialId: string;
  storeId: string;
  quantity: number;
  reason: string;
}

export default function StockManagement() {
  const {
    materials, materialBatches, stores, currentUser, addToast,
    addStockBatch, adjustStock
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [showBatchDetails, setShowBatchDetails] = useState<{ materialId: string; storeId: string } | null>(null);
  const [entryForm, setEntryForm] = useState<StockEntry>({
    materialId: '',
    storeId: '',
    quantity: 1,
    receivedDate: new Date().toISOString().slice(0, 10),
    remark: '',
  });
  const [adjustForm, setAdjustForm] = useState<AdjustmentEntry>({
    materialId: '',
    storeId: '',
    quantity: 0,
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const canManage = canManageStock(currentUser);

  const stockDistribution = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    materialBatches.forEach(batch => {
      const storeMap = map.get(batch.materialId) || new Map<string, number>();
      const current = storeMap.get(batch.storeId) || 0;
      storeMap.set(batch.storeId, current + batch.quantity);
      map.set(batch.materialId, storeMap);
    });
    return map;
  }, [materialBatches]);

  const filteredMaterials = useMemo(() => {
    return materials.filter(m => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q);
      }
      return true;
    }).filter(m => {
      if (storeFilter !== 'all') {
        const storeMap = stockDistribution.get(m.id);
        return storeMap && (storeMap.get(storeFilter) || 0) > 0;
      }
      return true;
    });
  }, [materials, searchQuery, storeFilter, stockDistribution]);

  const getBatchDetails = (materialId: string, storeId: string) => {
    return materialBatches
      .filter(b => b.materialId === materialId && b.storeId === storeId)
      .sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime());
  };

  const openEntryDialog = () => {
    setEntryForm({
      materialId: materials[0]?.id || '',
      storeId: stores[0]?.id || '',
      quantity: 1,
      receivedDate: new Date().toISOString().slice(0, 10),
      remark: '',
    });
    setShowEntryDialog(true);
  };

  const openAdjustDialog = () => {
    setAdjustForm({
      materialId: materials[0]?.id || '',
      storeId: stores[0]?.id || '',
      quantity: 0,
      reason: '',
    });
    setShowAdjustDialog(true);
  };

  const handleEntrySubmit = async () => {
    if (!entryForm.materialId) {
      addToast('error', '请选择物资');
      return;
    }
    if (!entryForm.storeId) {
      addToast('error', '请选择门店');
      return;
    }
    if (entryForm.quantity <= 0) {
      addToast('error', '入库数量必须大于 0');
      return;
    }

    setSubmitting(true);
    try {
      await addStockBatch({
        materialId: entryForm.materialId,
        storeId: entryForm.storeId,
        batchNumber: generateBatchNumber(),
        quantity: entryForm.quantity,
        receivedDate: new Date(entryForm.receivedDate).toISOString(),
        remark: entryForm.remark.trim(),
      });
      addToast('success', '入库成功');
      setShowEntryDialog(false);
    } catch (e) {
      addToast('error', (e as Error).message || '入库失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustSubmit = async () => {
    if (!adjustForm.materialId) {
      addToast('error', '请选择物资');
      return;
    }
    if (!adjustForm.storeId) {
      addToast('error', '请选择门店');
      return;
    }
    if (adjustForm.quantity === 0) {
      addToast('error', '调整数量不能为 0');
      return;
    }
    if (!adjustForm.reason.trim()) {
      addToast('error', '请填写调整原因');
      return;
    }

    setSubmitting(true);
    try {
      await adjustStock(
        adjustForm.materialId,
        adjustForm.storeId,
        adjustForm.quantity,
        adjustForm.reason.trim()
      );
      addToast('success', '库存调整成功');
      setShowAdjustDialog(false);
    } catch (e) {
      addToast('error', (e as Error).message || '库存调整失败');
    } finally {
      setSubmitting(false);
    }
  };

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || id;
  const getMaterialCode = (id: string) => materials.find(m => m.id === id)?.code || id;
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索物资名称/编号..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
            />
          </div>
          <select
            value={storeFilter}
            onChange={e => setStoreFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="all">全部门店</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={openAdjustDialog}
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ArrowRightLeft size={18} />
              库存调整
            </button>
            <button
              onClick={openEntryDialog}
              className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
            >
              <Plus size={18} />
              入库
            </button>
          </div>
        )}
      </div>

      {filteredMaterials.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-12 text-center">
          <Warehouse size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">暂无库存数据</h3>
          <p className="text-sm text-gray-400">先在物资目录中添加物资，然后执行入库操作</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMaterials.map(material => {
            const storeMap = stockDistribution.get(material.id);
            if (!storeMap) return null;

            const storeStocks = Array.from(storeMap.entries())
              .filter(([storeId]) => storeFilter === 'all' || storeId === storeFilter)
              .filter(([, qty]) => qty > 0);

            if (storeStocks.length === 0) return null;

            return (
              <div key={material.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#1e3a5f]/10 flex items-center justify-center">
                      <Package className="text-[#1e3a5f]" size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800">{material.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{material.code} · {material.unit}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-gray-500">总库存</div>
                      <div className="text-lg font-bold text-gray-800 font-mono">{material.totalStock} {material.unit}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">可用</div>
                      <div className={cn(
                        'text-lg font-bold font-mono',
                        material.availableStock <= (material.minStock || 0) ? 'text-red-600' : 'text-green-600'
                      )}>
                        {material.availableStock} {material.unit}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {storeStocks.map(([storeId, qty]) => (
                      <div
                        key={storeId}
                        className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-gray-700">{getStoreName(storeId)}</div>
                          <button
                            onClick={() => setShowBatchDetails({ materialId: material.id, storeId })}
                            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="查看批次"
                          >
                            <Eye size={16} />
                          </button>
                        </div>
                        <div className="text-2xl font-bold text-[#1e3a5f] font-mono">
                          {qty} <span className="text-sm font-normal text-gray-500">{material.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showEntryDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Warehouse size={20} className="text-[#1e3a5f]" />
                物资入库
              </h3>
              <button
                onClick={() => setShowEntryDialog(false)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择物资</label>
                <select
                  value={entryForm.materialId}
                  onChange={e => setEntryForm({ ...entryForm, materialId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">请选择物资</option>
                  {materials.filter(m => m.status === 'active').map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">入库门店</label>
                <select
                  value={entryForm.storeId}
                  onChange={e => setEntryForm({ ...entryForm, storeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">请选择门店</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">入库数量</label>
                  <input
                    type="number"
                    min={1}
                    value={entryForm.quantity}
                    onChange={e => setEntryForm({ ...entryForm, quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">接收日期</label>
                  <input
                    type="date"
                    value={entryForm.receivedDate}
                    onChange={e => setEntryForm({ ...entryForm, receivedDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={entryForm.remark}
                  onChange={e => setEntryForm({ ...entryForm, remark: e.target.value })}
                  placeholder="可选"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowEntryDialog(false)}
                disabled={submitting}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleEntrySubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors disabled:opacity-50"
              >
                <Check size={18} />
                {submitting ? '提交中...' : '确认入库'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdjustDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <ArrowRightLeft size={20} className="text-orange-500" />
                库存调整
              </h3>
              <button
                onClick={() => setShowAdjustDialog(false)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择物资</label>
                <select
                  value={adjustForm.materialId}
                  onChange={e => setAdjustForm({ ...adjustForm, materialId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">请选择物资</option>
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">门店</label>
                <select
                  value={adjustForm.storeId}
                  onChange={e => setAdjustForm({ ...adjustForm, storeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">请选择门店</option>
                  {stores.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  调整数量 <span className="text-gray-400 text-xs font-normal">（正数增加，负数减少）</span>
                </label>
                <input
                  type="number"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm({ ...adjustForm, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">调整原因</label>
                <textarea
                  value={adjustForm.reason}
                  onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  placeholder="请说明调整原因"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowAdjustDialog(false)}
                disabled={submitting}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAdjustSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                <Check size={18} />
                {submitting ? '提交中...' : '确认调整'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchDetails && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">
                批次详情 - {getMaterialName(showBatchDetails.materialId)} @ {getStoreName(showBatchDetails.storeId)}
              </h3>
              <button
                onClick={() => setShowBatchDetails(null)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {getBatchDetails(showBatchDetails.materialId, showBatchDetails.storeId).length === 0 ? (
                <div className="text-center py-8 text-gray-400">暂无批次记录</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-gray-600">批次号</th>
                      <th className="text-right px-4 py-2 font-semibold text-gray-600">数量</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-600">接收日期</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-600">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {getBatchDetails(showBatchDetails.materialId, showBatchDetails.storeId).map(batch => (
                      <tr key={batch.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{batch.batchNumber}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-gray-800">{batch.quantity}</td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(batch.receivedDate)}</td>
                        <td className="px-4 py-3 text-gray-500">{batch.remark || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
