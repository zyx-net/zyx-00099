import { useRef, useState } from 'react';
import { useAppStore } from '@/store';
import {
  Database, Download, Upload, FileWarning, CheckCircle2, AlertTriangle,
  FileJson, Info, X
} from 'lucide-react';
import {
  validatePatrolBackupImport, buildPatrolExportPayload, parsePatrolBackupPayload
} from '@/services/syncService';
import type { PatrolImportValidationResult } from '@/types';
import { canExportPatrol, canManagePatrolRoute } from '@/utils/permissions';

export default function PatrolBackup() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [validation, setValidation] = useState<PatrolImportValidationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastExportTime, setLastExportTime] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    patrolRoutes, checkIns, patrolSyncQueue,
    currentUser, addToast, importPatrolBackup,
    lastPatrolImportValidation, patrolImportWarnings,
  } = useAppStore();

  const canExport = currentUser ? canExportPatrol(currentUser) : false;
  const canImport = currentUser ? canManagePatrolRoute(currentUser) : false;

  const handleExport = () => {
    if (!canExport) {
      addToast('error', '权限不足，仅督导可导出巡检数据');
      return;
    }
    const payload = buildPatrolExportPayload(
      patrolRoutes,
      checkIns,
      patrolSyncQueue,
      currentUser || undefined,
    );
    const dataStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patrol-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastExportTime(new Date().toLocaleString('zh-CN'));
    addToast('success', '备份导出成功');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const parsed = parsePatrolBackupPayload(json);
      if (!parsed.valid || !parsed.payload) {
        setValidation({
          valid: false,
          warnings: [],
          errors: [...parsed.errors, ...parsed.warnings],
          routesToImport: [],
          checkInsToImport: [],
        });
        addToast('error', '备份文件格式无效');
        return;
      }

      const result = validatePatrolBackupImport(parsed.payload, patrolRoutes, currentUser);
      setValidation(result);

      if (result.valid && result.warnings.length === 0) {
        addToast('success', '备份文件验证通过');
      } else if (result.warnings.length > 0) {
        addToast('warning', `验证完成，存在 ${result.warnings.length} 条警告`);
      } else {
        addToast('error', '备份文件验证失败');
      }
    } catch (err) {
      addToast('error', '解析失败: ' + (err as Error).message);
      setValidation({
        valid: false,
        warnings: [],
        errors: ['无法解析 JSON 文件：' + (err as Error).message],
        routesToImport: [],
        checkInsToImport: [],
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmImport = async () => {
    if (!validation || !validation.valid) return;
    setShowConfirm(true);
  };

  const handleDoImport = async () => {
    if (!validation) return;

    setImporting(true);
    setShowConfirm(false);
    try {
      const parsed = parsePatrolBackupPayload(
        buildPatrolExportPayload(
          validation.routesToImport,
          validation.checkInsToImport,
          [],
          currentUser || undefined,
        )
      );

      if (!parsed.payload) {
        throw new Error('构建导入数据失败');
      }

      const result = await importPatrolBackup(parsed.payload);

      if (result.success) {
        addToast(
          'success',
          `导入完成：巡检路线 ${validation.routesToImport.length}、签到记录 ${validation.checkInsToImport.length}`
        );
        if (result.warnings.length > 0) {
          addToast('warning', `存在 ${result.warnings.length} 条警告，请留意`);
        }
        setValidation(null);
      } else {
        addToast('error', '导入失败: ' + result.errors.join('、'));
      }
    } catch (err) {
      addToast('error', '导入失败: ' + (err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const resetValidation = () => {
    setValidation(null);
    setShowConfirm(false);
  };

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="p-3 bg-blue-100 rounded-xl text-blue-600 shrink-0">
              <Download size={24} />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-800 mb-1">导出备份</h3>
              <p className="text-sm text-gray-500">
                将巡检路线、签到记录、同步队列打包为 JSON 文件。
              </p>
            </div>
          </div>
          <div className="space-y-3 mb-4 text-sm">
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">巡检路线</span>
              <span className="font-medium text-gray-800">{patrolRoutes.length} 条</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">签到记录</span>
              <span className="font-medium text-gray-800">{checkIns.length} 条</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">同步队列</span>
              <span className="font-medium text-gray-800">{patrolSyncQueue.length} 条</span>
            </div>
          </div>
          {lastExportTime && (
            <div className="text-xs text-gray-400 mb-3 flex items-center gap-1">
              <CheckCircle2 size={12} className="text-green-500" />
              上次导出: {lastExportTime}
            </div>
          )}
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1e3a5f]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileJson size={16} />
            导出 JSON 备份
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600 shrink-0">
              <Upload size={24} />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-800 mb-1">导入备份</h3>
              <p className="text-sm text-gray-500">
                选择之前导出的 JSON 备份文件，系统会先验证再提示确认导入。
              </p>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-medium mb-1">导入说明</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>导入会<strong>合并</strong>到当前巡检数据中</li>
                  <li>已存在的路线编号将被跳过</li>
                  <li>导入前会显示验证结果和警告信息</li>
                </ul>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!canImport}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-[#1e3a5f] hover:text-[#1e3a5f] hover:bg-blue-50/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Database size={16} />
            选择 JSON 文件
          </button>
        </div>
      </div>

      {lastPatrolImportValidation && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <FileWarning size={20} className="text-amber-500" />
            上次导入验证结果
          </h3>
          <div className="mb-4 text-sm">
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              lastPatrolImportValidation.valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {lastPatrolImportValidation.valid ? '验证通过' : '验证失败'}
            </span>
          </div>
          {patrolImportWarnings.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-3">警告详情</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-600 border-b">Type</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 border-b">Missing Fields</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 border-b">Applied Defaults</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 border-b">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patrolImportWarnings.map((warning, index) => (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                            {warning.type}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {warning.missingFields && warning.missingFields.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {warning.missingFields.map((field, i) => (
                                <span key={i} className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-xs">
                                  {field}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {warning.appliedDefaults && Object.keys(warning.appliedDefaults).length > 0 ? (
                            <div className="text-xs text-gray-600 max-w-xs truncate">
                              {Object.entries(warning.appliedDefaults).map(([key, value], i) => (
                                <div key={i}>
                                  <span className="text-gray-500">{key}:</span>{' '}
                                  <span className="text-blue-600 font-mono">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-700 max-w-xs truncate" title={warning.message}>
                          {warning.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {validation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                {validation.valid && validation.warnings.length === 0 ? (
                  <><CheckCircle2 size={20} className="text-green-600" />备份验证通过</>
                ) : validation.valid ? (
                  <><FileWarning size={20} className="text-amber-500" />备份存在警告</>
                ) : (
                  <><AlertTriangle size={20} className="text-red-500" />备份验证失败</>
                )}
              </h3>
              <button onClick={resetValidation} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {!validation.valid && validation.errors.length > 0 ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={20} className="shrink-0" />
                    <div>
                      <div className="font-medium mb-1">备份文件验证失败</div>
                      <ul className="text-sm list-disc pl-4 space-y-1">
                        {validation.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {validation.warnings.length > 0 && (
                    <div className="space-y-4">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <div className="flex items-start gap-2">
                          <FileWarning size={20} className="text-amber-600 shrink-0" />
                          <div>
                            <div className="font-medium text-amber-800 mb-1">
                              警告信息（{validation.warnings.length} 条）
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm mt-3">
                                <thead>
                                  <tr className="bg-amber-100/50">
                                    <th className="px-3 py-2 text-left font-medium text-amber-700 border-b border-amber-200">Type</th>
                                    <th className="px-3 py-2 text-left font-medium text-amber-700 border-b border-amber-200">Missing Fields</th>
                                    <th className="px-3 py-2 text-left font-medium text-amber-700 border-b border-amber-200">Applied Defaults</th>
                                    <th className="px-3 py-2 text-left font-medium text-amber-700 border-b border-amber-200">Message</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {validation.warnings.slice(0, 20).map((warning, index) => (
                                    <tr key={index} className="border-b border-amber-100">
                                      <td className="px-3 py-2">
                                        <span className="px-2 py-0.5 bg-amber-200/50 text-amber-700 rounded text-xs">
                                          {warning.type}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2">
                                        {warning.missingFields && warning.missingFields.length > 0 ? (
                                          <div className="flex flex-wrap gap-1">
                                            {warning.missingFields.map((field, i) => (
                                              <span key={i} className="px-2 py-0.5 bg-red-100/50 text-red-600 rounded text-xs">
                                                {field}
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-amber-400">-</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2">
                                        {warning.appliedDefaults && Object.keys(warning.appliedDefaults).length > 0 ? (
                                          <div className="text-xs text-amber-600 max-w-xs truncate">
                                            {Object.entries(warning.appliedDefaults).map(([key, value], i) => (
                                              <div key={i}>
                                                <span className="text-amber-500">{key}:</span>{' '}
                                                <span className="text-blue-600 font-mono">{String(value)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-amber-400">-</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-amber-700 max-w-xs truncate" title={warning.message}>
                                        {warning.message}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {validation.warnings.length > 20 && (
                                <div className="text-amber-600 text-sm mt-2">
                                  ...还有 {validation.warnings.length - 20} 条警告
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {validation.valid && validation.warnings.length === 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 size={20} className="text-green-600 shrink-0" />
                        <div>
                          <div className="font-medium text-green-800 mb-1">验证通过</div>
                          <div className="text-sm text-green-700">备份数据完整，可以安全导入。</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm font-medium text-gray-700 mb-3">导入内容预览</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-white border border-gray-200 rounded p-2">
                        <div className="text-xs text-gray-400">巡检路线</div>
                        <div className="font-semibold text-gray-800">{validation.routesToImport.length}</div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded p-2">
                        <div className="text-xs text-gray-400">签到记录</div>
                        <div className="font-semibold text-gray-800">{validation.checkInsToImport.length}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={resetValidation}
                className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              {validation.valid ? (
                <button
                  onClick={handleConfirmImport}
                  disabled={importing}
                  className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1e3a5f]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {importing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      导入中...
                    </>
                  ) : (
                    <>确认导入</>
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {showConfirm && validation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">确认导入</h3>
            </div>
            <div className="p-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={20} className="text-amber-600 shrink-0" />
                  <div className="text-sm text-amber-800">
                    <div className="font-medium mb-1">请确认导入操作</div>
                    <p>导入将把备份中的数据合并到当前系统中。已存在的路线编号会被跳过。</p>
                    <p className="mt-2">
                      即将导入：
                      <br />• 巡检路线 {validation.routesToImport.length} 条
                      <br />• 签到记录 {validation.checkInsToImport.length} 条
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDoImport}
                className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1e3a5f]/90 transition-colors"
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
