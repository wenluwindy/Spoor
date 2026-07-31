import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Film } from 'lucide-react';
import type { NodeContentProps } from './types';
import { resolveNodeMediaSrc } from '../../utils/mediaUrl';
import { MissingMediaPlaceholder } from './MissingMediaPlaceholder';
import { NodeTypeLabel } from './NodeTypeLabel';

export function VideoNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  const src = resolveNodeMediaSrc(node);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className="w-full h-full bg-app-surface-raised p-2 shadow-lg border-2 border-app-border flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <NodeTypeLabel icon={Film} label={t('nodes.video_label')} className="px-1 pb-1.5" />
      <div className="w-full bg-[#1a1a1a] rounded flex items-center justify-center border border-dashed border-app-edge overflow-hidden flex-1">
        {!src || failed ? (
          <MissingMediaPlaceholder fileName={node.fileName ?? node.description} />
        ) : (
          // 进度条能拖动靠 spoor-media 协议的 Range 支持，见 src-tauri/src/media.rs
          <video
            className="w-full h-full object-cover pointer-events-auto"
            controls
            src={src}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
