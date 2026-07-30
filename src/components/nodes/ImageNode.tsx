import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeContentProps } from './types';

export function ImageNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  return (
    <div 
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="w-full bg-[#EAE7E2] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden pointer-events-none flex-1">
        <img alt={t('nodes.image_alt')} className="w-full h-full object-cover shadow-inner pointer-events-none" src={node.content}/>
      </div>
    </div>
  );
}
