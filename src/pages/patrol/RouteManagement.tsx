import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  Plus, Edit2, Trash2, Search, X, Check,
  ToggleLeft, ToggleRight, AlertCircle, MapPin,
  Clock, GripVertical, ChevronDown, ChevronUp
} from 'lucide-react';
import { PatrolRoute, PatrolRouteStatus, PatrolCheckpointStatus } from '@/types';
import {
  PATROL_ROUTE_STATUS_LABELS, PATROL_ROUTE_STATUS_COLORS,
  PATROL_CHECKPOINT_STATUS_LABELS, formatDate
} from '@/utils/helpers';
import { canManagePatrolRoute } from '@/utils/permissions';

interface CheckpointFormData {
  name: string;
  storeId: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  order: number;
  status: PatrolCheckpointStatus;
}

interface FormData {
  name: string;
  checkpoints: CheckpointFormData[];
}

const emptyCheckpoint: CheckpointFormData = {
  name: '',
  storeId: '',
  timeWindowStart: '09:00',
  timeWindowEnd: '18:00',
  order: 0,
  status: 'active',
};

const emptyForm: FormData = {
  name: '',
  checkpoints: [],
};

export default function RouteManagement() {
  const {
    patrolRoutes, stores, currentUser, addToast,
    createPatrolRoute, updatePatrolRoute, deletePatrolRoute
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editingRoute, setEditingRoute] = useState<PatrolRoute | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<PatrolRoute | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedCheckpoints, setExpandedCheckpoints] = useState<Set<string>>(new Set());

  const canEdit = canManagePatrolRoute(currentUser);

  const filteredRoutes = useMemo(() => {
    return patrolRoutes.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return r.name.toLowerCase().includes(q)
          || r.creatorName?.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [patrolRoutes, searchQuery, statusFilter]);

  const openCreateDialog = () => {
    setEditingRoute(null);
    setFormData({ ...emptyForm, checkpoints: [{ ...emptyCheckpoint, order: 0 }] });
    setShowDialog(true);
  };

  const openEditDialog = (route: PatrolRoute) => {
    setEditingRoute(route);
    setFormData({
      name: route.name,
      checkpoints: route.checkpoints.map(cp => ({
        name: cp.name,
        storeId: cp.storeId,
        timeWindowStart: cp.timeWindowStart,
        timeWindowEnd: cp.timeWindowEnd,
        order: cp.order,
        status: cp.status,
      })),
    });
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingRoute(null);
    setFormData(emptyForm);
    setExpandedCheckpoints(new Set());
  };

  const addCheckpoint = () => {
    const newOrder = formData.checkpoints.length;
    setFormData({
      ...formData,
      checkpoints: [...formData.checkpoints, { ...emptyCheckpoint, order: newOrder }],
    });
  };

  const removeCheckpoint = (index: number) => {
    const newCheckpoints = formData.checkpoints
      .filter((_, i) => i !== index)
      .map((cp, i) => ({ ...cp, order: i }));
    setFormData({ ...formData, checkpoints: newCheckpoints });
  };

  const updateCheckpoint = <K extends keyof CheckpointFormData>(index: number, field: K, value: CheckpointFormData[K]) => {
    const newCheckpoints = [...formData.checkpoints];
    newCheckpoints[index] = { ...newCheckpoints[index], [field]: value };
    setFormData({ ...formData, checkpoints: newCheckpoints });
  };

  const moveCheckpoint = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === formData.checkpoints.length - 1) return;
    
    const newCheckpoints = [...formData.checkpoints];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newCheckpoints[index], newCheckpoints[targetIndex]] = [newCheckpoints[targetIndex], newCheckpoints[index]];
    
    newCheckpoints.forEach((cp, i) => {
      cp.order = i;
    });
    
    setFormData({ ...formData, checkpoints: newCheckpoints });
  };

  const toggleCheckpointExpand = (index: string) => {
    const newExpanded = new Set(expandedCheckpoints);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedCheckpoints(newExpanded);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      addToast('error', '请输入路线名称');
      return;
    }
    if (formData.checkpoints.length === 0) {
      addToast('error', '请至少添加一个检查点');
      return;
    }
    
    for (let i = 0; i < formData.checkpoints.length; i++) {
      const cp = formData.checkpoints[i];
      if (!cp.name.trim()) {
        addToast('error', `第 ${i + 1} 个检查点请输入名称`);
        return;
      }
      if (!cp.storeId) {
        addToast('error', `第 ${i + 1} 个检查点请选择门店`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (editingRoute) {
        await updatePatrolRoute(editingRoute.id, {
          name: formData.name.trim(),
          checkpoints: formData.checkpoints.map((cp, idx) => ({
            ...cp,
            id: editingRoute.checkpoints[idx]?.id || '',
            routeId: editingRoute.id,
            createdAt: editingRoute.checkpoints[idx]?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })),
        });
        addToast('success', '巡检路线已更新');
      } else {
        await createPatrolRoute({
          name: formData.name.trim(),
          checkpoints: formData.checkpoints.map(cp => ({
            name: cp.name.trim(),
            storeId: cp.storeId,
            timeWindowStart: cp.timeWindowStart,
            timeWindowEnd: cp.timeWindowEnd,
            order: cp.order,
            status: cp.status,
          })),
        });
        addToast('success', '巡检路线创建成功');
      }
      closeDialog();
    } catch (e) {
      addToast('error', (e as Error).message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (route: PatrolRoute) => {
    try {
      await deletePatrolRoute(route.id);
      addToast('success', '巡检路线已删除');
      setShowDeleteConfirm(null);
    } catch (e) {
      addToast('error', (e as Error).message || '删除失败');
    }
  };

  const handleToggleStatus = async (route: PatrolRoute) => {
    const newStatus: PatrolRouteStatus = route.status === 'active' ? 'inactive' : 'active';
    try {
      await updatePatrolRoute(route.id, { status: newStatus });
      addToast('success', `巡检路线已${newStatus === 'active' ? '启用' : '停用'}`);
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
              placeholder="搜索路线名称/创建人..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="all">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </div>
        {canEdit && (
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
          >
            <Plus size={18} />
            新增路线
          </button>
        )}
      </div>

      {filteredRoutes.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-12 text-center">
          <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">暂无巡检路线</h3>
          <p className="text-sm text-gray-400">点击右上角按钮新增巡检路线</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">路线名称</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">版本</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">状态</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">检查点数量</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">创建人</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">创建时间</th>
                {canEdit && (
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">操作</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRoutes.map(route => (
                <tr key={route.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{route.name}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono">v{route.version}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                      PATROL_ROUTE_STATUS_COLORS[route.status]
                    )}>
                      {PATROL_ROUTE_STATUS_LABELS[route.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{route.checkpoints.length} 个</td>
                  <td className="px-4 py-3 text-gray-600">{route.creatorName || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(route.createdAt)}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleToggleStatus(route)}
                          title={route.status === 'active' ? '停用' : '启用'}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          {route.status === 'active'
                            ? <ToggleRight size={18} className="text-green-600" />
                            : <ToggleLeft size={18} className="text-gray-400" />
                          }
                        </button>
                        <button
                          onClick={() => openEditDialog(route)}
                          title="编辑"
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(route)}
                          title="删除"
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="text-lg font-bold text-gray-800">
                {editingRoute ? '编辑巡检路线' : '新增巡检路线'}
              </h3>
              <button
                onClick={closeDialog}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    路线名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="请输入路线名称"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      检查点 <span className="text-red-500">*</span>
                    </label>
                    {canEdit && (
                      <button
                        onClick={addCheckpoint}
                        className="flex items-center gap-1 text-sm text-[#1e3a5f] hover:text-[#2d4a6f] transition-colors"
                      >
                        <Plus size={14} />
                        添加检查点
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {formData.checkpoints.map((cp, index) => (
                      <div
                        key={index}
                        className="border border-gray-200 rounded-lg overflow-hidden"
                      >
                        <div
                          className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => toggleCheckpointExpand(String(index))}
                        >
                          <div className="flex items-center gap-3">
                            <GripVertical size={16} className="text-gray-400" />
                            <span className="font-medium text-gray-800">
                              检查点 {index + 1}: {cp.name || '未命名'}
                            </span>
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded',
                              cp.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            )}>
                              {PATROL_CHECKPOINT_STATUS_LABELS[cp.status]}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {formData.checkpoints.length > 1 && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); moveCheckpoint(index, 'up'); }}
                                  disabled={index === 0}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                                >
                                  <ChevronUp size={16} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); moveCheckpoint(index, 'down'); }}
                                  disabled={index === formData.checkpoints.length - 1}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                                >
                                  <ChevronDown size={16} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeCheckpoint(index); }}
                                  className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                            {expandedCheckpoints.has(String(index))
                              ? <ChevronUp size={16} className="text-gray-400" />
                              : <ChevronDown size={16} className="text-gray-400" />
                            }
                          </div>
                        </div>
                        {expandedCheckpoints.has(String(index)) && (
                          <div className="p-4 space-y-4 border-t border-gray-100">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  检查点名称 <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  value={cp.name}
                                  onChange={e => updateCheckpoint(index, 'name', e.target.value)}
                                  placeholder="请输入检查点名称"
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  门店 <span className="text-red-500">*</span>
                                </label>
                                <select
                                  value={cp.storeId}
                                  onChange={e => updateCheckpoint(index, 'storeId', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                  <option value="">请选择门店</option>
                                  {stores.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  <Clock size={14} className="inline mr-1" />
                                  时间窗开始
                                </label>
                                <input
                                  type="time"
                                  value={cp.timeWindowStart}
                                  onChange={e => updateCheckpoint(index, 'timeWindowStart', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  <Clock size={14} className="inline mr-1" />
                                  时间窗结束
                                </label>
                                <input
                                  type="time"
                                  value={cp.timeWindowEnd}
                                  onChange={e => updateCheckpoint(index, 'timeWindowEnd', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">顺序</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={cp.order}
                                  onChange={e => updateCheckpoint(index, 'order', Number(e.target.value))}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                                <select
                                  value={cp.status}
                                  onChange={e => updateCheckpoint(index, 'status', e.target.value as PatrolCheckpointStatus)}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                  <option value="active">启用</option>
                                  <option value="inactive">停用</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex-shrink-0">
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
                {submitting ? '提交中...' : (editingRoute ? '保存修改' : '创建路线')}
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
                  <h3 className="text-lg font-bold text-gray-800 mb-1">确认删除巡检路线？</h3>
                  <p className="text-sm text-gray-500">
                    您确定要删除「{showDeleteConfirm.name}」吗？此操作不可恢复。
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
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
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
