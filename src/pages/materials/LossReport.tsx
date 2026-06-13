import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import { AlertTriangle, Plus, Search, Building2, FileText, X } from 'lucide-react';
import { canReportLoss } from '@/utils/permissions';
import { LOSS_REASONS } from '@/utils/helpers';

interface ReportLossForm {
  materialId: string;
  storeId: string;
  quantity: number;
  lossReason: string;
  remark: string;
}

const LOSS_REASON_LABELS: Record<string, string> = {
  damage: '损坏', lost: '遗失', expired: '过期', wear: '正常损耗', other: '其他',
};

export default function LossReport() {
  const {
    currentUser,
    materials,
    stores,
    materialRecords,
    reportLoss,
    addToast,
  } = useAppStore();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<ReportLossForm>({
    materialId: '',
    storeId: currentUser?.storeId || stores[0]?.id || '',
    quantity: 1,
    lossReason: 'damage',
    remark: '',
  });

  const canReport = canReportLoss(currentUser);

  const visibleStores = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'supervisor') return stores;
    return stores.filter(s => s.id === currentUser.storeId);
  }, [currentUser, stores]);

  const lossRecords = useMemo(() => {
    const storeIds = visibleStores.map(s => s.id);
    let records = materialRecords.filter(r => r.type === 'loss');

    if (currentUser?.role !== 'supervisor') {
      records = records.filter(r => storeIds.includes(r.storeId));
    }

    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (!search) return records;

    const searchLower = search.toLowerCase();
    return records.filter(r => {
      const material = materials.find(m => m.id === r.materialId);
      const store = stores.find(s => s.id === r.storeId);
      return (
        material?.name.toLowerCase().includes(searchLower) ||
        material?.code.toLowerCase().includes(searchLower) ||
        store?.name.toLowerCase().includes(searchLower) ||
        r.remark?.toLowerCase().includes(searchLower)
      );
    });
  }, [materialRecords, materials, stores, search, currentUser, visibleStores]);

  const selectedMaterial = useMemo(
    () => materials.find(m => m.id === form.materialId) || null,
    [materials, form.materialId]
  );

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || '-';
  const getMaterialCode = (id: string) => materials.find(m => m.id === id)?.code || '-';
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || id;

  const resetForm = () => {
    setForm({
      materialId: '',
      storeId: currentUser?.storeId || visibleStores[0]?.id || '',
      quantity: 1,
      lossReason: 'damage',
      remark: '',
    });
  };

  const handleSubmit = async () => {
    if (!currentUser || !canReport) return;

    if (!form.materialId) { addToast('error', '请选择物资'); return; }
    if (!form.storeId) { addToast('error', '请选择门店'); return; }
    if (form.quantity <= 0) { addToast('error', '报损数量必须大于0'); return; }
    if (selectedMaterial && form.quantity > selectedMaterial.availableStock) {
      addToast('error', `报损数量不能超过当前库存(${selectedMaterial.availableStock})`); return;
    }
    if (!form.lossReason) { addToast('error', '请选择报损原因'); return; }

    setSubmitting(true);
    try {
      const result = await reportLoss(
        form.materialId,
        form.storeId,
        form.quantity,
        form.lossReason,
        `${LOSS_REASON_LABELS[form.lossReason] || form.lossReason}${form.remark.trim() ? '：' + form.remark.trim() : ''}`
      );

      if (!result.success) {
        addToast('error', result.error || '报损登记失败');
        return;
      }
      addToast('success', '报损登记成功');
      setShowDialog(false);
      resetForm();
    } catch (e) {
      addToast('error', (e as Error).message || '报损登记失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <AlertTriangle size={40} className="mx-auto text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">请先选择身份</h3>
        <p className="text-sm text-gray-400">登录后可进行报损登记</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="搜索报损记录..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            />
          </div>
        </div>
        {canReport && (
          <button onClick={() => { resetForm(); setShowDialog(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
            <Plus size={18} />新增报损
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-600" />
            报损记录
          </h3>
          <span className="text-sm text-gray-500">
            共 {lossRecords.length} 条
          </span>
        </div>

        {lossRecords.length === 0 ? (
          <div className="p-12 text-center">
            <AlertTriangle size={40} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">暂无报损记录</h3>
            <p className="text-sm text-gray-400">没有符合条件的报损记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">时间</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">物资</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">门店</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">数量</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">原因</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">备注</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">经手人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lossRecords.map(record => {
                  const reasonMatch = record.remark?.match(/^([^：]+)(?:：(.+))?$/);
                  const reason = reasonMatch?.[1] || record.remark || '-';
                  const detail = reasonMatch?.[2] || '';
                  return (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(record.timestamp).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">
                          {getMaterialName(record.materialId)}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">
                          {getMaterialCode(record.materialId)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <span className="flex items-center gap-1">
                          <Building2 size={12} />
                          {getStoreName(record.storeId)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-red-600">
                        {record.quantity}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                          {reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm">
                        {detail || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {record.operatorName || record.operatorId || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <AlertTriangle size={20} className="text-red-600" />
                新增报损
              </h3>
              <button
                onClick={() => { setShowDialog(false); resetForm(); }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择物资</label>
                <select
                  value={form.materialId}
                  onChange={e => setForm({ ...form, materialId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                >
                  <option value="">请选择物资</option>
                  {materials.filter(m => m.status === 'active' && m.availableStock > 0).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code}) - 库存 {m.availableStock} {m.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">门店</label>
                <select
                  value={form.storeId}
                  onChange={e => setForm({ ...form, storeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  disabled={visibleStores.length === 1}
                >
                  <option value="">请选择门店</option>
                  {visibleStores.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">报损数量</label>
                  <input
                    type="number"
                    min={1}
                    max={selectedMaterial?.availableStock || 1}
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: Math.min(selectedMaterial?.availableStock || 1, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                  {selectedMaterial && (
                    <div className="text-xs text-gray-400 mt-1">
                      可用库存: {selectedMaterial.availableStock} {selectedMaterial.unit}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">报损原因</label>
                  <select
                    value={form.lossReason}
                    onChange={e => setForm({ ...form, lossReason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  >
                    {LOSS_REASONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注说明</label>
                <textarea
                  value={form.remark}
                  onChange={e => setForm({ ...form, remark: e.target.value })}
                  placeholder="可选，详细说明报损情况"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                />
              </div>
              {selectedMaterial && form.quantity > selectedMaterial.availableStock && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  ⚠ 报损数量不能超过当前库存 ({selectedMaterial.availableStock} {selectedMaterial.unit})
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => { setShowDialog(false); resetForm(); }}
                disabled={submitting}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !form.materialId || !form.storeId || form.quantity <= 0 || (selectedMaterial && form.quantity > selectedMaterial.availableStock)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>确认报损</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
