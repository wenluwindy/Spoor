import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_ASPECT_RATIOS,
  clampEdge,
  formatSize,
  matchesRatio,
  parseSize,
  sizeFromRatio,
} from '../../../utils/imageSize';

/** 下拉里代表「自定义」的哨兵值；服务商的预设尺寸不可能长这样。 */
const CUSTOM = '__custom__';

export interface ImageGenSizeFieldProps {
  /** 服务商预设尺寸；Gemini 与自定义服务商没有，此时只给宽高输入。 */
  sizeOptions?: string[];
  /** 模型的默认尺寸，未显式设置时按它显示。 */
  defaultSize?: string;
  value: string | undefined;
  onChange: (size: string) => void;
}

const NUM_FIELD =
  'w-[4.5rem] bg-app-surface border border-app-border rounded px-1.5 py-1 text-[11px] outline-none focus:border-app-accent transition-colors';

/**
 * 尺寸控件。
 *
 * 有预设时给下拉 +「自定义」；没有预设时直接给宽×高，并附几个常用比例作起点。
 * 之前这一栏只在模型带 `sizeOptions` 时才渲染，于是 Gemini 与自定义服务商
 * 压根没有调尺寸的入口——即便后端本来就接受任意尺寸。
 */
export function ImageGenSizeField({
  sizeOptions,
  defaultSize,
  value,
  onChange,
}: ImageGenSizeFieldProps) {
  const { t } = useTranslation();

  const hasPresets = Boolean(sizeOptions && sizeOptions.length > 0);
  // RightAPI 的预设是宽高比（`1:1`）而不是像素。那种服务商只认列表里的那几个值，
  // 「自定义」只能产出像素串，发过去是白发，所以这一档整个不给。
  const allowsCustomSize = (sizeOptions ?? []).some((size) => parseSize(size) !== null);
  const effective = value ?? defaultSize ?? (hasPresets ? sizeOptions![0] : DEFAULT_IMAGE_SIZE);
  const isPreset = hasPresets && sizeOptions!.includes(effective);
  const showDimensionInputs = hasPresets ? allowsCustomSize && !isPreset : true;
  const dims = parseSize(effective) ?? parseSize(DEFAULT_IMAGE_SIZE)!;

  const setDim = (patch: Partial<{ width: number; height: number }>) => {
    const next = { ...dims, ...patch };
    onChange(formatSize(clampEdge(next.width), clampEdge(next.height)));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-app-text-faint shrink-0">{t('imagegen.size')}</span>

      {hasPresets && (
        <select
          className="text-[11px] bg-app-surface border border-app-border rounded px-1.5 py-1 outline-none focus:border-app-accent"
          aria-label={t('imagegen.size')}
          value={isPreset ? effective : allowsCustomSize ? CUSTOM : sizeOptions![0]}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              // 从预设切到自定义时以当前值打底，避免输入框先闪一个不相干的尺寸
              onChange(formatSize(dims.width, dims.height));
              return;
            }
            onChange(e.target.value);
          }}
        >
          {sizeOptions!.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
          {allowsCustomSize && <option value={CUSTOM}>{t('imagegen.size_custom')}</option>}
        </select>
      )}

      {showDimensionInputs && (
        <>
          <input
            type="number"
            className={NUM_FIELD}
            aria-label={t('imagegen.size_width')}
            value={dims.width}
            min={64}
            max={4096}
            onChange={(e) => setDim({ width: Number(e.target.value) })}
          />
          <span className="text-[10px] text-app-text-faint">×</span>
          <input
            type="number"
            className={NUM_FIELD}
            aria-label={t('imagegen.size_height')}
            value={dims.height}
            min={64}
            max={4096}
            onChange={(e) => setDim({ height: Number(e.target.value) })}
          />
        </>
      )}

      {!hasPresets && (
        <div className="flex items-center gap-1">
          {IMAGE_ASPECT_RATIOS.map((ratio) => {
            const active = matchesRatio(dims, ratio.w, ratio.h);
            return (
              <button
                key={ratio.id}
                type="button"
                aria-label={t('imagegen.size_ratio', { ratio: ratio.id })}
                onClick={() => {
                  const next = sizeFromRatio(ratio.w, ratio.h, Math.max(dims.width, dims.height));
                  onChange(formatSize(next.width, next.height));
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  active
                    ? 'border-app-accent text-app-accent bg-app-accent/5'
                    : 'border-app-border text-app-text-faint hover:border-app-accent/40'
                }`}
              >
                {ratio.id}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
