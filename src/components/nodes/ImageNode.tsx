import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeContentProps } from './types';
import { resolveNodeMediaSrc } from '../../utils/mediaUrl';
import { MissingMediaPlaceholder } from './MissingMediaPlaceholder';

export function ImageNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  const src = resolveNodeMediaSrc(node);
  const [failed, setFailed] = useState(false);

  // 换了源要重新给一次机会，否则重新导入同一节点会一直卡在占位上
  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="w-full bg-[#EAE7E2] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden pointer-events-none flex-1">
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
    </div>
  );
}
