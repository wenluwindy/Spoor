import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Sparkles } from 'lucide-react';
import Markdown from 'react-markdown';
import { canvasIdOf, updateNodeRecorded } from '../../services/canvasMutations';
import type { AiNodeProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import { NodeTypeLabel } from './NodeTypeLabel';

export function AiNode({
  node,
  editingNodeId,
  setEditingNodeId,
  onSubmitFollowUp,
  isFollowUpLoading,
  isFollowUpDisabled,
  isContentStreaming,
}: AiNodeProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const followUpTaRef = useRef<HTMLTextAreaElement>(null);

  const showFollowUp = onSubmitFollowUp && !node.followUpSent;

  useLayoutEffect(() => {
    const el = followUpTaRef.current;
    if (!el || !showFollowUp) return;
    el.style.height = 'auto';
    const cap = 160;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), cap)}px`;
  }, [draft, showFollowUp]);

  const handleSubmit = () => {
    const msg = draft.trim();
    if (!msg || !onSubmitFollowUp || isFollowUpDisabled) return;
    onSubmitFollowUp(msg);
    setDraft('');
  };

  const renderAiBody = () =>
    editingNodeId === node.id ? (
      <div
        autoFocus
        className="whitespace-pre-wrap text-sm text-app-text-soft font-serif leading-relaxed focus:outline-none bg-app-surface-sunken/50 rounded px-1 -mx-1 transition-colors cursor-text min-h-[40px]"
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => {
          if (!isContentBlurPersistenceDisabled()) {
            void updateNodeRecorded(canvasIdOf(node), node.id, { content: e.currentTarget.innerText });
          }
          setEditingNodeId(null);
        }}
      >
        {node.content}
      </div>
    ) : isContentStreaming ? (
      <div className="whitespace-pre-wrap text-sm text-app-text-soft font-serif leading-relaxed min-h-[40px]">
        {node.content || (
          <span className="text-app-text-faint italic">{t('nodes.ai_streaming')}</span>
        )}
      </div>
    ) : (
      <div
        onClick={() => setEditingNodeId(node.id)}
        className="markdown-body text-sm text-app-text-soft font-serif leading-relaxed cursor-text min-h-[40px]"
      >
        <Markdown>{node.content}</Markdown>
      </div>
    );

  return (
    <div className="w-full h-full bg-app-surface-subtle p-6 shadow-lg border border-app-border flex flex-col">
      <NodeTypeLabel icon={Sparkles} label={t('nodes.ai_label')} className="mb-3" />
      <div className="flex min-h-0 flex-1 flex-col" {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}>
      {node.userTurn ? (
        <>
          <div className="mb-3 shrink-0">
            <div className="text-sm text-app-text font-serif leading-relaxed border-l-2 border-app-accent/35 pl-3 py-0.5 bg-app-surface-raised/50 rounded-r">
              {node.userTurn}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-hide">
            {renderAiBody()}
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-hide">
            {renderAiBody()}
          </div>
        </>
      )}
      </div>

      {showFollowUp ? (
        <div className="mt-2 shrink-0">
          {/* 追问输入框是控件不是内容：导出成图时把它滤掉（见 canvasImageExport） */}
          <div className="relative" data-export-hide="">
            <textarea
              ref={followUpTaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={!!isFollowUpDisabled}
              placeholder={t('nodes.ai_follow_up_placeholder')}
              rows={1}
              className="w-full resize-none overflow-y-auto scrollbar-hide rounded-lg border border-app-border/90 bg-app-surface-raised/80 pl-3 pr-10 py-1.5 text-xs leading-snug text-app-text placeholder:text-app-text-dim focus:outline-none focus:ring-1 focus:ring-app-accent/30 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSubmit}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!!isFollowUpDisabled || !draft.trim()}
              title={t('nodes.ai_follow_up_send')}
              aria-label={t('nodes.ai_follow_up_send')}
              className="absolute bottom-1 right-1.5 flex items-center justify-center rounded-md p-1 text-app-accent transition-colors hover:bg-app-surface-sunken/80 hover:text-app-accent-hover disabled:pointer-events-none disabled:opacity-40"
            >
              {isFollowUpLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
