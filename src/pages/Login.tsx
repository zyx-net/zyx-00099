import { useNavigate } from 'react-router-dom';
import { UserRole, User } from '@/types';
import { useAppStore } from '@/store';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/utils/permissions';
import { Shield, Store, ClipboardCheck, Check, LayoutDashboard } from 'lucide-react';
import { generateId } from '@/utils/helpers';
import { cn } from '@/lib/utils';

const roles: { role: UserRole; icon: typeof Shield; color: string; hoverColor: string }[] = [
  { role: 'inspector', icon: ClipboardCheck, color: 'border-blue-500', hoverColor: 'hover:bg-blue-50' },
  { role: 'manager', icon: Store, color: 'border-green-500', hoverColor: 'hover:bg-green-50' },
  { role: 'supervisor', icon: Shield, color: 'border-purple-500', hoverColor: 'hover:bg-purple-50' },
];

export default function Login() {
  const navigate = useNavigate();
  const { setCurrentUser, stores, templates } = useAppStore();

  const handleSelectRole = (role: UserRole) => {
    const user: User = {
      id: generateId(),
      role,
      name: ROLE_LABELS[role]
    };
    setCurrentUser(user);
    navigate('/issues');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] via-[#2d4a6f] to-[#1e3a5f] flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-6">
            <LayoutDashboard className="text-white" size={32} />
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">巡店问题采集系统</h1>
          <p className="text-blue-200 text-lg">本地优先 · 离线可用 · 数据可靠</p>
          {stores.length > 0 && templates.length > 0 && (
            <p className="text-blue-300 text-sm mt-3">
              已配置 {stores.length} 个门店，{templates.length} 个检查模板
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {roles.map(({ role, icon: Icon, color, hoverColor }) => (
            <button
              key={role}
              onClick={() => handleSelectRole(role)}
              className={cn(
                'group relative bg-white rounded-xl p-8 border-2 transition-all duration-300',
                'hover:shadow-xl hover:-translate-y-1',
                color,
                hoverColor
              )}
            >
              <div className="flex flex-col items-center text-center">
                <div className={cn(
                  'w-16 h-16 rounded-xl flex items-center justify-center mb-5 transition-colors',
                  role === 'inspector' && 'bg-blue-100 text-blue-600 group-hover:bg-blue-200',
                  role === 'manager' && 'bg-green-100 text-green-600 group-hover:bg-green-200',
                  role === 'supervisor' && 'bg-purple-100 text-purple-600 group-hover:bg-purple-200'
                )}>
                  <Icon size={32} />
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">
                  {ROLE_LABELS[role]}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed mb-5">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
                <div className="flex items-center gap-2 text-sm font-medium text-gray-400 group-hover:text-gray-600">
                  进入系统
                  <Check size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-12 text-center text-blue-300 text-sm">
          <p>支持 PWA 安装，可离线使用 · 数据自动同步 · 冲突保留双方版本</p>
        </div>
      </div>
    </div>
  );
}
