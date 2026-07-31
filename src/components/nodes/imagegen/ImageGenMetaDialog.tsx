import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, X } from 'lucide-react';
import type { CanvasNode } from '../../../db';
import { mediaUrl } from '../../../utils/mediaUrl';
import { saveMediaAs } from '../../../utils/saveMediaAs';
import { isTauriRuntime } from '../../../utils/isTauriRuntime';
import { Tooltip } from '../../ui/Tooltip';

/**
 * 结果卡片的「查看」弹窗：这一张图是怎么来的。
 *
 * 用居中弹窗而非卡片内展开——提示词往往很长、来源图可能有好几张，
 * 塞进卡片会被卡片尺寸绑架。
 */
export function ImageGenMetaDialog({
  node,
  onClose,
}: {
  node: CanvasNode;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const meta = node.imageGenMeta;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!meta) return null;

  const stamp = new Date(meta.createdAt).toLocaleString(
    i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US',
  );

  const rows: { label: string; value: string }[] = [
    { label: t('imagegen.meta_provider'), value: meta.providerName },
    { label: t('imagegen.meta_model'), value: meta.modelName },
    ...(meta.size ? [{ label: t('imagegen.meta_size'), value: meta.size }] : []),
    { label: t('imagegen.meta_created'), value: stamp },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface-raised shadow-xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-app-surface-subtle px-5 py-3">
          <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-app-text-faint">
            {t('imagegen.meta_title')}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {node.filePath && isTauriRuntime() && (
              <Tooltip label={t('canvas.menu.save_as')}>
                <button
                  type="button"
                  onClick={() => void saveMediaAs(node.filePath!)}
                  className="rounded-full p-1.5 text-app-text-faint transition-colors hover:bg-app-surface-subtle hover:text-app-accent"
                >
                  <Download className="h-4 w-4" />
                </button>
              </Tooltip>
            )}
            <Tooltip label={t('imagegen.meta_close')}>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-app-text-faint transition-colors hover:bg-app-surface-subtle hover:text-app-text"
              >
                <X className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {node.filePath && (
            <div className="flex max-h-[45vh] items-center justify-center bg-app-surface-subtle">
              <img
                alt={t('imagegen.result_alt')}
                className="max-h-[45vh] w-auto object-contain"
                src={mediaUrl(node.filePath)}
              />
            </div>
          )}

          <div className="space-y-4 px-5 py-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-app-text-faint">
                  {t('imagegen.meta_prompt')}
                </span>
                <Tooltip label={t('imagegen.meta_copy_prompt')}>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(meta.prompt);
                      setCopied(true);
                    }}
                    className="rounded p-1 text-app-text-faint transition-colors hover:text-app-accent"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </Tooltip>
              </div>
              <p className="whitespace-pre-wrap rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs leading-relaxed text-app-text-muted">
                {meta.prompt}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              {rows.map((row) => (
                <div key={row.label} className="flex min-w-0 flex-col">
                  <dt className="text-[10px] font-sans font-bold uppercase tracking-wider text-app-text-faint">
                    {row.label}
                  </dt>
                  <dd className="truncate text-xs text-app-text-muted" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            {meta.refPaths.length > 0 && (
              <div>
                <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-app-text-faint">
                  {t('imagegen.meta_refs')}
                </span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {meta.refPaths.map((ref, i) => (
                    <img
                      key={`${ref}-${i}`}
                      alt=""
                      className="h-16 w-16 rounded border border-app-border object-cover"
                      src={ref.startsWith('data:') ? ref : mediaUrl(ref)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
