import React from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';

/**
 * 文件不在了的占位。
 *
 * 生图历史永久保留、用户又能在资产管理器里手动删文件，所以「节点还在、文件没了」
 * 是正常状态而不是异常。这里明确显示出来，而不是让 `<img>` 裂成一个破图标，
 * 也不是抛错白屏。
 */
export function MissingMediaPlaceholder({ fileName }: { fileName?: string }) {
  const { t } = useTranslation();
  return (
    <div className="w-full h-full min-h-[80px] flex flex-col items-center justify-center gap-1.5 bg-[#F4F1ED] text-[#8c8a84] px-3 py-4 text-center">
      <ImageOff className="w-5 h-5" />
      <span className="text-[11px] font-sans">{t('nodes.media_missing')}</span>
      {fileName && (
        <span className="text-[10px] font-mono truncate max-w-full" title={fileName}>
          {fileName}
        </span>
      )}
    </div>
  );
}
