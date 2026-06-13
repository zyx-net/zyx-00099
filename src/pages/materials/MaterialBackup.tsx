import { useRef, useState } from 'react';
import { useAppStore } from '@/store';
import {
  Database, Download, Upload, FileWarning, CheckCircle2, AlertTriangle,
  FileJson, Info, X
} from 'lucide-react';
import {
  validateMaterialBackupImport, buildMaterialExportPayload, parseMaterialBackupPayload
} from '@/services/syncService';
import type { MaterialImportValidationResult } from '@/types';

export default function MaterialBackup() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [validation, setValidation] = useState<MaterialImportValidationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastExportTime, setLastExportTime] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    materials, materialRecords, materialBorrowForms, materialBatches, materialSyncQueue,
    currentUser, addToast, importMaterialBackup,
  } = useAppStore();

  const handleExport = () => {
    const payload = buildMaterialExportPayload(
      materials,
      materialBatches,
      materialBorrowForms,
      materialRecords,
      materialSyncQueue,
      currentUser || undefined,
    );
    const dataStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `material-backup-${ts}.json`;
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

      const parsed = parseMaterialBackupPayload(json);
      if (!parsed.valid || !parsed.payload) {
        setValidation({
          valid: false,
          warnings: parsed.warnings,
          errors: parsed.errors,
          materialsToImport: [],
          batchesToImport: [],
          borrowFormsToImport: [],
          recordsToImport: [],
        });
        addToast('error', '备份文件格式无效');
        return;
      }

      const result = validateMaterialBackupImport(parsed.payload, materials, currentUser);
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
        materialsToImport: [],
        batchesToImport: [],
        borrowFormsToImport: [],
        recordsToImport: [],
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
      const parsed = parseMaterialBackupPayload(
        buildMaterialExportPayload(
          validation.materialsToImport,
          validation.batchesToImport,
          validation.borrowFormsToImport,
          validation.recordsToImport,
          [],
          currentUser || undefined,
        )
      );

      if (!parsed.payload) {
        throw new Error('构建导入数据失败');
      }

      const result = await importMaterialBackup(parsed.payload);

      if (result.success) {
        addToast(
          'success',
          `导入完成：物资 ${validation.materialsToImport.length}、批次 ${validation.batchesToImport.length}、借用单 ${validation.borrowFormsToImport.length}、记录 ${validation.recordsToImport.length}`
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
                将物资目录、借用单据、库存记录、批次、同步队列打包为 JSON 文件。
              </p>
            </div>
          </div>
          <div className="space-y-3 mb-4 text-sm">
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">物资目录</span>
              <span className="font-medium text-gray-800">{materials.length} 条</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">借用单据</span>
              <span className="font-medium text-gray-800">{materialBorrowForms.length} 条</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">操作记录</span>
              <span className="font-medium text-gray-800">{materialRecords.length} 条</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">库存批次</span>
              <span className="font-medium text-gray-800">{materialBatches.length} 条</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-gray-100">
              <span className="text-gray-500">同步队列</span>
              <span className="font-medium text-gray-800">{materialSyncQueue.length} 条</span>
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
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#1e3a5f]/90 transition-colors"
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
                  <li>导入会<strong>合并</strong>到当前物资数据中</li>
                  <li>已存在的物资编号将被跳过</li>
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
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-[#1e3a5f] hover:text-[#1e3a5f] hover:bg-blue-50/50 transition-colors"
          >
            <Database size={16} />
            选择 JSON 文件
          </button>
        </div>
      </div>

      {validation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden">
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

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
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
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <div className="flex items-start gap-2">
                        <FileWarning size={20} className="text-amber-600 shrink-0" />
                        <div>
                          <div className="font-medium text-amber-800 mb-1">
                            警告信息（{validation.warnings.length} 条）
                          </div>
                          <div className="text-sm text-amber-700 space-y-1 max-h-40 overflow-y-auto">
                            {validation.warnings.slice(0, 10).map((w, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-amber-500 shrink-0">•</span>
                                <span>{w.message}</span>
                              </div>
                            ))}
                            {validation.warnings.length > 10 && (
                              <div className="text-amber-600">
                                ...还有 {validation.warnings.length - 10} 条警告
                              </div>
                            )}
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
                        <div className="text-xs text-gray-400">物资目录</div>
                        <div className="font-semibold text-gray-800">{validation.materialsToImport.length}</div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded p-2">
                        <div className="text-xs text-gray-400">借用单据</div>
                        <div className="font-semibold text-gray-800">{validation.borrowFormsToImport.length}</div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded p-2">
                        <div className="text-xs text-gray-400">操作记录</div>
                        <div className="font-semibold text-gray-800">{validation.recordsToImport.length}</div>
                      </div>
                      <div className="bg-white border border-gray-200 rounded p-2">
                        <div className="text-xs text-gray-400">库存批次</div>
                        <div className="font-semibold text-gray-800">{validation.batchesToImport.length}</div>
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
                    <p>导入将把备份中的数据合并到当前系统中。已存在的物资编号会被跳过。</p>
                    <p className="mt-2">
                      即将导入：
                      <br />• 物资 {validation.materialsToImport.length} 条
                      <br />• 库存批次 {validation.batchesToImport.length} 条
                      <br />• 借用单 {validation.borrowFormsToImport.length} 条
                      <br />• 出入库记录 {validation.recordsToImport.length} 条
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
