import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Globe, Loader2, RefreshCw } from 'lucide-react';
import type { NodeContentProps } from './types';
import { NodeTypeLabel } from './NodeTypeLabel';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';
import { hostLabel } from '../../services/webPage';
import { openExternalUrl } from '../../utils/openExternal';

export interface WebNodeProps extends NodeContentProps {
  isFetching?: boolean;
  /** 重新抓一次（换了地址、或上次失败）。 */
  onFetch?: (url: string) => void;
}

/**
 * 网页卡片。
 *
 * 搜索结果原先只落成一张纯文本便签，来源就丢了。这张卡片留下地址、标题、站点与
 * 正文摘要——既看得出这段话是从哪来的，也让摘要进得了 AI 上下文
 * （靠 `CANVAS_NODE_CONTEXT_TEXT_ATTR` 标记那一段，与文档节点同一套机制）。
 *
 * 地址还没填时卡片本身就是输入框，不额外弹对话框：新建一张空卡然后就地把链接贴进去，
 * 比"先弹框问地址再建卡"少一次上下文切换。
 *
 * 封面图**不落盘**，直接引远程地址。一张缩略图不值得在本地存储里占一份，
 * 加载不出来时静默隐藏即可。
 */
export function WebNode({ node, isFetching, onFetch }: WebNodeProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(node.url ?? '');
  const [imageFailed, setImageFailed] = useState(false);

  const submit = () => {
    const next = draft.trim();
    if (next) onFetch?.(next);
  };

  if (!node.url) {
    return (
      <div className="w-full h-full p-5 bg-app-surface-raised border border-app-border rounded-lg shadow-md flex flex-col gap-3">
        <NodeTypeLabel icon={Globe} label={t('nodes.web_label')} />
        <input
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder={t('nodes.web_url_placeholder')}
          className="w-full bg-app-surface-sunken/50 border border-app-border rounded px-2 py-1.5 text-sm font-sans text-app-text focus:outline-none focus:border-app-accent"
        />
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={submit}
          disabled={isFetching || draft.trim() === ''}
          className="self-start flex items-center gap-1.5 text-[11px] font-sans font-bold text-app-accent hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {t('nodes.web_fetch')}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-app-surface-raised border border-app-border rounded-lg shadow-md flex flex-col overflow-hidden">
      {node.urlImage && !imageFailed && (
        <img
          src={node.urlImage}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="w-full h-28 object-cover border-b border-app-border shrink-0"
        />
      )}

      <div className="p-5 flex flex-col gap-2 min-h-0 flex-1">
        <NodeTypeLabel
          icon={Globe}
          label={t('nodes.web_label')}
          trailing={
            <span className="text-[10px] text-app-text-faint font-sans truncate">
              {node.urlSiteName || hostLabel(node.url)}
            </span>
          }
        />

        <p className="font-serif text-base font-bold text-app-text leading-snug break-words">
          {node.urlTitle || node.url}
        </p>

        {node.urlError ? (
          <p className="text-[11px] text-app-accent font-sans">{t('nodes.web_fetch_failed')}</p>
        ) : isFetching ? (
          <p className="text-[11px] text-app-text-faint font-sans flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('nodes.web_fetching')}
          </p>
        ) : (
          <div
            className="text-sm text-app-text-soft font-serif leading-relaxed overflow-y-auto min-h-0 custom-scrollbar"
            {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
          >
            {node.urlExcerpt}
          </div>
        )}

        <div className="mt-auto pt-2 flex items-center gap-3 shrink-0" data-export-hide="">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void openExternalUrl(node.url!)}
            className="flex items-center gap-1.5 text-[11px] font-sans font-bold text-app-accent hover:underline"
          >
            {t('nodes.web_open')}
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onFetch?.(node.url!)}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-[11px] font-sans text-app-text-faint hover:text-app-accent disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
            {t('nodes.web_refetch')}
          </button>
        </div>
      </div>
    </div>
  );
}
