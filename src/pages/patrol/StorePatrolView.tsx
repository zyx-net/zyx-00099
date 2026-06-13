import { useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import { MapPin, User, Clock, AlertTriangle, Calendar, Building2, CheckCircle, XCircle } from 'lucide-react';
import { canViewPatrolCheckIn } from '@/utils/permissions';
import { CHECKIN_STATUS_LABELS, CHECKIN_STATUS_COLORS, EXCEPTION_TYPE_LABELS, formatDate } from '@/utils/helpers';
import type { CheckIn, PatrolRoute, PatrolCheckpoint } from '@/types';

interface RouteCheckInGroup {
  routeId: string;
  routeName: string;
  routeVersion: number;
  checkpoints: PatrolCheckpoint[];
  checkIns: CheckIn[];
  completedCount: number;
  totalCount: number;
  completionRate: number;
}

export default function StorePatrolView() {
  const { currentUser, patrolRoutes, checkIns, getCheckInsForStore, stores } = useAppStore();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const storeId = currentUser?.storeId || stores[0]?.id || '';

  const canView = canViewPatrolCheckIn(currentUser);

  const storeCheckIns = useMemo(() => {
    if (!canView || !storeId) return [];
    return getCheckInsForStore(storeId);
  }, [canView, storeId, getCheckInsForStore]);

  const filteredCheckIns = useMemo(() => {
    let filtered = storeCheckIns;
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter(c => new Date(c.checkInTime) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(c => new Date(c.checkInTime) <= end);
    }
    return filtered;
  }, [storeCheckIns, startDate, endDate]);

  const routeGroups = useMemo((): RouteCheckInGroup[] => {
    if (!canView || filteredCheckIns.length === 0) return [];

    const storeRoutes = patrolRoutes.filter(route =>
      route.checkpoints.some(cp => cp.storeId === storeId)
    );

    return storeRoutes.map(route => {
      const storeCheckpoints = route.checkpoints.filter(cp => cp.storeId === storeId);
      const routeCheckIns = filteredCheckIns.filter(c => c.routeId === route.id);

      const completedCheckpoints = new Set(
        routeCheckIns
          .filter(c => c.status === 'submitted' || c.status === 'exception')
          .map(c => c.checkpointId)
      );

      const completedCount = completedCheckpoints.size;
      const totalCount = storeCheckpoints.length;
      const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      return {
        routeId: route.id,
        routeName: route.name,
        routeVersion: route.version,
        checkpoints: storeCheckpoints,
        checkIns: routeCheckIns,
        completedCount,
        totalCount,
        completionRate,
      };
    }).sort((a, b) => b.completionRate - a.completionRate);
  }, [canView, filteredCheckIns, patrolRoutes, storeId]);

  const stats = useMemo(() => {
    if (routeGroups.length === 0) {
      return { totalRoutes: 0, avgCompletion: 0, totalCheckIns: 0, exceptionCount: 0 };
    }

    const totalRoutes = routeGroups.length;
    const avgCompletion = Math.round(
      routeGroups.reduce((sum, g) => sum + g.completionRate, 0) / totalRoutes
    );
    const totalCheckIns = filteredCheckIns.length;
    const exceptionCount = filteredCheckIns.filter(c => c.status === 'exception').length;

    return { totalRoutes, avgCompletion, totalCheckIns, exceptionCount };
  }, [routeGroups, filteredCheckIns]);

  const getCheckpointName = (checkpointId: string, routeId: string) => {
    const route = patrolRoutes.find(r => r.id === routeId);
    return route?.checkpoints.find(cp => cp.id === checkpointId)?.name || checkpointId;
  };

  const getCheckpointTimeWindow = (checkpointId: string, routeId: string) => {
    const route = patrolRoutes.find(r => r.id === routeId);
    const checkpoint = route?.checkpoints.find(cp => cp.id === checkpointId);
    return checkpoint ? `${checkpoint.timeWindowStart} - ${checkpoint.timeWindowEnd}` : '-';
  };

  const getStoreName = (id: string) => stores.find(s => s.id === id)?.name || id;

  if (!currentUser) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">请先选择身份</h3>
        <p className="text-sm text-gray-400">登录后可查看门店巡检签到情况</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">无权限访问</h3>
        <p className="text-sm text-gray-400">您无权查看门店巡检签到情况</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#2d4a6f] rounded-xl p-6 text-white">
        <div className="flex items-center gap-3">
          <MapPin size={28} />
          <div>
            <h2 className="text-xl font-bold">{getStoreName(storeId)}</h2>
            <p className="text-white/80 text-sm">门店巡检签到完成情况</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-500" />
            <span className="text-sm text-gray-600">日期范围：</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            />
            <span className="text-gray-400">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="text-sm text-[#1e3a5f] hover:underline"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <MapPin size={24} className="text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{stats.totalRoutes}</div>
              <div className="text-sm text-gray-500">巡检路线数</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle size={24} className="text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{stats.avgCompletion}%</div>
              <div className="text-sm text-gray-500">平均完成率</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <User size={24} className="text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{stats.totalCheckIns}</div>
              <div className="text-sm text-gray-500">签到记录数</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <AlertTriangle size={24} className="text-orange-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{stats.exceptionCount}</div>
              <div className="text-sm text-gray-500">异常签到数</div>
            </div>
          </div>
        </div>
      </div>

      {routeGroups.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">暂无签到记录</h3>
          <p className="text-sm text-gray-400">
            {startDate || endDate ? '所选日期范围内暂无签到记录' : '当前门店暂无巡检签到记录'}
          </p>
        </div>
      ) : (
        routeGroups.map((group) => (
          <div key={group.routeId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <MapPin size={18} className="text-[#1e3a5f]" />
                  <div>
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                      {group.routeName}
                      <span className="text-xs font-normal text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                        v{group.routeVersion}
                      </span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      检查点 {group.totalCount} 个 · 已完成 {group.completedCount} 个
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          group.completionRate === 100
                            ? 'bg-green-500'
                            : group.completionRate >= 60
                            ? 'bg-blue-500'
                            : 'bg-orange-500'
                        }`}
                        style={{ width: `${group.completionRate}%` }}
                      />
                    </div>
                    <span className={`text-sm font-semibold ${
                      group.completionRate === 100
                        ? 'text-green-600'
                        : group.completionRate >= 60
                        ? 'text-blue-600'
                        : 'text-orange-600'
                    }`}>
                      {group.completionRate}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">检查点</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">时间窗</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">巡检员</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">签到时间</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">状态</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">异常信息</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.checkpoints.map((checkpoint) => {
                    const checkIn = group.checkIns.find(c => c.checkpointId === checkpoint.id);
                    return (
                      <tr key={checkpoint.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800">{checkpoint.name}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div className="flex items-center gap-1">
                            <Clock size={12} />
                            {checkpoint.timeWindowStart} - {checkpoint.timeWindowEnd}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {checkIn ? (
                            <div className="flex items-center gap-1">
                              <User size={12} />
                              {checkIn.inspectorName || checkIn.inspectorId}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {checkIn ? formatDate(checkIn.checkInTime) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {checkIn ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CHECKIN_STATUS_COLORS[checkIn.status]}`}>
                              {CHECKIN_STATUS_LABELS[checkIn.status]}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                              <XCircle size={12} />
                              未签到
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {checkIn?.exception ? (
                            <div className="text-sm">
                              <div className="flex items-center gap-1 text-orange-600 mb-1">
                                <AlertTriangle size={12} />
                                <span className="font-medium">{EXCEPTION_TYPE_LABELS[checkIn.exception.type]}</span>
                              </div>
                              {checkIn.exception.description && (
                                <p className="text-gray-600 text-xs bg-orange-50 px-2 py-1 rounded">
                                  {checkIn.exception.description}
                                </p>
                              )}
                            </div>
                          ) : checkIn?.remark ? (
                            <p className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
                              {checkIn.remark}
                            </p>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {group.checkIns.length > group.checkpoints.length && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  * 该路线共有 {group.checkIns.length} 条签到记录，含重复签到或历史版本记录
                </p>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
