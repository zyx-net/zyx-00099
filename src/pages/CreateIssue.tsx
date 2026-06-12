import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { TemplateField, IssuePriority } from '@/types';
import { generateIssueNumber, validateRequiredFields } from '@/services/syncService';
import { PriorityBadge } from '@/components/StatusBadge';
import {
  ArrowLeft, Save, Send, RefreshCw, Image, Upload, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CreateIssue() {
  const navigate = useNavigate();
  const { stores, templates, currentUser, createIssue, addToast, issues } = useAppStore();

  const [storeId, setStoreId] = useState(stores[0]?.id || '');
  const [templateId, setTemplateId] = useState(templates[0]?.id || '');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [issueId, setIssueId] = useState('');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [images, setImages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const selectedTemplate = templates.find(t => t.id === templateId);

  useEffect(() => {
    if (storeId) {
      setIssueId(generateIssueNumber(storeId));
    }
  }, [storeId]);

  useEffect(() => {
    if (selectedTemplate) {
      const initialData: Record<string, any> = {};
      selectedTemplate.fields.forEach(field => {
        if (field.type === 'select' && field.options) {
          initialData[field.key] = field.options[0];
        } else {
          initialData[field.key] = '';
        }
      });
      setFormData(initialData);
    }
  }, [selectedTemplate]);

  const regenerateId = () => {
    const newId = generateIssueNumber(storeId);
    if (issues.some(i => i.id === newId)) {
      regenerateId();
    } else {
      setIssueId(newId);
      addToast('info', '已重新生成问题编号');
    }
  };

  const handleImageUpload = () => {
    const placeholderImages = [
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=retail%20store%20inspection%20shelf%20display&image_size=square',
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=store%20cleanliness%20inspection&image_size=square',
      'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=product%20display%20arrangement&image_size=square'
    ];
    const randomImage = placeholderImages[Math.floor(Math.random() * placeholderImages.length)];
    setImages([...images, randomImage]);
    addToast('success', '已添加模拟图片');
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const validate = (): boolean => {
    const newErrors: string[] = [];

    if (!title.trim()) newErrors.push('请输入问题标题');
    if (!storeId) newErrors.push('请选择门店');
    if (!templateId) newErrors.push('请选择检查模板');
    if (issues.some(i => i.id === issueId)) newErrors.push('问题编号已存在，请重新生成');

    if (selectedTemplate) {
      const requiredKeys = selectedTemplate.fields.filter(f => f.required).map(f => f.key);
      const validation = validateRequiredFields(formData, requiredKeys);
      if (!validation.valid) {
        newErrors.push(`缺少必填项: ${validation.missing.join(', ')}`);
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSave = async (asDraft: boolean) => {
    if (!validate()) return;
    if (!currentUser) return;

    const result = await createIssue({
      id: issueId,
      title: title.trim(),
      storeId,
      templateId,
      creatorId: currentUser.id,
      status: asDraft ? 'draft' : 'submitted',
      data: formData,
      images,
      priority
    });

    if (result.success) {
      navigate('/issues');
    } else if (result.error) {
      addToast('error', result.error);
    }
  };

  const renderField = (field: TemplateField) => {
    const baseInputClass = cn(
      'w-full px-4 py-2.5 border rounded-lg transition-colors',
      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
      field.required && !formData[field.key] && errors.length > 0
        ? 'border-red-300 bg-red-50 animate-shake'
        : 'border-gray-200'
    );

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={formData[field.key] || ''}
            onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
            placeholder={`请输入${field.label}`}
            className={baseInputClass}
          />
        );
      case 'textarea':
        return (
          <textarea
            value={formData[field.key] || ''}
            onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
            placeholder={`请输入${field.label}`}
            rows={4}
            className={baseInputClass + ' resize-none'}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            value={formData[field.key] || ''}
            onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
            placeholder={`请输入${field.label}`}
            className={baseInputClass}
          />
        );
      case 'select':
        return (
          <select
            value={formData[field.key] || ''}
            onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
            className={baseInputClass + ' bg-white'}
          >
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      case 'image':
        return (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleImageUpload}
              className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <Upload size={18} className="text-gray-400" />
              <span className="text-sm text-gray-600">添加图片</span>
            </button>
            {formData[field.key] && (
              <span className="text-sm text-green-600">已上传</span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  if (stores.length === 0 || templates.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate('/issues')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
        >
          <ArrowLeft size={20} />
          返回列表
        </button>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <AlertCircle size={48} className="mx-auto text-yellow-500 mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">无法创建问题</h3>
          <p className="text-gray-500 mb-4">
            请先由督导导入门店清单和检查模板
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/issues')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <ArrowLeft size={20} />
          返回列表
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleSave(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Save size={18} />
            保存草稿
          </button>
          <button
            onClick={() => handleSave(false)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2d4a6f] transition-colors"
          >
            <Send size={18} />
            提交问题
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h4 className="font-medium text-red-800 mb-1">请修正以下错误</h4>
              <ul className="text-sm text-red-600 space-y-1">
                {errors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              问题编号
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={issueId}
                readOnly
                className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 font-mono text-sm"
              />
              <button
                onClick={regenerateId}
                className="px-3 py-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                title="重新生成编号"
              >
                <RefreshCw size={18} className="text-gray-500" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              优先级
            </label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as IssuePriority[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    'flex-1 px-3 py-2.5 rounded-lg border-2 transition-all',
                    priority === p
                      ? 'border-[#1e3a5f] bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <PriorityBadge priority={p} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            问题标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="请简要描述问题"
            className={cn(
              'w-full px-4 py-2.5 border rounded-lg transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              !title && errors.length > 0
                ? 'border-red-300 bg-red-50 animate-shake'
                : 'border-gray-200'
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              门店 <span className="text-red-500">*</span>
            </label>
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              {stores.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              检查模板 <span className="text-red-500">*</span>
            </label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedTemplate && (
          <div className="border-t pt-6">
            <h4 className="font-medium text-gray-800 mb-4">{selectedTemplate.name} - 检查项</h4>
            <div className="space-y-4">
              {selectedTemplate.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t pt-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            <Image size={16} className="inline mr-2" />
            现场图片
          </label>
          <div className="flex flex-wrap gap-3">
            {images.map((img, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={img}
                  alt={`图片 ${idx + 1}`}
                  className="w-24 h-24 object-cover rounded-lg"
                />
                <button
                  onClick={() => removeImage(idx)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={handleImageUpload}
              className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <Image size={24} className="text-gray-400" />
              <span className="text-xs text-gray-500">添加图片</span>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">点击添加模拟现场图片</p>
        </div>
      </div>
    </div>
  );
}
