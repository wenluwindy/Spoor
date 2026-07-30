import React, { useEffect, useState } from 'react';
import type { NodeContentProps } from './types';
import { resolveNodeMediaSrc } from '../../utils/mediaUrl';
import { MissingMediaPlaceholder } from './MissingMediaPlaceholder';

export function VideoNode({ node }: NodeContentProps) {
  const src = resolveNodeMediaSrc(node);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="w-full bg-[#1a1a1a] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1">
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
