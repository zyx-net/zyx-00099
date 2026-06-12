import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { IssueStatus } from '@/types';
import { hasPermission } from '@/utils/permissions';
import IssueCard from '@/components/IssueCard';
import { IssueStatusBadge } from '@/components/StatusBadge';
import { Search, Filter, Plus } from 'lucide-react';
import { STATUS_LABELS } from '@/utils/helpers';
import { cn } from '@/lib/utils';

const statusFilters: (IssueStatus | 'all')[] = ['all', 'draft', 'submitted', 'rejected', 'closed'];

export default function IssueList() {
  const navigate = useNavigate();
  const { issues, stores, templates, currentUser } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const canCreate = currentUser && hasPermission(currentUser.role, 'issue:create');
  const canViewAll = currentUser && hasPermission(currentUser.role, 'issue:view_all');

  const filteredIssues = useMemo(() => {
    return issues.filter(issue => {
      if (!canViewAll && issue.creatorId !== currentUser?.id) return false;
      if (currentUser?.role === 'manager' && currentUser.storeId && issue.storeId !== currentUser.storeId) return false;
      if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
      if (storeFilter !== 'all' && issue.storeId !== storeFilter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return issue.title.toLowerCase().includes(query) ||
          issue.id.toLowerCase().includes(query);
      }
      return true;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [issues, statusFilter, storeFilter, searchQuery, canViewAll, currentUser?.id, currentUser?.role, currentUser?.storeId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-gray-500" />
          <div className="flex flex-wrap gap-2">
            {statusFilters.map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  statusFilter === status
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                )}
              >
                {status === 'all' ? '全部' : STATUS_LABELS[status as IssueStatus]}
                <span className="ml-1.5 text-xs opacity-70">
                  ({status === 'all'
                    ? filteredIssues.length
                    : issues.filter(i => i.status === status).length
                  })
                </span>
              </button>
            ))}
          </div>
        </div>

        {canCreate && (
          <button
            onClick={() => navigate('/issues/new')}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
          >
            <Plus size={18} />
            新建问题
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="搜索问题标题或编号..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <select
          value={storeFilter}
          onChange={e => setStoreFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
        >
          <option value="all">全部门店</option>
          {stores.map(store => (
            <option key={store.id} value={store.id}>{store.name}</option>
          ))}
        </select>
      </div>

      {stores.length === 0 || templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-gray-400 mb-4">
            <Filter size={48} className="mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">暂无配置数据</h3>
            <p className="text-gray-500 mb-4">
              {stores.length === 0 && '请先导入门店清单。'}
              {templates.length === 0 && '请先导入检查模板。'}
            </p>
            {currentUser?.role === 'supervisor' && (
              <button
                onClick={() => navigate('/config')}
                className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
              >
                前往导入配置
              </button>
            )}
          </div>
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-gray-400">
            <Search size={48} className="mx-auto mb-3" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">暂无问题记录</h3>
            <p className="text-gray-500">调整筛选条件或创建新的问题</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredIssues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              store={stores.find(s => s.id === issue.storeId)}
              template={templates.find(t => t.id === issue.templateId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
