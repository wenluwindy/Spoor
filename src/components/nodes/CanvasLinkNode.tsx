import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Layers } from 'lucide-react';
import type { Canvas } from '../../db';
import type { NodeContentProps } from './types';
import { NodeTypeLabel } from './NodeTypeLabel';

export interface CanvasLinkNodeProps extends NodeContentProps {
  canvases: Canvas[];
  /** 目标画布上有多少张卡片，用来给「那边有东西」一个直观量感。 */
  targetNodeCount?: number;
  onOpen?: (canvasId: string) => void;
}

/**
 * 跨画布传送门。
 *
 * 多画布用久了最耗时的一件事是「那个东西在哪张画布」。这张卡片把答案钉在画布上：
 * 顺着它走过去，而不是每次都去左上角的历史列表里翻。
 *
 * 目标画布被删掉时**不删这张卡**，改显示「目标已不存在」。删掉它等于把"这里原本
 * 连去别处"这条信息也一起抹掉，而那往往正是你想追查的东西。
 */
export function CanvasLinkNode({ node, canvases, targetNodeCount, onOpen }: CanvasLinkNodeProps) {
  const { t } = useTranslation();
  const target = canvases.find((c) => c.id === node.targetCanvasId);

  return (
    <div
      className="w-full h-full p-5 bg-app-surface-raised border border-app-border rounded-lg shadow-md flex flex-col gap-3 transition-all hover:border-app-accent"
      onDoubleClick={() => {
        if (target && onOpen) onOpen(target.id);
      }}
    >
      <NodeTypeLabel icon={Layers} label={t('nodes.canvas_link_label')} />

      {target ? (
        <>
          <p className="font-serif text-lg font-bold text-app-text leading-snug break-words">
            {target.name}
          </p>
          {targetNodeCount !== undefined && (
            <p className="text-[11px] text-app-text-faint font-sans">
              {t('nodes.canvas_link_count', { count: targetNodeCount })}
            </p>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onOpen?.(target.id)}
            className="mt-auto self-start flex items-center gap-1.5 text-[11px] font-sans font-bold text-app-accent hover:underline"
          >
            {t('nodes.canvas_link_open')}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <p className="text-[11px] text-app-text-faint font-sans leading-relaxed">
          {t('nodes.canvas_link_missing')}
        </p>
      )}
    </div>
  );
}
