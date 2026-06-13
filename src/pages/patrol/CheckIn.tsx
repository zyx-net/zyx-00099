import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import {
  MapPin, Clock, AlertTriangle, CheckCircle, X,
  FileText, Search, AlertCircle,
  Map, Calendar, User, ChevronRight
} from 'lucide-react';
import { PatrolCheckpoint, CheckIn, CheckInStatus, CheckInException } from '@/types';
import {
  CHECKIN_STATUS_LABELS, CHECKIN_STATUS_COLORS,
  CHECKIN_SYNC_STATUS_LABELS, CHECKIN_SYNC_STATUS_COLORS,
  EXCEPTION_TYPE_LABELS, formatDate
} from '@/utils/helpers';
import { canCheckInPatrol } from '@/utils/permissions';

interface ValidationDialogData {
  errors: string[];
  warnings: string[];
  options: Array<{ label: string; value: string }>;
  routeId: string;
  checkpointId: string;
  storeId: string;
  remark?: string;
}

interface ExceptionDialogData {
  checkInId: string;
  exceptionType: CheckInException['type'];
}

export default function CheckInPage() {
  const {
    patrolRoutes, checkIns, stores, currentUser, addToast,
    submitCheckIn, saveCheckInDraft, markCheckInException,
    getCheckInsForCurrentUser, abandonCheckIn
  } = useAppStore();

  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CheckInStatus | 'all'>('all');
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationDialogData, setValidationDialogData] = useState<ValidationDialogData | null>(null);
  const [showExceptionDialog, setShowExceptionDialog] = useState(false);
  const [exceptionDialogData, setExceptionDialogData] = useState<ExceptionDialogData | null>(null);
  const [exceptionDescription, setExceptionDescription] = useState('');
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [remark, setRemark] = useState('');

  const canCheckIn = canCheckInPatrol(currentUser);

  const activeRoutes = useMemo(() => {
    return patrolRoutes.filter(r => r.status === 'active');
  }, [patrolRoutes]);

  const selectedRoute = useMemo(() => {
    return patrolRoutes.find(r => r.id === selectedRouteId);
  }, [patrolRoutes, selectedRouteId]);

  const sortedCheckpoints = useMemo(() => {
    if (!selectedRoute) return [];
    return [...selectedRoute.checkpoints]
      .filter(cp => cp.status === 'active')
      .sort((a, b) => a.order - b.order);
  }, [selectedRoute]);

  const userCheckIns = useMemo(() => {
    return getCheckInsForCurrentUser();
  }, [checkIns, currentUser]);

  const filteredCheckIns = useMemo(() => {
    return userCheckIns.filter(ci => {
      if (statusFilter !== 'all' && ci.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const route = patrolRoutes.find(r => r.id === ci.routeId);
        const checkpoint = route?.checkpoints.find(cp => cp.id === ci.checkpointId);
        const store = stores.find(s => s.id === ci.storeId);
        return (route?.name?.toLowerCase().includes(q) || false)
          || (checkpoint?.name?.toLowerCase().includes(q) || false)
          || (store?.name?.toLowerCase().includes(q) || false)
          || (ci.remark?.toLowerCase().includes(q) || false)
          || ci.exception?.description?.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime());
  }, [userCheckIns, statusFilter, searchQuery, patrolRoutes, stores]);

  const isCheckpointAlreadyCheckedIn = (checkpointId: string): boolean => {
    if (!currentUser) return false;
    return userCheckIns.some(ci =>
      ci.checkpointId === checkpointId
      && ci.inspectorId === currentUser.id
      && ci.status !== 'draft'
    );
  };

  const getStoreName = (storeId: string) => stores.find(s => s.id === storeId)?.name || storeId;
  const getRouteName = (routeId: string) => patrolRoutes.find(r => r.id === routeId)?.name || routeId;
  const getCheckpointName = (routeId: string, checkpointId: string) => {
    const route = patrolRoutes.find(r => r.id === routeId);
    return route?.checkpoints.find(cp => cp.id === checkpointId)?.name || checkpointId;
  };

  const getCurrentTimeStatus = (checkpoint: PatrolCheckpoint): { status: 'normal' | 'early' | 'late'; label: string } => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    if (timeStr < checkpoint.timeWindowStart) {
      return { status: 'early', label: '未到时间' };
    }
    if (timeStr > checkpoint.timeWindowEnd) {
      return { status: 'late', label: '已超时' };
    }
    return { status: 'normal', label: '进行中' };
  };

  const handleCheckIn = async (checkpoint: PatrolCheckpoint) => {
    if (!currentUser || !selectedRoute) return;
    if (isCheckpointAlreadyCheckedIn(checkpoint.id)) {
      addToast('warning', '该检查点已签到');
      return;
    }

    setCheckingIn(checkpoint.id);
    try {
      const result = await submitCheckIn({
        routeId: selectedRoute.id,
        checkpointId: checkpoint.id,
        storeId: checkpoint.storeId,
        remark: remark.trim() || undefined,
      });

      if (result.success) {
        addToast('success', '签到成功');
        setRemark('');
      } else {
        if (result.warnings || result.options) {
          setValidationDialogData({
            errors: result.error ? [result.error] : [],
            warnings: result.warnings || [],
            options: result.options || [],
            routeId: selectedRoute.id,
            checkpointId: checkpoint.id,
            storeId: checkpoint.storeId,
            remark: remark.trim() || undefined,
          });
          setShowValidationDialog(true);
        } else {
          addToast('error', result.error || '签到失败');
        }
      }
    } catch (e) {
      addToast('error', (e as Error).message || '签到失败');
    } finally {
      setCheckingIn(null);
    }
  };

  const handleValidationOption = async (optionValue: string) => {
    if (!validationDialogData) return;

    const { routeId, checkpointId, storeId, remark: checkInRemark } = validationDialogData;

    if (optionValue === 'cancel') {
      setShowValidationDialog(false);
      setValidationDialogData(null);
      return;
    }

    if (optionValue === 'draft') {
      try {
        await saveCheckInDraft({
          routeId,
          checkpointId,
          storeId,
          remark: checkInRemark,
        });
        addToast('success', '草稿已保存');
        setShowValidationDialog(false);
        setValidationDialogData(null);
        setRemark('');
      } catch (e) {
        addToast('error', (e as Error).message || '保存草稿失败');
      }
      return;
    }

    if (optionValue === 'exception') {
      const warnings = validationDialogData.warnings;
      let exceptionType: CheckInException['type'] = 'other';
      
      if (warnings.some(w => w.includes('时间窗'))) {
        exceptionType = 'out_of_window';
      } else if (warnings.some(w => w.includes('跨门店'))) {
        exceptionType = 'cross_store';
      } else if (warnings.some(w => w.includes('版本'))) {
        exceptionType = 'version_mismatch';
      }

      setExceptionDialogData({
        checkInId: '',
        exceptionType,
      });
      setExceptionDescription('');
      setShowExceptionDialog(true);
      return;
    }
  };

  const handleConfirmException = async () => {
    if (!validationDialogData || !exceptionDialogData) return;
    if (!exceptionDescription.trim()) {
      addToast('error', '请填写异常说明');
      return;
    }

    try {
      const draftResult = await saveCheckInDraft({
        routeId: validationDialogData.routeId,
        checkpointId: validationDialogData.checkpointId,
        storeId: validationDialogData.storeId,
        remark: validationDialogData.remark,
      });

      if (draftResult.success && draftResult.checkIn) {
        await markCheckInException(
          draftResult.checkIn.id,
          exceptionDialogData.exceptionType,
          exceptionDescription.trim()
        );
        addToast('success', '异常签到已记录');
      }

      setShowExceptionDialog(false);
      setShowValidationDialog(false);
      setValidationDialogData(null);
      setExceptionDialogData(null);
      setExceptionDescription('');
      setRemark('');
    } catch (e) {
      addToast('error', (e as Error).message || '记录异常失败');
    }
  };

  const handleAbandon = async (checkInId: string) => {
    try {
      await abandonCheckIn(checkInId);
      addToast('success', '签到记录已放弃');
    } catch (e) {
      addToast('error', (e as Error).message || '放弃失败');
    }
  };

  const statusOptions: (CheckInStatus | 'all')[] = ['all', 'draft', 'submitted', 'exception'];

  if (!canCheckIn) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-12 text-center">
        <AlertCircle size={40} className="mx-auto text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">权限不足</h3>
        <p className="text-sm text-gray-400">您没有巡检签到的权限，请联系管理员</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#2d4a6f] rounded-xl p-6 text-white">
        <div className="flex items-center gap-3">
          <Map size={28} />
          <div>
            <h2 className="text-xl font-bold">巡检签到</h2>
            <p className="text-blue-100 text-sm mt-1">选择巡检路线，按顺序完成检查点签到</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Map size={18} className="text-[#1e3a5f]" />
          选择巡检路线
        </h3>
        {activeRoutes.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Map size={32} className="mx-auto mb-2 opacity-50" />
            <p>暂无可用的巡检路线</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeRoutes.map(route => (
              <button
                key={route.id}
                onClick={() => setSelectedRouteId(route.id === selectedRouteId ? '' : route.id)}
                className={cn(
                  'p-4 rounded-lg border-2 text-left transition-all hover:shadow-md',
                  selectedRouteId === route.id
                    ? 'border-[#1e3a5f] bg-blue-50'
                    : 'border-gray-200 hover:border-blue-200'
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-800">{route.name}</h4>
                    <p className="text-sm text-gray-500 mt-1">
                      {route.checkpoints.filter(cp => cp.status === 'active').length} 个检查点
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      创建者：{route.creatorName || route.creatorId}
                    </p>
                  </div>
                  <ChevronRight
                    size={20}
                    className={cn(
                      'transition-transform',
                      selectedRouteId === route.id ? 'text-[#1e3a5f] rotate-90' : 'text-gray-300'
                    )}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRoute && sortedCheckpoints.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <MapPin size={18} className="text-[#1e3a5f]" />
              检查点列表
              <span className="text-sm font-normal text-gray-500">
                - {selectedRoute.name}
              </span>
            </h3>
            <span className="text-xs text-gray-400">版本 v{selectedRoute.version}</span>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">签到备注</label>
            <textarea
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="可选：填写签到备注信息"
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          <div className="space-y-3">
            {sortedCheckpoints.map((checkpoint, index) => {
              const timeStatus = getCurrentTimeStatus(checkpoint);
              const alreadyCheckedIn = isCheckpointAlreadyCheckedIn(checkpoint.id);
              const lastCheckIn = userCheckIns.find(ci => ci.checkpointId === checkpoint.id && ci.status !== 'draft');

              return (
                <div
                  key={checkpoint.id}
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-lg border transition-all',
                    alreadyCheckedIn
                      ? 'bg-green-50 border-green-200'
                      : timeStatus.status === 'late'
                        ? 'bg-orange-50 border-orange-200'
                        : timeStatus.status === 'early'
                          ? 'bg-gray-50 border-gray-200'
                          : 'bg-white border-gray-200 hover:border-blue-200'
                  )}
                >
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center font-bold text-white',
                    alreadyCheckedIn
                      ? 'bg-green-500'
                      : timeStatus.status === 'late'
                        ? 'bg-orange-500'
                        : 'bg-[#1e3a5f]'
                  )}>
                    {alreadyCheckedIn ? <CheckCircle size={18} /> : index + 1}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-800">{checkpoint.name}</h4>
                      {alreadyCheckedIn && (
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded-full',
                          CHECKIN_STATUS_COLORS[lastCheckIn?.status || 'submitted']
                        )}>
                          {CHECKIN_STATUS_LABELS[lastCheckIn?.status || 'submitted']}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin size={14} />
                        {getStoreName(checkpoint.storeId)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {checkpoint.timeWindowStart} - {checkpoint.timeWindowEnd}
                      </span>
                      {!alreadyCheckedIn && (
                        <span className={cn(
                          'flex items-center gap-1 text-xs px-2 py-0.5 rounded',
                          timeStatus.status === 'normal' ? 'bg-green-100 text-green-700' :
                          timeStatus.status === 'early' ? 'bg-blue-100 text-blue-700' :
                          'bg-orange-100 text-orange-700'
                        )}>
                          {timeStatus.label}
                        </span>
                      )}
                      {alreadyCheckedIn && lastCheckIn && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Calendar size={14} />
                          {formatDate(lastCheckIn.checkInTime)}
                        </span>
                      )}
                    </div>
                    {lastCheckIn?.exception && (
                      <div className="mt-2 text-xs text-orange-600 bg-orange-50 rounded px-2 py-1">
                        <span className="font-medium">{EXCEPTION_TYPE_LABELS[lastCheckIn.exception.type]}：</span>
                        {lastCheckIn.exception.description}
                      </div>
                    )}
                  </div>

                  {!alreadyCheckedIn && (
                    <button
                      onClick={() => handleCheckIn(checkpoint)}
                      disabled={checkingIn === checkpoint.id}
                      className={cn(
                        'px-4 py-2 rounded-lg text-white font-medium transition-colors',
                        timeStatus.status === 'early'
                          ? 'bg-gray-400 hover:bg-gray-500'
                          : 'bg-[#1e3a5f] hover:bg-[#2d4a6f]',
                        checkingIn === checkpoint.id && 'opacity-70 cursor-not-allowed'
                      )}
                    >
                      {checkingIn === checkpoint.id ? '签到中...' : '签到'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <FileText size={18} className="text-[#1e3a5f]" />
            我的签到记录
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="搜索路线/检查点/门店..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as CheckInStatus | 'all')}
              className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {statusOptions.map(s => (
                <option key={s} value={s}>
                  {s === 'all' ? '全部状态' : CHECKIN_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredCheckIns.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <p>暂无签到记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">巡检路线</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">检查点</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">门店</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">签到时间</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">签到状态</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">同步状态</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">异常信息</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCheckIns.map(checkIn => (
                  <tr key={checkIn.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-800">{getRouteName(checkIn.routeId)}</td>
                    <td className="px-4 py-3 text-gray-800">{getCheckpointName(checkIn.routeId, checkIn.checkpointId)}</td>
                    <td className="px-4 py-3 text-gray-600">{getStoreName(checkIn.storeId)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(checkIn.checkInTime)}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        CHECKIN_STATUS_COLORS[checkIn.status]
                      )}>
                        {CHECKIN_STATUS_LABELS[checkIn.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        CHECKIN_SYNC_STATUS_COLORS[checkIn.syncStatus]
                      )}>
                        {CHECKIN_SYNC_STATUS_LABELS[checkIn.syncStatus]}
                      </span>
                      {checkIn.lastSyncError && (
                        <div className="text-xs text-red-500 mt-1" title={checkIn.lastSyncError}>
                          {checkIn.lastSyncError.slice(0, 20)}...
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {checkIn.exception ? (
                        <div className="text-xs">
                          <span className="font-medium text-orange-600">
                            {EXCEPTION_TYPE_LABELS[checkIn.exception.type]}
                          </span>
                          <div className="text-gray-500 mt-0.5 max-w-xs truncate">
                            {checkIn.exception.description}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {checkIn.status === 'draft' && (
                          <button
                            onClick={() => handleAbandon(checkIn.id)}
                            className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            放弃
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showValidationDialog && validationDialogData && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <AlertTriangle size={20} className="text-yellow-500" />
                签到验证提示
              </h3>
              <button
                onClick={() => {
                  setShowValidationDialog(false);
                  setValidationDialogData(null);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {validationDialogData.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-red-800">错误</div>
                      {validationDialogData.errors.map((err, idx) => (
                        <div key={idx} className="text-sm text-red-700 mt-1">• {err}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {validationDialogData.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium text-yellow-800">警告</div>
                      {validationDialogData.warnings.map((warn, idx) => (
                        <div key={idx} className="text-sm text-yellow-700 mt-1">• {warn}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="font-medium text-blue-800 mb-2">请选择处理方式：</div>
                <div className="space-y-2">
                  {validationDialogData.options.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleValidationOption(option.value)}
                      className={cn(
                        'w-full text-left px-4 py-3 rounded-lg border transition-colors',
                        option.value === 'cancel'
                          ? 'border-gray-200 hover:bg-gray-50 text-gray-600'
                          : option.value === 'exception'
                            ? 'border-orange-200 hover:bg-orange-50 text-orange-700'
                            : 'border-blue-200 hover:bg-blue-50 text-blue-700'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExceptionDialog && exceptionDialogData && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <AlertTriangle size={20} className="text-orange-500" />
                记录异常签到
              </h3>
              <button
                onClick={() => {
                  setShowExceptionDialog(false);
                  setExceptionDialogData(null);
                  setExceptionDescription('');
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-orange-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-orange-800">异常类型</div>
                    <div className="text-sm text-orange-700 mt-1">
                      {EXCEPTION_TYPE_LABELS[exceptionDialogData.exceptionType]}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  异常说明 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={exceptionDescription}
                  onChange={e => setExceptionDescription(e.target.value)}
                  placeholder="请详细描述异常情况..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                />
              </div>

              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-2">
                  <User size={14} />
                  <span>签到人：{currentUser?.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} />
                  <span>{formatDate(new Date().toISOString())}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => {
                  setShowExceptionDialog(false);
                  setExceptionDialogData(null);
                  setExceptionDescription('');
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmException}
                disabled={!exceptionDescription.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                <AlertTriangle size={16} />
                确认异常签到
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
