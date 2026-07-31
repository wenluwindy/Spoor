import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 卡片顶部的类型徽章。
 *
 * 便签与主题卡本来就有各自的标题（它们的外壳随主题变形，标题排版也跟着变），
 * 这个组件服务于外壳固定的那几类：AI 卡、图片、视频、文档、角色。
 * 统一放一处是为了别再出现"有的卡有标题、有的没有"。
 */
export function NodeTypeLabel({
  icon: Icon,
  label,
  trailing,
  className = '',
}: {
  icon?: LucideIcon;
  label: string;
  /** 右侧附加信息（文件名、模型名等）。 */
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 shrink-0 ${className}`}>
      {Icon && <Icon className="w-3.5 h-3.5 text-app-accent shrink-0" aria-hidden />}
      <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-app-text-faint">
        {label}
      </span>
      {trailing}
    </div>
  );
}
