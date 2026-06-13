import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FileText, PlusCircle, RefreshCw, History, Settings, Download,
  Wifi, WifiOff, User, LogOut, Bell, Package, ClipboardList
} from 'lucide-react';
import { useAppStore } from '@/store';
import { hasPermission, ROLE_LABELS } from '@/utils/permissions';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/issues', label: '问题列表', icon: FileText, permission: 'issue:view_own' },
  { path: '/issues/new', label: '新建问题', icon: PlusCircle, permission: 'issue:create' },
  { path: '/sync', label: '同步队列', icon: RefreshCw, permission: 'sync:view' },
  { path: '/history', label: '操作历史', icon: History, permission: 'history:view' },
  { path: '/config', label: '配置导入', icon: Settings, permission: 'config:import' },
  { path: '/handover-precheck', label: '交接包导入', icon: Package, permission: 'handover:precheck_view_all' },
  { path: '/materials', label: '物资台账', icon: ClipboardList, permission: 'material:view' },
  { path: '/export', label: '数据导出', icon: Download, permission: 'export:data' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, isOnline, toggleOnline, syncQueue, setCurrentUser } = useAppStore();

  const pendingSyncCount = syncQueue.filter(i => i.status === 'pending' || i.status === 'failed').length;

  const visibleNavItems = navItems.filter(item =>
    currentUser && hasPermission(currentUser.role, item.permission)
  );

  const handleLogout = () => {
    setCurrentUser(null);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-[#1e3a5f] text-white flex flex-col">
        <div className="p-4 border-b border-blue-800">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <LayoutDashboard size={24} />
            巡店助手
          </h1>
          {currentUser && (
            <div className="mt-3 text-sm text-blue-200 flex items-center gap-2">
              <User size={16} />
              <span>{currentUser.name}</span>
              <span className="px-2 py-0.5 bg-blue-700 rounded text-xs">
                {ROLE_LABELS[currentUser.role]}
              </span>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-blue-100 hover:bg-blue-800 hover:text-white'
                )}
              >
                <Icon size={20} />
                <span>{item.label}</span>
                {item.path === '/sync' && pendingSyncCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                    {pendingSyncCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-blue-800 space-y-3">
          <button
            onClick={toggleOnline}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2 rounded transition-colors',
              isOnline
                ? 'bg-green-700 hover:bg-green-600'
                : 'bg-red-700 hover:bg-red-600'
            )}
          >
            {isOnline ? <Wifi size={18} /> : <WifiOff size={18} />}
            <span className="text-sm">{isOnline ? '在线' : '离线'}</span>
            <span className={cn(
              'ml-auto w-2 h-2 rounded-full animate-pulse',
              isOnline ? 'bg-green-300' : 'bg-red-300'
            )} />
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 rounded bg-blue-800 hover:bg-blue-700 transition-colors text-sm"
          >
            <LogOut size={18} />
            <span>切换身份</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {visibleNavItems.find(i => i.path === location.pathname)?.label || '巡店助手'}
            </h2>
            <p className="text-sm text-gray-500">
              {isOnline ? '数据实时同步' : '数据将保存在本地，联网后自动同步'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {pendingSyncCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg">
                <Bell size={16} />
                <span className="text-sm">{pendingSyncCount} 项待同步</span>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
