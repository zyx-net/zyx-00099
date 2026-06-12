import { Issue, Store, Template } from '@/types';
import { IssueStatusBadge, PriorityBadge } from './StatusBadge';
import { formatDate } from '@/utils/helpers';
import { Store as StoreIcon, Calendar, Image as ImageIcon, CloudOff, Cloud } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface IssueCardProps {
  issue: Issue;
  store?: Store;
  template?: Template;
}

export default function IssueCard({ issue, store, template }: IssueCardProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/issues/${issue.id}`)}
      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer group"
    >
      <div className="flex items-start gap-4">
        <div className="w-1 h-full min-h-[60px] rounded bg-blue-500 group-hover:bg-blue-600 transition-colors flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                {issue.title}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                编号: {issue.id.slice(0, 20)}...
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <IssueStatusBadge status={issue.status} size="sm" />
              {issue.priority && <PriorityBadge priority={issue.priority} />}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
            {store && (
              <span className="flex items-center gap-1.5">
                <StoreIcon size={14} />
                {store.name}
              </span>
            )}
            {template && (
              <span className="text-gray-500">
                模板: {template.name}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar size={14} />
              {formatDate(issue.createdAt)}
            </span>
            {issue.images && issue.images.length > 0 && (
              <span className="flex items-center gap-1.5 text-gray-500">
                <ImageIcon size={14} />
                {issue.images.length}张图片
              </span>
            )}
            <span className="flex items-center gap-1.5">
              {issue.synced ? (
                <Cloud size={14} className="text-green-500" />
              ) : (
                <CloudOff size={14} className="text-orange-500" />
              )}
              {issue.synced ? '已同步' : '未同步'}
            </span>
          </div>

          {issue.data.description && (
            <p className="mt-3 text-sm text-gray-600 line-clamp-2">
              {issue.data.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
