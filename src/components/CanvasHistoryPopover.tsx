import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Edit3, FileText, History, ImageDown, Plus, Trash2, Upload } from 'lucide-react';
import { db } from '../db';
import type { Canvas } from '../db';
import { Tooltip } from './ui/Tooltip';
import { useAppDialog } from './AppDialogProvider';
import { deleteCanvasWithContents } from '../services/canvasRepository';
import {
  exportCanvasAsMarkdown,
  exportCanvasToFile,
  importCanvasFromFile,
} from '../services/canvasPortability';

export interface CanvasHistoryPopoverProps {
  canvases: Canvas[];
  activeCanvasId: string;
  setActiveCanvasId: (id: string) => void;
  /** 导出 PNG。实现在 App——它要摸画布 DOM 才能量出内容包围盒。 */
  onExportImage: () => void;
}

export function CanvasHistoryPopover({
  canvases,
  activeCanvasId,
  setActiveCanvasId,
  onExportImage,
}: CanvasHistoryPopoverProps) {
  const { t } = useTranslation();
  const { alert: appAlert, confirm } = useAppDialog();
  const [isOpen, setIsOpen] = useState(false);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingCanvasName, setEditingCanvasName] = useState('');
  /** 至少留一张画布：删光了应用就没有可显示的画布了。 */
  const isLastCanvas = canvases.length <= 1;

  const renameCanvas = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    await db.canvases.update(id, { name: newName, updatedAt: Date.now() });
    setEditingCanvasId(null);
  };

  const deleteCanvas = async (canvas: Canvas) => {
    if (isLastCanvas) return;
    const ok = await confirm({
      title: t('canvas.delete_canvas'),
      message: t('canvas.delete_canvas_confirm', { name: canvas.name }),
      confirmLabel: t('canvas.delete_canvas_ok'),
      variant: 'danger',
    });
    if (!ok) return;

    // 先挪走再删，避免中途停在一个已经不存在的画布上
    if (canvas.id === activeCanvasId) {
      const fallback = canvases.find((c) => c.id !== canvas.id);
      if (fallback) setActiveCanvasId(fallback.id);
    }
    await deleteCanvasWithContents(canvas.id);
  };

  const createNewCanvas = async () => {
    const id = crypto.randomUUID();
    await db.canvases.add({
      id,
      name: t('canvas.default_name', { number: canvases.length + 1 }),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    setActiveCanvasId(id);
    setIsOpen(false);
  };

  /** 导出当前画布为 `.canvas`（JSON Canvas，Obsidian 等工具能直接打开）。 */
  const exportActiveCanvas = async () => {
    const active = canvases.find((c) => c.id === activeCanvasId);
    setIsOpen(false);
    await exportCanvasToFile(activeCanvasId, active?.name ?? activeCanvasId);
  };

  /** 导出 Markdown 包：一篇正文 + 一个 assets/ 目录，用来把内容带去别处。 */
  const exportActiveCanvasAsMarkdown = async () => {
    const active = canvases.find((c) => c.id === activeCanvasId);
    setIsOpen(false);
    const outcome = await exportCanvasAsMarkdown(
      activeCanvasId,
      active?.name ?? activeCanvasId,
      new Date(),
    );
    if (!outcome) return;
    // 有图没能复制出来时说一声——安静少几张图，回头才发现是最难查的
    if (outcome.assetsMissing > 0) {
      await appAlert({ message: t('canvas.export_markdown_missing', { count: outcome.assetsMissing }) });
    }
  };

  /**
   * 导入 `.canvas`：落到一张新画布并切过去。
   *
   * 降级情况（链接节点、分组、认不出来的行）如实报出来——静默丢数据是最糟的做法。
   */
  const importCanvas = async () => {
    setIsOpen(false);
    try {
      const outcome = await importCanvasFromFile();
      if (!outcome) return;

      setActiveCanvasId(outcome.canvasId);

      const { links, groups, skipped } = outcome.degraded;
      const notes = [
        t('canvas.import_done', { count: outcome.nodeCount, name: outcome.canvasName }),
        links + groups + skipped > 0
          ? t('canvas.import_degraded', { links, groups, skipped })
          : '',
      ].filter(Boolean);
      await appAlert({ message: notes.join('\n\n') });
    } catch {
      await appAlert({ message: t('canvas.import_failed') });
    }
  };

  return (
    <div className="absolute top-6 left-6 flex items-center z-40 gap-2">
      <div className="relative">
        <Tooltip label={t('canvas.history')}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="bg-app-surface-raised text-app-text p-3 rounded-full shadow-md hover:bg-app-surface-subtle transition-all flex items-center justify-center border border-app-border group"
          >
            <History className="w-5 h-5 transition-transform group-hover:rotate-[-10deg]" />
          </button>
        </Tooltip>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-64 bg-app-surface-raised border border-app-border rounded-xl shadow-2xl p-1 z-50">
            <div className="px-3 py-2 text-[10px] font-bold text-app-text-faint uppercase tracking-wider font-mono border-b border-app-surface-subtle mb-1">{t('canvas.history')}</div>
            <div className="max-h-60 overflow-y-auto">
              {canvases.map(canvas => (
                <div 
                  key={canvas.id}
                  className={`group w-full text-left px-3 py-2 text-sm rounded-lg mb-1 transition-colors flex flex-col ${activeCanvasId === canvas.id ? 'bg-app-surface-subtle border border-app-border' : 'hover:bg-app-surface-subtle'}`}
                >
                  {editingCanvasId === canvas.id ? (
                    <form 
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameCanvas(canvas.id, editingCanvasName);
                      }}
                    >
                      <input
                        autoFocus
                        value={editingCanvasName}
                        onChange={(e) => setEditingCanvasName(e.target.value)}
                        onBlur={() => renameCanvas(canvas.id, editingCanvasName)}
                        className="flex-1 bg-app-surface-raised border border-app-accent px-2 py-0.5 rounded outline-none text-xs text-app-text"
                      />
                    </form>
                  ) : (
                    <div className="font-bold flex items-center justify-between">
                      <button 
                        onClick={() => {
                          setActiveCanvasId(canvas.id);
                          setIsOpen(false);
                        }}
                        className="flex-1 text-left truncate"
                      >
                        {canvas.name}
                      </button>
                      <div className="flex items-center gap-1">
                        <Tooltip label={t('canvas.rename')}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCanvasId(canvas.id);
                              setEditingCanvasName(canvas.name);
                            }}
                            className="p-1 hover:text-app-accent opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </Tooltip>
                        {/* 用 aria-disabled 而非 disabled：禁用的按钮收不到 hover 事件，
                            「为什么不能删」的提示就永远弹不出来 */}
                        <Tooltip label={isLastCanvas ? t('canvas.delete_canvas_last') : t('canvas.delete_canvas')}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteCanvas(canvas);
                            }}
                            aria-disabled={isLastCanvas}
                            className={`p-1 transition-opacity ${
                              isLastCanvas
                                ? 'cursor-not-allowed opacity-25 group-hover:opacity-25'
                                : 'opacity-0 group-hover:opacity-100 hover:text-app-accent'
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </Tooltip>
                        {activeCanvasId === canvas.id && <div className="w-1.5 h-1.5 rounded-full bg-app-accent ml-1" />}
                      </div>
                    </div>
                  )}
                  <div className="text-[10px] text-app-text-faint">{new Date(canvas.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="p-1 mt-1 border-t border-app-surface-subtle">
              <button
                onClick={createNewCanvas}
                className="w-full text-left px-3 py-2 text-sm text-app-accent font-bold hover:bg-app-surface-subtle rounded-lg flex items-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('canvas.new_canvas')}
              </button>
              <button
                onClick={() => void exportActiveCanvas()}
                className="w-full text-left px-3 py-2 text-sm text-app-text-muted hover:bg-app-surface-subtle hover:text-app-text rounded-lg flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                {t('canvas.export_json_canvas')}
              </button>
              <button
                onClick={() => void exportActiveCanvasAsMarkdown()}
                className="w-full text-left px-3 py-2 text-sm text-app-text-muted hover:bg-app-surface-subtle hover:text-app-text rounded-lg flex items-center gap-2 transition-colors"
              >
                <FileText className="w-4 h-4" />
                {t('canvas.export_markdown')}
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  onExportImage();
                }}
                className="w-full text-left px-3 py-2 text-sm text-app-text-muted hover:bg-app-surface-subtle hover:text-app-text rounded-lg flex items-center gap-2 transition-colors"
              >
                <ImageDown className="w-4 h-4" />
                {t('canvas.export_image')}
              </button>
              <button
                onClick={() => void importCanvas()}
                className="w-full text-left px-3 py-2 text-sm text-app-text-muted hover:bg-app-surface-subtle hover:text-app-text rounded-lg flex items-center gap-2 transition-colors"
              >
                <Upload className="w-4 h-4" />
                {t('canvas.import_json_canvas')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
