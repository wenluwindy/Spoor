import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Loader2, Pin, Send, Sparkles, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { db } from '../../db';
import { canvasIdOf, updateNodeRecorded } from '../../services/canvasMutations';
import { useAiStreamText } from '../../services/aiStreamStore';
import { Tooltip } from '../ui/Tooltip';
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
  /** 流式中间态在内存 store 里，不在库里（见 aiStreamStore）；没有流时回落到库中 content。 */
  const streamText = useAiStreamText(node.id);

  /**
   * 生成历史（aiTurns，v5 起）。每次生成/重生成落一条，重跑不再毁掉旧回答。
   * `viewTurnIndex === null` 表示显示当前内容；翻看历史只改本地视图，
   * 「固定」才写库（走可撤销写入）。删除单版历史与生图删结果一致：不入撤销栈。
   */
  const turns =
    useLiveQuery(
      () => db.aiTurns.where('nodeId').equals(node.id).sortBy('createdAt'),
      [node.id],
    ) ?? [];
  const [viewTurnIndex, setViewTurnIndex] = useState<number | null>(null);
  const viewingTurn =
    viewTurnIndex !== null && turns.length > 0
      ? turns[Math.min(viewTurnIndex, turns.length - 1)]
      : undefined;
  const showHistoryBar = turns.length >= 2 && !isContentStreaming && editingNodeId !== node.id;

  const stepHistory = (delta: number) => {
    if (turns.length === 0) return;
    const base = viewTurnIndex === null ? turns.length - 1 : Math.min(viewTurnIndex, turns.length - 1);
    const next = Math.max(0, Math.min(turns.length - 1, base + delta));
    // 走到最新一条等于回到"当前"视图
    setViewTurnIndex(next === turns.length - 1 && viewTurnIndex === null ? null : next);
  };

  const pinViewingTurn = () => {
    if (!viewingTurn) return;
    void updateNodeRecorded(canvasIdOf(node), node.id, { content: viewingTurn.content });
    setViewTurnIndex(null);
  };

  const deleteViewingTurn = () => {
    if (!viewingTurn) return;
    void db.aiTurns.delete(viewingTurn.id);
    setViewTurnIndex(null);
  };

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
        {streamText ?? node.content ?? (
          <span className="text-app-text-faint italic">{t('nodes.ai_streaming')}</span>
        )}
      </div>
    ) : viewingTurn ? (
      // 浏览历史版本：只读，点击不进编辑（编辑的是"当前"内容，不是历史）
      <div className="markdown-body text-sm text-app-text-soft font-serif leading-relaxed min-h-[40px] opacity-90">
        <Markdown>{viewingTurn.content}</Markdown>
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

      {showHistoryBar && (
        <div
          data-export-hide=""
          className="mt-2 flex shrink-0 items-center gap-1 text-[10px] font-sans text-app-text-faint"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Tooltip label={t('nodes.ai_history_prev')}>
            <button
              type="button"
              onClick={() => stepHistory(-1)}
              disabled={viewTurnIndex === 0}
              aria-label={t('nodes.ai_history_prev')}
              className="rounded p-0.5 text-app-text-muted transition-colors hover:text-app-accent disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <span className="tabular-nums">
            {viewingTurn
              ? `${Math.min(viewTurnIndex ?? 0, turns.length - 1) + 1}/${turns.length}`
              : t('nodes.ai_history_current', { count: turns.length })}
          </span>
          <Tooltip label={t('nodes.ai_history_next')}>
            <button
              type="button"
              onClick={() => stepHistory(1)}
              disabled={!viewingTurn}
              aria-label={t('nodes.ai_history_next')}
              className="rounded p-0.5 text-app-text-muted transition-colors hover:text-app-accent disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          {viewingTurn && (
            <>
              <Tooltip label={t('nodes.ai_history_pin')}>
                <button
                  type="button"
                  onClick={pinViewingTurn}
                  aria-label={t('nodes.ai_history_pin')}
                  className="ml-1 rounded p-0.5 text-app-text-muted transition-colors hover:text-app-accent"
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip label={t('nodes.ai_history_delete')}>
                <button
                  type="button"
                  onClick={deleteViewingTurn}
                  aria-label={t('nodes.ai_history_delete')}
                  className="rounded p-0.5 text-app-text-muted transition-colors hover:text-app-accent"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={() => setViewTurnIndex(null)}
                className="ml-auto rounded px-1 py-0.5 text-app-text-muted underline-offset-2 transition-colors hover:text-app-accent hover:underline"
              >
                {t('nodes.ai_history_back')}
              </button>
            </>
          )}
        </div>
      )}

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
