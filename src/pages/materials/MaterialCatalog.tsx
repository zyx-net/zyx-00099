import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  Plus, Edit2, Trash2, Search, X, Check,
  ToggleLeft, ToggleRight, AlertCircle
} from 'lucide-react';
import { Material, MaterialStatus } from '@/types';
import {
  MATERIAL_STATUS_LABELS, MATERIAL_STATUS_COLORS,
  MATERIAL_CATEGORIES, generateMaterialCode
} from '@/utils/helpers';
import { canManageMaterial } from '@/utils/permissions';

interface FormData {
  code: string;
  name: string;
  category: string;
  unit: string;
  spec: string;
  description: string;
  minStock: number;
}

const emptyForm: FormData = {
  code: '',
  name: '',
  category: MATERIAL_CATEGORIES[0],
  unit: '',
  spec: '',
  description: '',
  minStock: 0,
};

export default function MaterialCatalog() {
  const {
    materials, currentUser, addToast,
    createMaterial, updateMaterial, deleteMaterial
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Material | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canEdit = canManageMaterial(currentUser);

  const filteredMaterials = useMemo(() => {
    return materials.filter(m => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return m.name.toLowerCase().includes(q)
          || m.code.toLowerCase().includes(q)
          || m.category.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [materials, searchQuery, categoryFilter]);

  const openCreateDialog = () => {
    setEditingMaterial(null);
    setFormData({ ...emptyForm, code: generateMaterialCode() });
    setShowDialog(true);
  };

  const openEditDialog = (material: Material) => {
    setEditingMaterial(material);
    setFormData({
      code: material.code,
      name: material.name,
      category: material.category,
      unit: material.unit,
      spec: material.spec || '',
      description: material.description || '',
      minStock: material.minStock || 0,
    });
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingMaterial(null);
    setFormData(emptyForm);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      addToast('error', '请输入物资名称');
      return;
    }
    if (!formData.unit.trim()) {
      addToast('error', '请输入计量单位');
      return;
    }
    if (!formData.category) {
      addToast('error', '请选择物资类别');
      return;
    }

    setSubmitting(true);
    try {
      if (editingMaterial) {
        await updateMaterial(editingMaterial.id, {
          name: formData.name.trim(),
          category: formData.category,
          unit: formData.unit.trim(),
          spec: formData.spec.trim(),
          description: formData.description.trim(),
          minStock: Number(formData.minStock) || 0,
        });
        addToast('success', '物资信息已更新');
      } else {
        await createMaterial({
          code: formData.code,
          name: formData.name.trim(),
          category: formData.category,
          unit: formData.unit.trim(),
          spec: formData.spec.trim(),
          description: formData.description.trim(),
          minStock: Number(formData.minStock) || 0,
        });
        addToast('success', '物资创建成功');
      }
      closeDialog();
    } catch (e) {
      addToast('error', (e as Error).message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (material: Material) => {
    try {
      await deleteMaterial(material.id);
      addToast('success', '物资已删除');
      setShowDeleteConfirm(null);
    } catch (e) {
      addToast('error', (e as Error).message || '删除失败');
    }
  };

  const handleToggleStatus = async (material: Material) => {
    const newStatus: MaterialStatus = material.status === 'active' ? 'inactive' : 'active';
    try {
      await updateMaterial(material.id, { status: newStatus });
      addToast('success', `物资已${newStatus === 'active' ? '启用' : '停用'}`);
    } catch (e) {
      addToast('error', (e as Error).message || '状态切换失败');
    }
  };

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
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="all">全部类别</option>
            {MATERIAL_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        {canEdit && (
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
          >
            <Plus size={18} />
            新增物资
          </button>
        )}
      </div>

      {filteredMaterials.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-12 text-center">
          <Search size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">暂无物资数据</h3>
          <p className="text-sm text-gray-400">点击右上角按钮新增物资</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">编号</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">名称</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">类别</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">规格</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">单位</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">状态</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">总库存</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">可用库存</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">最低库存</th>
                {canEdit && (
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">操作</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMaterials.map(m => {
                const isLowStock = m.availableStock <= (m.minStock || 0);
                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.code}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{m.name}</td>
                    <td className="px-4 py-3 text-gray-600">{m.category}</td>
                    <td className="px-4 py-3 text-gray-500">{m.spec || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{m.unit}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        MATERIAL_STATUS_COLORS[m.status]
                      )}>
                        {MATERIAL_STATUS_LABELS[m.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{m.totalStock}</td>
                    <td className={cn(
                      'px-4 py-3 text-right font-mono font-semibold',
                      isLowStock ? 'text-red-600' : 'text-gray-800'
                    )}>
                      {m.availableStock}
                      {isLowStock && (
                        <span className="ml-1 text-xs text-red-500">⚠</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">{m.minStock || 0}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleToggleStatus(m)}
                            title={m.status === 'active' ? '停用' : '启用'}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            disabled={m.status === 'discontinued'}
                          >
                            {m.status === 'active'
                              ? <ToggleRight size={18} className="text-green-600" />
                              : <ToggleLeft size={18} className={m.status === 'discontinued' ? 'text-gray-300' : 'text-gray-400'} />
                            }
                          </button>
                          <button
                            onClick={() => openEditDialog(m)}
                            title="编辑"
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(m)}
                            title="删除"
                            disabled={m.totalStock > 0}
                            className={cn(
                              'p-1.5 rounded transition-colors',
                              m.totalStock > 0
                                ? 'text-gray-300 cursor-not-allowed'
                                : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                            )}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">
                {editingMaterial ? '编辑物资' : '新增物资'}
              </h3>
              <button
                onClick={closeDialog}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">物资编号</label>
                <input
                  type="text"
                  value={formData.code}
                  disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="请输入物资名称"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    类别 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {MATERIAL_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    计量单位 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.unit}
                    onChange={e => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="如：个、台、套"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">规格型号</label>
                  <input
                    type="text"
                    value={formData.spec}
                    onChange={e => setFormData({ ...formData, spec: e.target.value })}
                    placeholder="可选"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">最低库存预警</label>
                <input
                  type="number"
                  min={0}
                  value={formData.minStock}
                  onChange={e => setFormData({ ...formData, minStock: Number(e.target.value) })}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述备注</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="可选"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button
                onClick={closeDialog}
                disabled={submitting}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors disabled:opacity-50"
              >
                <Check size={18} />
                {submitting ? '提交中...' : (editingMaterial ? '保存修改' : '创建物资')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="text-red-600" size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-1">确认删除物资？</h3>
                  <p className="text-sm text-gray-500">
                    您确定要删除「{showDeleteConfirm.name}」吗？
                    {showDeleteConfirm.totalStock > 0 && (
                      <span className="block mt-2 text-red-600 font-medium">
                        ⚠ 该物资当前有库存，无法删除。请先清空库存。
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                disabled={showDeleteConfirm.totalStock > 0}
                className={cn(
                  'px-4 py-2 rounded-lg text-white transition-colors',
                  showDeleteConfirm.totalStock > 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700'
                )}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
