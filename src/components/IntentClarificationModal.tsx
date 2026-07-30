import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { buildIntentClarifiedRequest } from '../utils/buildIntentClarifiedRequest';

export interface IntentClarificationModalProps {
  open: boolean;
  original: string;
  options: [string, string, string];
  hint?: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (finalRequest: string) => void;
}

export function IntentClarificationModal({
  open,
  original,
  options,
  hint,
  isSubmitting,
  onCancel,
  onConfirm,
}: IntentClarificationModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number[]>([]);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extra, setExtra] = useState('');

  useEffect(() => {
    if (open) {
      setSelected([]);
      setExtra('');
      setExtraOpen(false);
    }
  }, [open, original]);

  const toggle = (index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b),
    );
  };

  const submitSelected = () => {
    if (selected.length === 0) return;
    const picked = selected.map((i) => options[i]);
    const merged = buildIntentClarifiedRequest(original, picked, extra, {
      selectedIntro: t('ai.intent.selected_intro'),
      extraSection: t('ai.intent.extra_section'),
    });
    onConfirm(merged);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onCancel();
      if (e.key === 'Enter' && selected.length > 0 && !isSubmitting) {
        e.preventDefault();
        submitSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selected, isSubmitting, extra, options, original, onCancel, onConfirm, t]);

  if (!open) return null;

  const canConfirm = selected.length > 0 && !isSubmitting;

  return (
    <div
      role="region"
      aria-labelledby="intent-clarify-title"
      className="mb-1.5 w-full animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out"
    >
      <div className="intent-clarify-glass relative isolate overflow-hidden rounded-2xl [transform:translateZ(0)]">
        <div className="intent-clarify-glass-wash pointer-events-none absolute inset-0" aria-hidden />
        <div
          className="intent-clarify-glass-hotspot pointer-events-none absolute inset-0"
          aria-hidden
        />

        <div className="relative z-10">
          <div className="flex items-start gap-1.5 px-2.5 pt-2 pb-1">
            <p
              id="intent-clarify-title"
              className="flex-1 text-[10px] leading-snug text-[#8c8a84]/95 font-medium"
            >
              {t('ai.intent.panel_hint')}
            </p>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="shrink-0 p-0.5 rounded-full text-[#b0aea8] hover:text-[#5a5a54] hover:bg-white/40 disabled:opacity-50 transition-colors"
              aria-label={t('ai.intent.cancel')}
            >
              <X className="w-3 h-3" strokeWidth={2} />
            </button>
          </div>

          <ul className="px-1 pb-1 space-y-px" aria-label={t('ai.intent.modal_choose')}>
            {options.map((opt, i) => {
              const isChecked = selected.includes(i);
              return (
                <li key={i}>
                  <label
                    className={`flex items-start gap-2 cursor-pointer rounded-lg px-2 py-1.5 transition-all duration-150 ${
                      isChecked
                        ? 'bg-white/45 ring-1 ring-[#C2410C]/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]'
                        : 'hover:bg-white/30'
                    } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isChecked}
                      disabled={isSubmitting}
                      onChange={() => toggle(i)}
                    />
                    <span
                      className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-all ${
                        isChecked
                          ? 'border-[#C2410C]/80 bg-[#C2410C]/90 text-white shadow-sm'
                          : 'border-[#d8d6d0]/90 bg-white/35 backdrop-blur-sm'
                      }`}
                      aria-hidden
                    >
                      {isChecked ? <Check className="w-2 h-2 stroke-[3]" /> : null}
                    </span>
                    <span className="text-[11px] text-[#3d3d38] leading-snug">{opt}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="px-2 pb-2 pt-0.5 flex flex-col gap-1 border-t border-white/35">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setExtraOpen((v) => !v)}
              className="flex items-center gap-0.5 text-[10px] text-[#a8a6a0] hover:text-[#6a6a64] disabled:opacity-50 self-start py-0.5 transition-colors"
            >
              {extraOpen ? (
                <ChevronUp className="w-2.5 h-2.5" aria-hidden />
              ) : (
                <ChevronDown className="w-2.5 h-2.5" aria-hidden />
              )}
              {t('ai.intent.extra_toggle')}
            </button>
            {extraOpen ? (
              <textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                disabled={isSubmitting}
                rows={2}
                placeholder={t('ai.intent.extra_placeholder')}
                className="w-full rounded-lg border border-white/50 bg-white/25 backdrop-blur-sm px-2 py-1 text-[11px] text-[#1a1a1a] placeholder:text-[#b0aea8] focus:outline-none focus:ring-1 focus:ring-[#C2410C]/25 disabled:opacity-50 resize-none shadow-[inset_0_1px_2px_rgba(26,26,26,0.04)]"
              />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#b0aea8] tabular-nums">
                {selected.length > 0
                  ? t('ai.intent.selected_count', { count: selected.length })
                  : t('ai.intent.select_at_least_one')}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isSubmitting}
                  className="text-[10px] text-[#a8a6a0] hover:text-[#5a5a54] disabled:opacity-50 px-1.5 py-0.5 rounded-md hover:bg-white/35 transition-colors"
                >
                  {t('ai.intent.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={submitSelected}
                  className="text-[10px] font-semibold text-[#C2410C] hover:text-[#a0350a] disabled:opacity-35 disabled:pointer-events-none flex items-center gap-1 px-1.5 py-0.5 rounded-md enabled:hover:bg-white/40 enabled:backdrop-blur-sm transition-all"
                >
                  {isSubmitting ? <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden /> : null}
                  {t('ai.intent.confirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
