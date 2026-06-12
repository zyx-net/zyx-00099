import { useState } from 'react';
import { useAppStore } from '@/store';
import { formatDate, STATUS_LABELS } from '@/utils/helpers';
import {
  Download, FileJson, FileSpreadsheet, CheckCircle, FileText,
  Store as StoreIcon, FileCheck, BarChart3, Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Export() {
  const { issues, stores, templates, exportData, syncQueue } = useAppStore();
  const [format, setFormat] = useState<'json' | 'csv'>('json');

  const stats = {
    totalIssues: issues.length,
    byStatus: {
      draft: issues.filter(i => i.status === 'draft').length,
      submitted: issues.filter(i => i.status === 'submitted').length,
      rejected: issues.filter(i => i.status === 'rejected').length,
      closed: issues.filter(i => i.status === 'closed').length,
    },
    synced: issues.filter(i => i.synced).length,
    pendingSync: syncQueue.filter(i => i.status !== 'completed').length,
    stores: stores.length,
    templates: templates.length,
  };

  const syncedIssues = issues.filter(i => i.synced);
  const unsyncedIssues = issues.filter(i => !i.synced);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">问题总数</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stats.totalIssues}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">已同步</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{stats.synced}</p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-green-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">门店数量</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stats.stores}</p>
            </div>
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <StoreIcon size={20} className="text-purple-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">模板数量</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stats.templates}</p>
            </div>
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <FileCheck size={20} className="text-orange-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {(['draft', 'submitted', 'rejected', 'closed'] as const).map(status => (
          <div key={status} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-3 h-full rounded-full',
                status === 'draft' && 'bg-gray-400',
                status === 'submitted' && 'bg-blue-500',
                status === 'rejected' && 'bg-red-500',
                status === 'closed' && 'bg-green-500'
              )} />
              <div>
                <p className="text-sm text-gray-500">{STATUS_LABELS[status]}</p>
                <p className="text-xl font-bold text-gray-800">{stats.byStatus[status]}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {stats.pendingSync > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Calendar className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">
                有 {stats.pendingSync} 条数据尚未同步
              </p>
              <p className="text-yellow-700">
                导出的数据将包含所有本地记录，但未同步的数据可能不包含最新的服务器端版本。建议先完成同步后再导出。
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h3 className="font-medium text-gray-800 flex items-center gap-2">
              <Download size={18} />
              导出数据
            </h3>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                选择导出格式
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setFormat('json')}
                  className={cn(
                    'p-4 rounded-xl border-2 text-left transition-all',
                    format === 'json'
                      ? 'border-[#1e3a5f] bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <FileJson size={32} className={cn(
                    'mb-2',
                    format === 'json' ? 'text-[#1e3a5f]' : 'text-gray-400'
                  )} />
                  <p className={cn(
                    'font-medium',
                    format === 'json' ? 'text-[#1e3a5f]' : 'text-gray-700'
                  )}>JSON 格式</p>
                  <p className="text-xs text-gray-500 mt-1">包含完整数据结构，适合备份</p>
                </button>
                <button
                  onClick={() => setFormat('csv')}
                  className={cn(
                    'p-4 rounded-xl border-2 text-left transition-all',
                    format === 'csv'
                      ? 'border-[#1e3a5f] bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <FileSpreadsheet size={32} className={cn(
                    'mb-2',
                    format === 'csv' ? 'text-[#1e3a5f]' : 'text-gray-400'
                  )} />
                  <p className={cn(
                    'font-medium',
                    format === 'csv' ? 'text-[#1e3a5f]' : 'text-gray-700'
                  )}>CSV 格式</p>
                  <p className="text-xs text-gray-500 mt-1">可在 Excel 中打开查看</p>
                </button>
              </div>
            </div>

            <button
              onClick={() => exportData(format)}
              disabled={issues.length === 0}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#1e3a5f] text-white rounded-xl hover:bg-[#2d4a6f] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={20} />
              导出 {format.toUpperCase()} 文件
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h3 className="font-medium text-gray-800 flex items-center gap-2">
              <BarChart3 size={18} />
              导出预览
            </h3>
          </div>

          <div className="p-6 space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">将导出以下内容</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" />
                  {issues.length} 条问题记录（含草稿、已提交、已驳回、已关闭）
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" />
                  {stores.length} 个门店配置
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" />
                  {templates.length} 个检查模板
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" />
                  导出时间: {formatDate(new Date())}
                </li>
              </ul>
            </div>

            {syncedIssues.length > 0 && (
              <div className="bg-green-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-green-700 mb-1">
                  已同步数据 ({syncedIssues.length} 条)
                </h4>
                <p className="text-xs text-green-600">
                  这些数据已与服务器同步，包含最新版本
                </p>
              </div>
            )}

            {unsyncedIssues.length > 0 && (
              <div className="bg-orange-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-orange-700 mb-1">
                  未同步数据 ({unsyncedIssues.length} 条)
                </h4>
                <p className="text-xs text-orange-600">
                  这些数据仅保存在本地，建议先同步后再导出
                </p>
              </div>
            )}

            {issues.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  最近 5 条问题
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {issues.slice(-5).reverse().map(issue => (
                    <div key={issue.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate flex-1">{issue.title}</span>
                      <span className={cn(
                        'ml-2 px-2 py-0.5 rounded text-xs font-medium',
                        issue.synced
                          ? 'bg-green-100 text-green-700'
                          : 'bg-orange-100 text-orange-700'
                      )}>
                        {issue.synced ? '已同步' : '未同步'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <FileText className="text-blue-500 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">导出说明</p>
            <ul className="space-y-1 text-blue-700">
              <li>• 导出文件包含所有本地存储的数据，包括未同步的离线数据</li>
              <li>• JSON 格式适合数据备份和程序导入，包含完整的结构信息</li>
              <li>• CSV 格式适合在 Excel 等表格软件中查看和分析</li>
              <li>• 建议定期导出数据备份，防止数据丢失</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
