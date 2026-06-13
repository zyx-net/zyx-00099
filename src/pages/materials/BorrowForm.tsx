import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  Plus, Search, X, Check, FileText,
  Calendar, User, AlertTriangle, Save, Send
} from 'lucide-react';
import { Material, MaterialBorrowForm, MaterialBorrowStatus } from '@/types';
import {
  MATERIAL_BORROW_STATUS_LABELS, MATERIAL_BORROW_STATUS_COLORS,
  formatDate, generateBorrowFormNumber
} from '@/utils/helpers';
import {
  canBorrowMaterial, canManageMaterial
} from '@/utils/permissions';

interface BorrowFormData {
  materialId: string;
  storeId: string;
  quantity: number;
  expectedReturnDate: string;
  purpose: string;
}

export default function BorrowFormPage() {
  const {
    materials, materialBorrowForms, stores, currentUser, addToast,
    createBorrowForm, submitBorrowForm, updateBorrowForm, cancelBorrowForm,
    currentMaterialDraft, saveMaterialDraft, clearMaterialDraft
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MaterialBorrowStatus | 'all'>('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editingForm, setEditingForm] = useState<MaterialBorrowForm | null>(null);
  const [formData, setFormData] = useState<BorrowFormData>({
    materialId: '',
    storeId: '',
    quantity: 1,
    expectedReturnDate: '',
    purpose: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [conflictAlert, setConflictAlert] = useState<{ type: string; message: string } | null>(null);

  useEffect(() => {
    if (currentMaterialDraft && !editingForm) {
      const draft = currentMaterialDraft as any;
      setFormData({
        materialId: draft.materialId || '',
        storeId: draft.storeId || '',
        quantity: draft.quantity || 1,
        expectedReturnDate: draft.expectedReturnDate
          ? new Date(draft.expectedReturnDate).toISOString().slice(0, 10)
          : '',
        purpose: draft.purpose || '',
      });
    }
  }, [currentMaterialDraft]);

  const canCreate = canBorrowMaterial(currentUser);
  const canViewAll = canManageMaterial(currentUser);

  const availableMaterials = useMemo(() => {
    return materials.filter(m => m.status === 'active' && m.availableStock > 0);
  }, [materials]);

  const accessibleStoreIds = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'supervisor') return stores.map(s => s.id);
    if (currentUser.role === 'manager') return currentUser.storeId ? [currentUser.storeId] : [];
    return currentUser.storeId ? [currentUser.storeId] : [];
  }, [currentUser, stores]);

  const filteredForms = useMemo(() => {
    return materialBorrowForms.filter(form => {
      if (statusFilter !== 'all' && form.status !== statusFilter) return false;
      if (!canViewAll) {
        if (currentUser?.role === 'inspector') {
          if (form.borrowerId !== currentUser?.id) return false;
        } else if (currentUser?.role === 'manager') {
          if (form.storeId !== currentUser?.storeId) return false;
        }
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const material = materials.find(m => m.id === form.materialId);
        return form.formNumber.toLowerCase().includes(q)
          || (material?.name?.toLowerCase().includes(q) || false)
          || form.purpose?.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [materialBorrowForms, statusFilter, searchQuery, canViewAll, currentUser, materials]);

  const openCreateDialog = () => {
    setEditingForm(null);
    setConflictAlert(null);
    setFormData({
      materialId: availableMaterials[0]?.id || '',
      storeId: accessibleStoreIds[0] || '',
      quantity: 1,
      expectedReturnDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      purpose: '',
    });
    setShowDialog(true);
  };

  const openEditDialog = (form: MaterialBorrowForm) => {
    if (!canCreate || form.borrowerId !== currentUser?.id || form.status !== 'draft') return;
    setEditingForm(form);
    setConflictAlert(null);
    setFormData({
      materialId: form.materialId,
      storeId: form.storeId,
      quantity: form.quantity,
      expectedReturnDate: form.expectedReturnDate
        ? new Date(form.expectedReturnDate).toISOString().slice(0, 10)
        : '',
      purpose: form.purpose || '',
    });
    setShowDialog(true);
  };

  const closeDialog = async () => {
    setShowDialog(false);
    setEditingForm(null);
    setFormData({
      materialId: '',
      storeId: '',
      quantity: 1,
      expectedReturnDate: '',
      purpose: '',
    });
    setConflictAlert(null);
    if (!editingForm && formData.materialId) {
      await clearMaterialDraft();
    }
  };

  const handleAutoSave = async () => {
    if (!currentUser) return;
    await saveMaterialDraft({
      ...formData,
      formNumber: editingForm?.formNumber || generateBorrowFormNumber(),
      borrowerId: currentUser.id,
      borrowerName: currentUser.name,
      borrowerRole: currentUser.role,
      status: 'draft' as MaterialBorrowStatus,
    });
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!currentUser) return;
    if (!formData.materialId) {
      addToast('error', '请选择物资');
      return;
    }
    if (!formData.storeId) {
      addToast('error', '请选择门店');
      return;
    }
    if (formData.quantity <= 0) {
      addToast('error', '借用数量必须大于 0');
      return;
    }
    const material = materials.find(m => m.id === formData.materialId);
    if (!material) {
      addToast('error', '物资不存在');
      return;
    }
    if (formData.quantity > material.availableStock) {
      addToast('error', `库存不足，当前可用库存：${material.availableStock} ${material.unit}`);
      return;
    }

    setSubmitting(true);
    try {
      const baseData = {
        materialId: formData.materialId,
        storeId: formData.storeId,
        quantity: formData.quantity,
        expectedReturnDate: formData.expectedReturnDate
          ? new Date(formData.expectedReturnDate).toISOString()
          : undefined,
        purpose: formData.purpose.trim(),
        borrowerId: currentUser.id,
        borrowerName: currentUser.name,
        borrowerRole: currentUser.role,
      };

      if (editingForm) {
        if (asDraft) {
          await updateBorrowForm(editingForm.id, { ...baseData, status: 'draft' });
          addToast('success', '草稿已保存');
        } else {
          await updateBorrowForm(editingForm.id, { ...baseData, status: 'pending' });
          const result = await submitBorrowForm(editingForm.id);
          if (!result.success) {
            if (result.conflicts && result.conflicts.length > 0) {
              setConflictAlert(result.conflicts[0]);
              setSubmitting(false);
              return;
            }
            addToast('error', result.error || '提交失败');
            setSubmitting(false);
            return;
          }
          addToast('success', '借用单已提交');
        }
      } else {
        if (asDraft) {
          await createBorrowForm({ ...baseData, status: 'draft' });
          await clearMaterialDraft();
          addToast('success', '草稿已保存');
        } else {
          const createResult = await createBorrowForm({ ...baseData, status: 'pending' });
          if (!createResult.success) {
            if (createResult.conflicts && createResult.conflicts.length > 0) {
              setConflictAlert(createResult.conflicts[0]);
              setSubmitting(false);
              return;
            }
            addToast('error', createResult.error || '创建失败');
            setSubmitting(false);
            return;
          }
          if (createResult.form) {
            const submitResult = await submitBorrowForm(createResult.form.id);
            if (!submitResult.success) {
              if (submitResult.conflicts && submitResult.conflicts.length > 0) {
                setConflictAlert(submitResult.conflicts[0]);
                setSubmitting(false);
                return;
              }
              addToast('error', submitResult.error || '提交失败');
              setSubmitting(false);
              return;
            }
          }
          await clearMaterialDraft();
          addToast('success', '借用单已提交');
        }
      }
      await closeDialog();
    } catch (e) {
      addToast('error', (e as Error).message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (form: MaterialBorrowForm) => {
    try {
      await cancelBorrowForm(form.id);
      addToast('success', '借用单已取消');
    } catch (e) {
      addToast('error', (e as Error).message || '取消失败');
    }
  };

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || '-';
  const getMaterialUnit = (id: string) => materials.find(m => m.id === id)?.unit || '';
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || id;

  const statusOptions: (MaterialBorrowStatus | 'all')[] = [
    'all', 'draft', 'pending', 'borrowed', 'returned', 'lost', 'cancelled'
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="搜索单号/物资/用途..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as MaterialBorrowStatus | 'all')}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {statusOptions.map(s => (
              <option key={s} value={s}>
                {s === 'all' ? '全部状态' : MATERIAL_BORROW_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {canCreate && (
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
          >
            <Plus size={18} />
            新建借用
          </button>
        )}
      </div>

      {filteredForms.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-12 text-center">
          <FileText size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">暂无借用记录</h3>
          <p className="text-sm text-gray-400">点击右上角按钮新建借用单</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">单号</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">物资</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">门店</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">数量</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">借用人</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">预计归还</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">状态</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">创建时间</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredForms.map(form => (
                <tr key={form.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{form.formNumber}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{getMaterialName(form.materialId)}</td>
                  <td className="px-4 py-3 text-gray-600">{getStoreName(form.storeId)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gray-800">
                    {form.quantity} {getMaterialUnit(form.materialId)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{form.borrowerName || form.borrowerId}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {form.expectedReturnDate ? formatDate(form.expectedReturnDate) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                      MATERIAL_BORROW_STATUS_COLORS[form.status]
                    )}>
                      {MATERIAL_BORROW_STATUS_LABELS[form.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(form.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {form.status === 'draft' && form.borrowerId === currentUser?.id && (
                        <button
                          onClick={() => openEditDialog(form)}
                          className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          编辑
                        </button>
                      )}
                      {(form.status === 'draft' || form.status === 'pending') && form.borrowerId === currentUser?.id && (
                        <button
                          onClick={() => handleCancel(form)}
                          className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FileText size={20} className="text-[#1e3a5f]" />
                {editingForm ? '编辑借用单（草稿）' : '新建借用单'}
              </h3>
              <button
                onClick={closeDialog}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {conflictAlert && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-yellow-800">{conflictAlert.type}</div>
                      <div className="text-sm text-yellow-700 mt-1">{conflictAlert.message}</div>
                      <button
                        onClick={() => setConflictAlert(null)}
                        className="text-xs text-yellow-700 underline mt-2"
                      >
                        知道了，继续
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择物资</label>
                <select
                  value={formData.materialId}
                  onChange={e => {
                    setFormData({ ...formData, materialId: e.target.value });
                    handleAutoSave();
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">请选择物资</option>
                  {availableMaterials.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} - 可用 {m.availableStock} {m.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">门店</label>
                  <select
                    value={formData.storeId}
                    onChange={e => {
                      setFormData({ ...formData, storeId: e.target.value });
                      handleAutoSave();
                    }}
                    disabled={accessibleStoreIds.length === 1}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    <option value="">请选择门店</option>
                    {stores.filter(s => accessibleStoreIds.includes(s.id)).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">借用数量</label>
                  <input
                    type="number"
                    min={1}
                    value={formData.quantity}
                    onChange={e => {
                      setFormData({ ...formData, quantity: Number(e.target.value) });
                      handleAutoSave();
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar size={14} className="inline mr-1" />
                  预计归还日期
                </label>
                <input
                  type="date"
                  value={formData.expectedReturnDate}
                  onChange={e => {
                    setFormData({ ...formData, expectedReturnDate: e.target.value });
                    handleAutoSave();
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用途说明</label>
                <textarea
                  value={formData.purpose}
                  onChange={e => {
                    setFormData({ ...formData, purpose: e.target.value });
                    handleAutoSave();
                  }}
                  placeholder="请说明借用用途"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <User size={14} />
                  <span>借用人：</span>
                  <span className="font-medium text-gray-800">
                    {currentUser?.name}（{currentUser?.role === 'inspector' ? '巡检员' : currentUser?.role === 'manager' ? '店长' : '督导'}）
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <div className="text-xs text-gray-400">内容已自动保存为草稿</div>
              <div className="flex items-center gap-3">
                <button
                  onClick={closeDialog}
                  disabled={submitting}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  关闭
                </button>
                <button
                  onClick={() => handleSubmit(true)}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  <Save size={16} />
                  保存草稿
                </button>
                <button
                  onClick={() => handleSubmit(false)}
                  disabled={submitting || !!conflictAlert}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors disabled:opacity-50"
                >
                  <Send size={16} />
                  {submitting ? '提交中...' : '提交申请'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
