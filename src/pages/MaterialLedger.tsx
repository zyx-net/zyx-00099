import { useState } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  Package, Warehouse, ClipboardList, RotateCcw,
  AlertTriangle, History, Building2, Download, Upload,
  Clock, Database
} from 'lucide-react';
import {
  canManageMaterial, canManageStock, canReportLoss,
  canViewStoreOccupancy, canExportMaterial, canBorrowMaterial,
  canReturnMaterial
} from '@/utils/permissions';
import MaterialCatalog from './materials/MaterialCatalog';
import StockManagement from './materials/StockManagement';
import BorrowForm from './materials/BorrowForm';
import ReturnForm from './materials/ReturnForm';
import LossReport from './materials/LossReport';
import MaterialHistory from './materials/MaterialHistory';
import MaterialSyncQueue from './materials/MaterialSyncQueue';
import MaterialBackup from './materials/MaterialBackup';
import StoreOccupancy from './materials/StoreOccupancy';

type TabKey = 'catalog' | 'stock' | 'borrow' | 'return' | 'loss' | 'history' | 'sync' | 'backup' | 'myBorrow' | 'occupancy';

interface TabItem {
  key: TabKey;
  label: string;
  icon: typeof Package;
  visible: boolean;
}

export default function MaterialLedger() {
  const { currentUser } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabKey>('borrow');

  const isSupervisor = currentUser?.role === 'supervisor';
  const isInspector = currentUser?.role === 'inspector';
  const isManager = currentUser?.role === 'manager';

  const allTabs: TabItem[] = (() => {
    if (isSupervisor) {
      return [
        { key: 'catalog', label: '物资目录管理', icon: Package, visible: canManageMaterial(currentUser) },
        { key: 'stock', label: '库存管理', icon: Warehouse, visible: canManageStock(currentUser) },
        { key: 'borrow', label: '借用登记', icon: ClipboardList, visible: true },
        { key: 'return', label: '归还登记', icon: RotateCcw, visible: true },
        { key: 'loss', label: '报损登记', icon: AlertTriangle, visible: canReportLoss(currentUser) },
        { key: 'history', label: '历史记录', icon: History, visible: true },
        { key: 'sync', label: '同步队列', icon: Clock, visible: true },
        { key: 'backup', label: '备份导入导出', icon: Database, visible: canExportMaterial(currentUser) },
      ];
    }

    if (isInspector) {
      return [
        { key: 'myBorrow', label: '我的借用', icon: Package, visible: true },
        { key: 'return', label: '归还登记', icon: RotateCcw, visible: canReturnMaterial(currentUser) },
        { key: 'history', label: '历史记录', icon: History, visible: true },
      ];
    }

    if (isManager) {
      return [
        { key: 'occupancy', label: '本店占用情况', icon: Building2, visible: canViewStoreOccupancy(currentUser) },
        { key: 'history', label: '借用记录', icon: History, visible: true },
      ];
    }

    return [];
  })();

  const visibleTabs = allTabs.filter(t => t.visible);

  const handleTabClick = (key: TabKey) => {
    setActiveTab(key);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'catalog':
        return <MaterialCatalog />;
      case 'stock':
        return <StockManagement />;
      case 'borrow':
      case 'myBorrow':
        return <BorrowForm />;
      case 'return':
        return <ReturnForm />;
      case 'loss':
        return <LossReport />;
      case 'history':
        return <MaterialHistory />;
      case 'sync':
        return <MaterialSyncQueue />;
      case 'backup':
        return <MaterialBackup />;
      case 'occupancy':
        return <StoreOccupancy />;
      default:
        return null;
    }
  };

  if (!currentUser) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-700 mb-2">请先选择身份</h3>
        <p className="text-gray-500">登录后可使用物资管理功能</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="text-[#1e3a5f]" size={28} />
            物资借用台账
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {currentUser.name} · 管理巡检物资的借用、归还和库存
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-200">
          {visibleTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => handleTabClick(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                  isActive
                    ? 'text-[#1e3a5f] border-[#1e3a5f] bg-[#1e3a5f]/5'
                    : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
