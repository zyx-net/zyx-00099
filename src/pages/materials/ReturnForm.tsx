import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  Search, X, Check, RotateCcw,
  Package, AlertCircle, User
} from 'lucide-react';
import { MaterialBorrowForm } from '@/types';
import {
  MATERIAL_BORROW_STATUS_LABELS, MATERIAL_BORROW_STATUS_COLORS,
  formatDate
} from '@/utils/helpers';
import {
  canReturnMaterial, canManageMaterial
} from '@/utils/permissions';

type ReturnCondition = 'good' | 'minor_damage' | 'severe_damage';

interface ReturnFormData {
  quantity: number;
  condition: ReturnCondition;
  remark: string;
}

const CONDITION_OPTIONS: { value: ReturnCondition; label: string; color: string }[] = [
  { value: 'good', label: '完好', color: 'bg-green-100 text-green-700 border-green-300' },
  { value: 'minor_damage', label: '轻微损坏', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  { value: 'severe_damage', label: '严重损坏', color: 'bg-red-100 text-red-700 border-red-300' },
];

export default function ReturnForm() {
  const {
    materials, materialBorrowForms, stores, currentUser, addToast,
    returnBorrowForm
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showReturnDialog, setShowReturnDialog] = useState<MaterialBorrowForm | null>(null);
  const [returnForm, setReturnForm] = useState<ReturnFormData>({
    quantity: 0,
    condition: 'good',
    remark: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const canReturnOwn = canReturnMaterial(currentUser);
  const canViewAll = canManageMaterial(currentUser);

  const getReturnedQuantity = (form: MaterialBorrowForm) => {
    return (form as any).returnedQuantity ?? 0;
  };

  const pendingReturns = useMemo(() => {
    return materialBorrowForms.filter(form => {
      if (form.status !== 'pending' && form.status !== 'borrowed') return false;
      if (!canViewAll) {
        if (currentUser?.role === 'inspector') {
          if (form.borrowerId !== currentUser?.id) return false;
        } else if (currentUser?.role === 'manager') {
          if (form.storeId !== currentUser?.storeId) return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [materialBorrowForms, canViewAll, currentUser]);

  const filteredForms = useMemo(() => {
    if (!searchQuery) return pendingReturns;
    const q = searchQuery.toLowerCase();
    return pendingReturns.filter(form => {
      const material = materials.find(m => m.id === form.materialId);
      return form.formNumber.toLowerCase().includes(q)
        || (material?.name?.toLowerCase().includes(q) || false)
        || form.borrowerName?.toLowerCase().includes(q);
    });
  }, [pendingReturns, searchQuery, materials]);

  const openReturnDialog = (form: MaterialBorrowForm) => {
    if (!canReturnMaterial(currentUser, form)) {
      addToast('error', '您无权归还此借用单');
      return;
    }
    const returnedQty = getReturnedQuantity(form);
    const remainingQty = form.quantity - returnedQty;
    setReturnForm({
      quantity: remainingQty,
      condition: 'good',
      remark: '',
    });
    setShowReturnDialog(form);
  };

  const handleReturnSubmit = async () => {
    if (!showReturnDialog) return;
    const form = showReturnDialog;
    const returnedQty = getReturnedQuantity(form);
    const remainingQty = form.quantity - returnedQty;

    if (returnForm.quantity <= 0) {
      addToast('error', '归还数量必须大于 0');
      return;
    }
    if (returnForm.quantity > remainingQty) {
      addToast('error', `归还数量不能超过未归还数量 ${remainingQty}`);
      return;
    }

    if (currentUser?.storeId && form.storeId !== currentUser.storeId && canViewAll === false) {
      addToast('error', `跨门店归还不被允许：借用门店为「${getStoreName(form.storeId)}」`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await returnBorrowForm(form.id, {
        quantity: returnForm.quantity,
        condition: returnForm.condition,
        remark: returnForm.remark.trim(),
        actualReturnDate: new Date().toISOString(),
      });
      if (!result.success) {
        addToast('error', result.error || '归还失败');
        return;
      }
      addToast('success', '归还登记成功');
      setShowReturnDialog(null);
    } catch (e) {
      addToast('error', (e as Error).message || '归还失败');
    } finally {
      setSubmitting(false);
    }
  };

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || '-';
  const getMaterialUnit = (id: string) => materials.find(m => m.id === id)?.unit || '';
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[250px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="搜索单号/物资/借用人..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="text-sm text-gray-500">
          待归还 <span className="font-semibold text-[#1e3a5f]">{pendingReturns.length}</span> 项
        </div>
      </div>

      {filteredForms.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-12 text-center">
          <RotateCcw size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">暂无待归还记录</h3>
          <p className="text-sm text-gray-400">
            {currentUser?.role === 'inspector'
              ? '您当前没有未归还的借用物资'
              : '当前没有待归还的借用单'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredForms.map(form => {
            const returnedQty = getReturnedQuantity(form);
            const remainingQty = form.quantity - returnedQty;
            const isOverdue = form.expectedReturnDate
              && new Date(form.expectedReturnDate) < new Date()
              && remainingQty > 0;
            const canReturn = canReturnMaterial(currentUser, form);
            return (
              <div
                key={form.id}
                className={cn(
                  'bg-white rounded-xl border overflow-hidden transition-colors',
                  isOverdue ? 'border-red-300' : 'border-gray-200 hover:border-blue-200'
                )}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="font-mono text-xs text-gray-500">{form.formNumber}</span>
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                          MATERIAL_BORROW_STATUS_COLORS[form.status]
                        )}>
                          {MATERIAL_BORROW_STATUS_LABELS[form.status]}
                        </span>
                        {isOverdue && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                            <AlertCircle size={10} />
                            已逾期
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <Package size={18} className="text-[#1e3a5f]" />
                        <span className="font-semibold text-gray-800 text-lg">
                          {getMaterialName(form.materialId)}
                        </span>
                        <span className="text-gray-500 text-sm">
                          × {remainingQty} {getMaterialUnit(form.materialId)}
                        </span>
                      </div>
                      {returnedQty > 0 && (
                        <div className="text-sm text-gray-500 mb-2">
                          已归还 {returnedQty} / {form.quantity} {getMaterialUnit(form.materialId)}
                          {remainingQty > 0 && (
                            <span className="text-orange-600 ml-2">（剩余 {remainingQty} 未还）</span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <User size={12} />
                          {form.borrowerName || form.borrowerId}
                        </span>
                        <span>门店：{getStoreName(form.storeId)}</span>
                        {form.expectedReturnDate && (
                          <span>预计归还：{formatDate(form.expectedReturnDate)}</span>
                        )}
                        <span>借出时间：{formatDate(form.createdAt)}</span>
                      </div>
                      {form.purpose && (
                        <div className="mt-2 text-sm text-gray-600 bg-gray-50 rounded px-3 py-2">
                          用途：{form.purpose}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      {canReturn && (
                        <button
                          onClick={() => openReturnDialog(form)}
                          className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
                        >
                          <RotateCcw size={16} />
                          归还
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showReturnDialog && (() => {
        const form = showReturnDialog;
        const returnedQty = getReturnedQuantity(form);
        const remainingQty = form.quantity - returnedQty;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <RotateCcw size={20} className="text-green-600" />
                  归还登记
                </h3>
                <button
                  onClick={() => setShowReturnDialog(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <div className="text-sm text-gray-500 mb-1 font-mono">{form.formNumber}</div>
                  <div className="font-semibold text-gray-800 text-lg">
                    {getMaterialName(form.materialId)}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    借用人：{form.borrowerName || form.borrowerId}
                    {returnedQty > 0 && (
                      <span className="ml-2">（已还 {returnedQty}，剩余 {remainingQty}）</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    归还数量 <span className="text-gray-400 text-xs font-normal">（最多 {remainingQty}）</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={remainingQty}
                    value={returnForm.quantity}
                    onChange={e => setReturnForm({
                      ...returnForm,
                      quantity: Math.min(remainingQty, Math.max(1, Number(e.target.value) || 1))
                    })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">归还时状态</label>
                  <div className="grid grid-cols-3 gap-2">
                    {CONDITION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setReturnForm({ ...returnForm, condition: opt.value })}
                        className={cn(
                          'px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors',
                          returnForm.condition === opt.value
                            ? opt.color + ' border-current'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={returnForm.remark}
                    onChange={e => setReturnForm({ ...returnForm, remark: e.target.value })}
                    placeholder="可选，如损坏情况说明等"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                <button
                  onClick={() => setShowReturnDialog(null)}
                  disabled={submitting}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleReturnSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Check size={18} />
                  {submitting ? '提交中...' : '确认归还'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
