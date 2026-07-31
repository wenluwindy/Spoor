import React from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import type { NodeContentProps } from './types';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';

export function DocumentNode({ node }: NodeContentProps) {
  const { t } = useTranslation();
  return (
    <div
      className="w-full h-full bg-app-surface-raised p-5 shadow-lg border-2 border-app-border flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-app-accent" />
        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-app-text-faint">
          {t('nodes.document_label')}
        </span>
        {node.description && (
          <span className="text-[10px] font-mono text-app-text-muted ml-auto truncate max-w-[120px]" title={node.description}>
            {node.description}
          </span>
        )}
      </div>
      <div
        className="flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar text-sm font-serif leading-relaxed text-app-text-soft doc-content"
        {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
        dangerouslySetInnerHTML={{ __html: node.content || `<em>${t('nodes.empty_document_body')}</em>` }}
      />
    </div>
  );
}
