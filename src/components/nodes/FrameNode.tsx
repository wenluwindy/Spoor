import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeContentProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { canvasIdOf, updateNodeRecorded } from '../../services/canvasMutations';

/**
 * 区域框：一个带标题的矩形，画在别的卡片后面（z 轴压到最低，见 App 的 `zIndexOverride`）。
 *
 * 它不装内容，只圈范围——框住谁是**看**出来的（见 `services/canvasFrame`），
 * 不存成员表。
 *
 * 整个框都是可拖的：拖它等于拖着框里的卡片一起走。代价是框内空白处按下会拖框而不是
 * 拉框选，这是有意的取舍——区域框在画布上就是一个对象，点它就该是在动它。
 * 需要框选时在框外起手。
 */
export function FrameNode({ node }: NodeContentProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full h-full rounded-xl border-2 border-dashed border-app-border bg-app-surface-subtle/30 relative">
      <div
        className="absolute -top-6 left-0 px-2 py-0.5 rounded-t-md bg-app-surface-raised border border-app-border text-[11px] font-sans font-bold text-app-text-muted cursor-text max-w-full truncate"
        contentEditable
        suppressContentEditableWarning
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          if (isContentBlurPersistenceDisabled()) return;
          void updateNodeRecorded(canvasIdOf(node), node.id, {
            content: e.currentTarget.innerText.replace(/\s+/g, ' ').trim(),
          });
        }}
      >
        {node.content || t('nodes.frame_untitled')}
      </div>
    </div>
  );
}
