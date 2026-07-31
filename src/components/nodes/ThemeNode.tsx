import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { db } from '../../db';
import type { NodeContentProps } from './types';
import { isContentBlurPersistenceDisabled } from '../../config/persistence';
import { useAppTheme } from '../../hooks/useAppTheme';
import { CANVAS_NODE_CONTEXT_TEXT_ATTR } from '../../utils/canvasNodeContextText';

type ThemeEditableTag = 'h3' | 'p' | 'span';

interface ThemeEditableFieldProps {
  as: ThemeEditableTag;
  nodeId: string;
  displayValue: string;
  className: string;
  onPersist: (raw: string) => void;
}

/** 聚焦时不从 props 回写 DOM，避免 useLiveQuery 刷新导致光标乱跳、输入法中断 */
function ThemeEditableField({ as: Tag, nodeId, displayValue, className, onPersist }: ThemeEditableFieldProps) {
  const elRef = useRef<HTMLElement | null>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el || isFocusedRef.current) return;
    if (el.innerText !== displayValue) {
      el.textContent = displayValue;
    }
  }, [displayValue, nodeId]);

  return (
    <Tag
      ref={(el) => {
        elRef.current = el;
      }}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={(e) => {
        isFocusedRef.current = false;
        onPersist(e.currentTarget.innerText);
      }}
    />
  );
}

export function ThemeNode({ node, editingNodeId }: NodeContentProps) {
  const { t } = useTranslation();
  /** 外壳形态由全局主题决定，不再读 `layout`（与 `NoteNode` 一致）。 */
  const { themeLayout: layout } = useAppTheme();

  const defaultThemeFooter =
    layout === 3 ? t('nodes.theme_footer_latent') : t('nodes.theme_footer_encoding');
  const themeFooterDisplay =
    node.themeTag !== undefined && node.themeTag.trim() !== '' ? node.themeTag : defaultThemeFooter;
  const descriptionDisplay = node.description || t('nodes.theme_default_desc');

  const persistField = (field: 'content' | 'description' | 'themeTag') => (raw: string) => {
    if (isContentBlurPersistenceDisabled()) return;
    const patch =
      field === 'themeTag'
        ? { themeTag: raw.replace(/\s+/g, ' ').trim() }
        : { [field]: raw };
    void db.nodes.update(node.id, patch);
  };

  return (
    <div
      className={`w-full h-full shadow-xl border-2 transition-all duration-500 flex flex-col ${
        layout === 1 ? 'p-8 border-l-4 border-app-accent bg-app-surface-raised border-app-border' :
        layout === 2 ? 'p-10 bg-app-inverse text-app-on-inverse border-app-inverse-hover shadow-2xl' :
        layout === 3 ? 'p-6 border-2 border-black bg-app-surface-raised' :
        'p-6 bg-app-surface-raised border-app-border'
      }`}
      style={{ outline: '1px solid transparent' }}
    >
      <div className={`flex items-center space-x-2 mb-3 ${layout === 3 ? 'hidden' : ''}`}>
        <Sparkles className={`w-3 h-3 ${layout === 2 ? 'text-app-accent' : 'text-app-accent'}`} />
        <span className={`text-[10px] font-sans font-bold uppercase tracking-widest ${layout === 2 ? 'text-app-text-faint' : 'text-app-accent'}`}>{t('nodes.theme')}</span>
        <div className={`h-px flex-1 ${layout === 2 ? 'bg-app-surface-raised/10' : 'bg-app-surface-subtle'}`}></div>
      </div>

      {layout === 3 && (
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-black mb-6 flex justify-between items-center">
          <span>Manifesto // 01</span>
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-black rounded-full"></div>
            <div className="w-1.5 h-1.5 bg-app-accent rounded-full"></div>
          </div>
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto min-h-0 pr-2 custom-scrollbar ${editingNodeId === node.id ? 'select-text' : ''}`}
        {...{ [CANVAS_NODE_CONTEXT_TEXT_ATTR]: '' }}
      >
        <ThemeEditableField
          as="h3"
          nodeId={node.id}
          displayValue={node.content ?? ''}
          className={`font-bold leading-tight focus:outline-none rounded px-1 -mx-1 transition-all cursor-text ${
            layout === 1 ? 'text-3xl font-serif mb-4' :
            layout === 2 ? 'text-4xl tracking-tighter mb-4' :
            layout === 3 ? 'text-xl font-mono uppercase mb-4' :
            'text-2xl text-app-text mb-2'
          }`}
          onPersist={persistField('content')}
        />

        <ThemeEditableField
          as="p"
          nodeId={node.id}
          displayValue={descriptionDisplay}
          className={`focus:outline-none rounded px-1 -mx-1 transition-all cursor-text ${
            layout === 1 ? 'text-base font-serif leading-relaxed italic text-app-text-muted' :
            layout === 2 ? 'text-sm font-sans opacity-60 leading-relaxed' :
            layout === 3 ? 'text-xs font-mono leading-5 bg-app-surface-subtle p-4 text-app-text border-l-2 border-black' :
            'text-sm font-serif leading-relaxed text-app-text-soft'
          }`}
          onPersist={persistField('description')}
        />
      </div>

      <div className={`mt-6 pt-4 flex justify-start items-center ${layout === 2 ? 'text-white/30 border-t border-white/10' : 'text-app-text-faint border-t border-app-surface-subtle'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 w-1 h-1 rounded-full ${layout === 2 ? 'bg-app-accent' : 'bg-app-accent'}`}></div>
          <ThemeEditableField
            as="span"
            nodeId={node.id}
            displayValue={themeFooterDisplay}
            className="text-[10px] font-sans font-medium uppercase tracking-widest focus:outline-none focus:ring-1 focus:ring-app-accent/40 rounded px-0.5 cursor-text truncate min-w-0"
            onPersist={persistField('themeTag')}
          />
        </div>
      </div>
    </div>
  );
}
