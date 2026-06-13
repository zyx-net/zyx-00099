import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { Package, Building2, User, FileText } from 'lucide-react';
import { canViewStoreOccupancy } from '@/utils/permissions';

export default function StoreOccupancy() {
  const { currentUser, materials, getMaterialOccupancyByStore, getMaterialBorrowFormsForStore, stores } = useAppStore();

  const storeId = currentUser?.storeId || stores[0]?.id || '';

  const canView = canViewStoreOccupancy(currentUser, storeId);

  const occupancyData = useMemo(() => {
    if (!canView || !storeId) return [];
    return getMaterialOccupancyByStore(storeId);
  }, [canView, storeId, getMaterialOccupancyByStore]);

  const borrowForms = useMemo(() => {
    if (!canView || !storeId) return [];
    return getMaterialBorrowFormsForStore(storeId).filter(
      f => f.status === 'borrowed' || f.status === 'pending'
    );
  }, [canView, storeId, getMaterialBorrowFormsForStore]);

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || '-';
  const getMaterialCode = (id: string) => materials.find(m => m.id === id)?.code || '-';
  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || id;

  if (!currentUser) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">请先选择身份</h3>
        <p className="text-sm text-gray-400">登录后可查看门店物资占用情况</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">无权限访问</h3>
        <p className="text-sm text-gray-400">您无权查看门店物资占用情况</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#2d4a6f] rounded-xl p-6 text-white">
        <div className="flex items-center gap-3">
          <Building2 size={28} />
          <div>
            <h2 className="text-xl font-bold">{getStoreName(storeId)}</h2>
            <p className="text-white/80 text-sm">当前门店物资占用情况</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <Package size={24} className="text-orange-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{occupancyData.length}</div>
              <div className="text-sm text-gray-500">占用物资种类</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText size={24} className="text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{borrowForms.length}</div>
              <div className="text-sm text-gray-500">未归还借用单</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <User size={24} className="text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {new Set(borrowForms.map(f => f.borrowerId)).size}
              </div>
              <div className="text-sm text-gray-500">借用人数量</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <Package size={18} className="text-[#1e3a5f]" />
            物资占用明细
          </h3>
        </div>
        {occupancyData.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={40} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">暂无占用记录</h3>
            <p className="text-sm text-gray-400">当前门店没有被占用的物资</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">物资编号</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">物资名称</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">占用数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {occupancyData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.materialCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{item.materialName}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-orange-600">
                      {item.borrowedQuantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={18} className="text-[#1e3a5f]" />
            未归还借用单
          </h3>
        </div>
        {borrowForms.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={40} className="mx-auto text-gray-300 mb-3" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">暂无未归还借用单</h3>
            <p className="text-sm text-gray-400">所有借用单均已归还</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {borrowForms.map(form => (
              <div key={form.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs text-gray-500">{form.formNumber}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                        {form.status === 'pending' ? '待领取' : '已借出'}
                      </span>
                    </div>
                    <div className="font-medium text-gray-800 mb-1">
                      {getMaterialName(form.materialId)} × {form.quantity}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <User size={12} />
                        {form.borrowerName || form.borrowerId}
                      </span>
                      <span>借出时间：{new Date(form.createdAt).toLocaleString('zh-CN')}</span>
                    </div>
                    {form.purpose && (
                      <div className="mt-2 text-sm text-gray-600 bg-gray-50 rounded px-3 py-1.5">
                        用途：{form.purpose}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
