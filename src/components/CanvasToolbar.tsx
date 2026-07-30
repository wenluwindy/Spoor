import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wand2,
  ZoomIn,
  Maximize,
  Paperclip,
  Image as ImageIcon,
  FileText as FileTextIcon,
  X,
  Loader2,
} from 'lucide-react';
import { IntentClarificationModal } from './IntentClarificationModal';
import { Tooltip } from './ui/Tooltip';
import {
  TOOLBAR_ATTACHMENT_ACCEPT,
  type ToolbarAttachment,
} from '../constants/toolbarAttachments';

export interface CanvasToolbarProps {
  isToolbarAiLoading: boolean;
  isInputDisabled: boolean;
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  handleAiSubmit: () => void;
  canvasTransform: { x: number; y: number; scale: number };
  setCanvasTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  /** 缩放至适应全部内容（右下角按钮）。 */
  onZoomToFit: () => void;
  /** 输入栏附件：喂给这一次提问的 AI，不落画布。 */
  attachments: ToolbarAttachment[];
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  intentClarification: {
    original: string;
    options: [string, string, string];
    hint?: string;
  } | null;
  isIntentSubmitting: boolean;
  onCancelIntentClarification: () => void;
  onConfirmIntentClarification: (finalRequest: string) => void;
}

export function CanvasToolbar({
  isToolbarAiLoading,
  isInputDisabled,
  aiPrompt,
  setAiPrompt,
  handleAiSubmit,
  canvasTransform,
  setCanvasTransform,
  onZoomToFit,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  intentClarification,
  isIntentSubmitting,
  onCancelIntentClarification,
  onConfirmIntentClarification,
}: CanvasToolbarProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* AI Prompt Bar */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40 flex flex-col">
        <IntentClarificationModal
          open={intentClarification !== null}
          original={intentClarification?.original ?? ''}
          options={intentClarification?.options ?? ['', '', '']}
          hint={intentClarification?.hint}
          isSubmitting={isIntentSubmitting}
          onCancel={onCancelIntentClarification}
          onConfirm={onConfirmIntentClarification}
        />
        <div className={`bg-white rounded-2xl shadow-2xl border border-[#E6E4DF] p-2 ring-4 ring-[#F4F1ED]/50 transition-all ${isToolbarAiLoading ? 'opacity-80' : ''}`}>
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 px-2 pt-1 pb-2 border-b border-[#F4F1ED] mb-1">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-1.5 max-w-[14rem] bg-[#F4F1ED] border border-[#E6E4DF] rounded-lg pl-2 pr-1 py-1"
                >
                  {attachment.kind === 'image' ? (
                    <ImageIcon className="w-3 h-3 text-[#C2410C] shrink-0" />
                  ) : (
                    <FileTextIcon className="w-3 h-3 text-[#5a5a54] shrink-0" />
                  )}
                  <span className="text-[11px] font-sans text-[#1a1a1a] truncate">{attachment.name}</span>
                  <Tooltip label={t('canvas.remove_attachment')}>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(attachment.id)}
                      className="p-0.5 text-[#8c8a84] hover:text-[#C2410C] transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center space-x-2">
            <Tooltip label={t('canvas.attach_file')}>
              <label className="w-9 h-9 ml-1 flex items-center justify-center text-[#5a5a54] hover:text-[#1a1a1a] hover:bg-[#F4F1ED] rounded-lg cursor-pointer transition-colors m-0 shrink-0">
                <Paperclip className="w-4 h-4" />
                <input
                  type="file"
                  multiple
                  accept={TOOLBAR_ATTACHMENT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) onAddAttachments(files);
                    // 同一个文件连选两次也要能触发 change
                    e.target.value = '';
                  }}
                />
              </label>
            </Tooltip>
            <input
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 font-sans text-sm py-3 text-[#1a1a1a] placeholder-[#8c8a84] disabled:opacity-50"
              placeholder={t('ai.input_placeholder')}
              type="text"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
              disabled={isInputDisabled}
            />
            <Tooltip label={t('ai.submit')}>
              <button
                onClick={handleAiSubmit}
                disabled={isInputDisabled}
                className="bg-[#C2410C] text-white p-2.5 rounded-xl font-sans text-sm font-bold shadow-md flex items-center justify-center hover:bg-[#a0350a] transition-colors disabled:opacity-75 shrink-0"
              >
                {isToolbarAiLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-8 right-6 flex items-center bg-white/80 backdrop-blur-sm border border-[#E6E4DF] rounded-md px-3 py-1.5 shadow-sm font-sans text-[10px] font-bold text-[#8c8a84] space-x-3 z-40">
        <button
          className="hover:text-[#1a1a1a] transition-colors"
          onClick={() => setCanvasTransform(p => ({ ...p, scale: Math.max(0.1, p.scale / 1.1) }))}
        >{t('canvas.zoom')} -</button>
        <span className="flex items-center gap-1 w-12 justify-center"><ZoomIn className="w-3 h-3" /> {Math.round(canvasTransform.scale * 100)}%</span>
        <button
          className="hover:text-[#1a1a1a] transition-colors"
          onClick={() => setCanvasTransform(p => ({ ...p, scale: Math.min(5, p.scale * 1.1) }))}
        >{t('canvas.zoom')} +</button>
        <span className="h-3 w-[1px] bg-[#E6E4DF]" />
        <Tooltip label={t('canvas.zoom_to_fit')}>
          <button
            type="button"
            onClick={onZoomToFit}
            className="flex items-center justify-center text-[#8c8a84] hover:text-[#C2410C] transition-colors"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
    </>
  );
}
