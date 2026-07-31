import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Info } from 'lucide-react';
import type { NodeContentProps } from './types';
import { resolveNodeMediaSrc } from '../../utils/mediaUrl';
import { MissingMediaPlaceholder } from './MissingMediaPlaceholder';
import { NodeTypeLabel } from './NodeTypeLabel';
import { ImageGenMetaDialog } from './imagegen/ImageGenMetaDialog';
import { Tooltip } from '../ui/Tooltip';

export function ImageNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  const src = resolveNodeMediaSrc(node);
  const [failed, setFailed] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  // 换了源要重新给一次机会，否则重新导入同一节点会一直卡在占位上
  useEffect(() => setFailed(false), [src]);

  /** 只有生图产出的结果卡片带 `imageGenMeta`，手动导入的图片没有「查看」入口。 */
  const isGenResult = Boolean(node.imageGenMeta);

  return (
    <div
      className="w-full h-full bg-app-surface-raised p-2 shadow-lg border-2 border-app-border flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <NodeTypeLabel
        icon={ImageIcon}
        label={isGenResult ? t('nodes.image_result_label') : t('nodes.image_label')}
        className="px-1 pb-1.5"
        trailing={
          isGenResult ? (
            <Tooltip label={t('imagegen.meta_view')}>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setMetaOpen(true)}
                className="ml-auto rounded p-0.5 text-app-text-faint transition-colors hover:text-app-accent"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          ) : undefined
        }
      />
      <div className="w-full bg-app-surface-sunken rounded flex items-center justify-center border border-dashed border-app-edge overflow-hidden pointer-events-none flex-1">
        {!src || failed ? (
          <MissingMediaPlaceholder fileName={node.fileName ?? node.description} />
        ) : (
          <img
            alt={t('nodes.image_alt')}
            className="w-full h-full object-cover shadow-inner pointer-events-none"
            src={src}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      {metaOpen && <ImageGenMetaDialog node={node} onClose={() => setMetaOpen(false)} />}
    </div>
  );
}
