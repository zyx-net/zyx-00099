import { useState, useRef } from 'react';
import { useAppStore } from '@/store';
import { Store, Template } from '@/types';
import { generateId } from '@/utils/helpers';
import {
  Upload, FileJson, Store as StoreIcon, FileText, CheckCircle, AlertCircle,
  Download, Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';

const sampleStores: Store[] = [
  { id: 'ST001', name: '朝阳路店', address: '北京市朝阳区朝阳路1号', manager: '张店长' },
  { id: 'ST002', name: '海淀区店', address: '北京市海淀区中关村大街2号', manager: '李店长' },
  { id: 'ST003', name: '西城区店', address: '北京市西城区金融街3号', manager: '王店长' },
];

const sampleTemplates: Template[] = [
  {
    id: 'TPL001',
    name: '环境卫生检查',
    version: '1.0',
    createdAt: new Date().toISOString(),
    fields: [
      { key: 'description', label: '问题描述', type: 'textarea', required: true },
      { key: 'location', label: '问题位置', type: 'select', required: true, options: ['入口', '收银台', '货架', '仓库', '洗手间', '其他'] },
      { key: 'severity', label: '严重程度', type: 'select', required: true, options: ['轻微', '一般', '严重'] },
      { key: 'expected', label: '整改要求', type: 'textarea', required: false },
    ]
  },
  {
    id: 'TPL002',
    name: '商品陈列检查',
    version: '1.0',
    createdAt: new Date().toISOString(),
    fields: [
      { key: 'description', label: '问题描述', type: 'textarea', required: true },
      { key: 'category', label: '商品类别', type: 'select', required: true, options: ['食品', '日用品', '家电', '服装', '其他'] },
      { key: 'shelfNumber', label: '货架编号', type: 'text', required: true },
      { key: 'quantity', label: '涉及数量', type: 'number', required: false },
    ]
  },
  {
    id: 'TPL003',
    name: '服务质量检查',
    version: '1.0',
    createdAt: new Date().toISOString(),
    fields: [
      { key: 'description', label: '问题描述', type: 'textarea', required: true },
      { key: 'staffName', label: '涉事员工', type: 'text', required: false },
      { key: 'customerImpact', label: '客户影响', type: 'select', required: true, options: ['无影响', '轻微不满', '投诉', '严重投诉'] },
      { key: 'suggestion', label: '改进建议', type: 'textarea', required: false },
    ]
  },
];

export default function ConfigImport() {
  const { stores, templates, importStores, importTemplates, addToast } = useAppStore();
  const [activeTab, setActiveTab] = useState<'stores' | 'templates'>('stores');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (activeTab === 'stores') {
          const storesData = Array.isArray(data) ? data : data.stores;
          if (!Array.isArray(storesData)) {
            throw new Error('门店数据格式不正确');
          }
          importStores(storesData);
        } else {
          const templatesData = Array.isArray(data) ? data : data.templates;
          if (!Array.isArray(templatesData)) {
            throw new Error('模板数据格式不正确');
          }
          importTemplates(templatesData);
        }
      } catch (err) {
        addToast('error', '文件解析失败，请检查 JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/json') {
      const input = document.createElement('input');
      input.type = 'file';
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleFileUpload({ target: input } as React.ChangeEvent<HTMLInputElement>);
    } else {
      addToast('error', '请上传 JSON 格式文件');
    }
  };

  const loadSampleData = () => {
    if (activeTab === 'stores') {
      importStores(sampleStores);
    } else {
      importTemplates(sampleTemplates);
    }
  };

  const downloadSample = () => {
    const data = activeTab === 'stores' ? sampleStores : sampleTemplates;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sample-${activeTab === 'stores' ? 'stores' : 'templates'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('stores')}
          className={cn(
            'flex items-center gap-2 px-6 py-3 font-medium border-b-2 transition-colors',
            activeTab === 'stores'
              ? 'border-[#1e3a5f] text-[#1e3a5f]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <StoreIcon size={18} />
          门店清单
          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{stores.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={cn(
            'flex items-center gap-2 px-6 py-3 font-medium border-b-2 transition-colors',
            activeTab === 'templates'
              ? 'border-[#1e3a5f] text-[#1e3a5f]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <FileText size={18} />
          检查模板
          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{templates.length}</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'bg-white rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer',
              dragOver
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload size={32} className="text-blue-600" />
            </div>
            <h3 className="font-medium text-gray-800 mb-2">
              上传 {activeTab === 'stores' ? '门店' : '模板'} 文件
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              点击或拖拽 JSON 文件到此处
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); loadSampleData(); }}
                className="w-full py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors text-sm"
              >
                加载示例数据
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); downloadSample(); }}
                className="w-full py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Download size={14} />
                下载模板
              </button>
            </div>
          </div>

          <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium mb-1">导入说明</p>
                <p className="text-yellow-700">
                  {activeTab === 'stores'
                    ? '门店数据需包含 id、name、address、manager 字段'
                    : '模板数据需包含 id、name、fields 数组，每个字段包含 key、label、type、required 属性'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="font-medium text-gray-800">
                已导入{activeTab === 'stores' ? '门店' : '模板'}
              </h3>
              {activeTab === 'stores' ? stores.length : templates.length} 条
            </div>

            {activeTab === 'stores' ? (
              stores.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <StoreIcon size={48} className="mx-auto mb-3 opacity-50" />
                  <p>暂无门店数据</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {stores.map(store => (
                    <div key={store.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                          <StoreIcon size={20} className="text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{store.name}</p>
                          <p className="text-sm text-gray-500">{store.address}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-700">{store.manager}</p>
                          <p className="text-xs text-gray-500 font-mono">{store.id}</p>
                        </div>
                        <CheckCircle size={18} className="text-green-500" />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              templates.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <FileText size={48} className="mx-auto mb-3 opacity-50" />
                  <p>暂无模板数据</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {templates.map(template => (
                    <div key={template.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                          <FileText size={20} className="text-purple-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{template.name}</p>
                          <p className="text-sm text-gray-500">
                            {template.fields.length} 个检查项 · 版本 v{template.version}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-gray-500 font-mono">{template.id}</p>
                          <div className="flex gap-1 mt-1">
                            {template.fields.slice(0, 3).map(field => (
                              <span key={field.key} className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                                {field.label}
                              </span>
                            ))}
                            {template.fields.length > 3 && (
                              <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                                +{template.fields.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                        <CheckCircle size={18} className="text-green-500" />
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
