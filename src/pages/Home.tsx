import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { DueStatusBadge } from '@/components/StatusBadge';
import { formatDate, DUE_STATUS_LABELS, getRoleName } from '@/utils/helpers';
import {
  ClipboardCheck, AlertTriangle, Clock, CheckCircle, Calendar,
  User, Store, ChevronRight, FileText, AlertCircle, Hourglass
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlanDueStatus } from '@/types';

const GROUP_ORDER: PlanDueStatus[] = ['overdue', 'due_soon', 'delay_requested', 'delay_approved', 'delay_rejected', 'normal'];

export default function Home() {
  const navigate = useNavigate();
  const {
    currentUser, stores, issues, reviewPlans,
    getReviewPlansForCurrentUser, getPlanDelayRecordsForCurrentUser,
  } = useAppStore();

  const myPlans = useMemo(() => getReviewPlansForCurrentUser(), [currentUser, reviewPlans, issues]);

  const myDelayRecords = useMemo(
    () => getPlanDelayRecordsForCurrentUser().filter(r => r.status === 'pending'),
    [currentUser, reviewPlans, issues]
  );

  const groupedPlans = useMemo(() => {
    const groups = new Map<PlanDueStatus, typeof myPlans>();
    myPlans.forEach(p => {
      const arr = groups.get(p.dueStatus) || [];
      arr.push(p);
      groups.set(p.dueStatus, arr);
    });
    return groups;
  }, [myPlans]);

  const pendingDelayPlans = useMemo(() =>
    reviewPlans.filter(p => p.pendingDelayRequest).sort(
      (a, b) => new Date(b.pendingDelayRequest!.requestedAt).getTime() - new Date(a.pendingDelayRequest!.requestedAt).getTime()
    ), [reviewPlans]);

  const totalCount = myPlans.length;
  const overdueCount = (groupedPlans.get('overdue') || []).length;
  const dueSoonCount = (groupedPlans.get('due_soon') || []).length;
  const delayReqCount = (groupedPlans.get('delay_requested') || []).length;

  const stats = [
    { label: '我的复查计划', count: totalCount, color: 'bg-blue-100 text-blue-700', icon: ClipboardCheck },
    { label: '已逾期', count: overdueCount, color: 'bg-red-100 text-red-700', icon: AlertCircle },
    { label: '即将到期', count: dueSoonCount, color: 'bg-yellow-100 text-yellow-700', icon: Clock },
    { label: '待审批延期', count: delayReqCount, color: 'bg-purple-100 text-purple-700', icon: Hourglass },
  ];

  const getStoreName = (storeId?: string) => stores.find(s => s.id === storeId)?.name || storeId || '-';
  const getIssueTitle = (issueId: string) => issues.find(i => i.id === issueId)?.title || issueId.slice(0, 20) + '...';

  if (!currentUser) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">请先选择身份</h3>
          <p className="text-gray-500">登录后可查看与您相关的复查计划待办</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">待办提醒</h2>
            <p className="text-sm text-gray-500">
              {currentUser.name}（{getRoleName(currentUser.role)}）· {getStoreName(currentUser.storeId)}
            </p>
          </div>
          <span className="text-xs text-gray-400">共 {totalCount} 项复查计划</span>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{stat.count}</p>
                  </div>
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.color)}>
                    <Icon size={18} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {currentUser.role !== 'inspector' && myDelayRecords.length > 0 && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-6">
          <h3 className="font-bold text-purple-800 mb-3 flex items-center gap-2">
            <Hourglass className="text-purple-600" size={18} />
            待审批的延期申请（{myDelayRecords.length}）
          </h3>
          <div className="space-y-2">
            {myDelayRecords.slice(0, 5).map(r => {
              const plan = reviewPlans.find(p => p.id === r.planId);
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/issues/${r.issueId}`)}
                  className="w-full text-left bg-white rounded-lg border border-purple-200 p-3 flex items-center justify-between gap-3 hover:bg-purple-50/60 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{getIssueTitle(r.issueId)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.requesterName} 申请：{r.reason.slice(0, 40)}{r.reason.length > 40 ? '…' : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-400">新时间</p>
                    <p className="text-sm font-medium text-purple-700">{formatDate(r.newReviewTime)}</p>
                  </div>
                  <ChevronRight size={18} className="text-purple-400 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {GROUP_ORDER.map(status => {
          const items = groupedPlans.get(status) || [];
          if (items.length === 0) return null;
          const borderColor = status === 'overdue' ? 'border-red-200'
            : status === 'due_soon' ? 'border-yellow-200'
            : status === 'delay_requested' ? 'border-purple-200'
            : status === 'delay_approved' ? 'border-teal-200'
            : status === 'delay_rejected' ? 'border-orange-200'
            : 'border-gray-200';
          const headerBg = status === 'overdue' ? 'bg-red-50'
            : status === 'due_soon' ? 'bg-yellow-50'
            : status === 'delay_requested' ? 'bg-purple-50'
            : status === 'delay_approved' ? 'bg-teal-50'
            : status === 'delay_rejected' ? 'bg-orange-50'
            : 'bg-gray-50';
          return (
            <div key={status} className={cn('bg-white rounded-xl border overflow-hidden', borderColor)}>
              <div className={cn('px-6 py-3 flex items-center justify-between border-b', borderColor, headerBg)}>
                <div className="flex items-center gap-2">
                  <DueStatusBadge status={status} size="md" />
                  <span className="text-sm text-gray-600">{items.length} 项</span>
                </div>
                <span className="text-xs text-gray-400">{DUE_STATUS_LABELS[status]}的复查计划</span>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map(plan => {
                  const issue = issues.find(i => i.id === plan.issueId);
                  return (
                    <button
                      key={plan.id}
                      onClick={() => navigate(`/issues/${plan.issueId}`)}
                      className="w-full text-left px-6 py-4 flex items-start justify-between gap-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="font-medium text-gray-800 truncate">{getIssueTitle(plan.issueId)}</h4>
                          {plan.hasTimeConflict && (
                            <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded flex items-center gap-1">
                              <AlertTriangle size={10} />
                              时间冲突
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 mt-2 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Store size={12} />
                            {getStoreName(issue?.storeId)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            复查：{formatDate(plan.reviewTime)}
                          </span>
                          <span className="flex items-center gap-1">
                            <User size={12} />
                            责任人：{plan.assigneeName || plan.assigneeId}
                          </span>
                        </div>
                        {plan.pendingDelayRequest && (
                          <p className="text-xs text-purple-600 mt-2 bg-purple-50 px-2 py-1 rounded inline-block">
                            ⏳ {plan.pendingDelayRequest.requesterName} 申请延期至 {formatDate(plan.pendingDelayRequest.newReviewTime)}：{plan.pendingDelayRequest.reason.slice(0, 30)}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        <DueStatusBadge status={status} />
                        {plan.delayCount > 0 && (
                          <span className="text-xs text-gray-400">已延期 {plan.delayCount} 次</span>
                        )}
                        <ChevronRight size={16} className="text-gray-300 mt-1" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {totalCount === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
            <CheckCircle size={48} className="mx-auto text-green-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">暂无复查计划待办</h3>
            <p className="text-gray-500">与您相关的所有复查计划状态正常</p>
          </div>
        )}
      </div>
    </div>
  );
}
