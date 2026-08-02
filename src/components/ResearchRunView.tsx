import { useTranslation } from 'react-i18next';
import {
  Terminal,
  CheckCircle2,
  Loader2,
  Globe,
  AlertTriangle,
  Search as SearchIcon,
  Square,
} from 'lucide-react';
import type { ResearchSessionWebpageSnapshot } from '../db';
import type { ResearchRunState, ResearchRunStep, ResearchRunStepStatus } from '../hooks/useResearchRun';

/**
 * Research Lab 执行视图：逐步卡片 + 进度/成本指示 + 停止按钮 + 结束横幅。
 *
 * 只做渲染：一切状态来自 `useResearchRun` 的 reducer state，动作全部回调给
 * ResearchLab（停止 / 重试 / 返回大纲 / 打开来源详情）。
 */
export interface ResearchRunViewProps {
  run: ResearchRunState;
  onStop: () => void;
  onRetry: () => void;
  onBackToPlan: () => void;
  onShowSource: (wp: ResearchSessionWebpageSnapshot) => void;
}

const STEP_STATUS_LABEL_KEY: Record<ResearchRunStepStatus, string> = {
  pending: 'lab.step_status_pending',
  querying: 'lab.step_status_querying',
  searching: 'lab.step_status_searching',
  analyzing: 'lab.step_status_analyzing',
  done: 'lab.step_status_done',
  failed: 'lab.step_status_failed',
};

function StepStatusIcon({ status }: { status: ResearchRunStepStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" aria-hidden />;
    case 'failed':
      return <AlertTriangle className="w-4 h-4 text-[#eab308] shrink-0" aria-hidden />;
    case 'searching':
      return <Globe className="w-4 h-4 text-app-accent animate-pulse shrink-0" aria-hidden />;
    case 'querying':
    case 'analyzing':
      return <Loader2 className="w-4 h-4 text-app-accent animate-spin shrink-0" aria-hidden />;
    default:
      return <span className="w-4 h-4 shrink-0 rounded-full border-2 border-app-border" aria-hidden />;
  }
}

function RunStepCard({
  step,
  idx,
  active,
  onShowSource,
}: {
  step: ResearchRunStep;
  idx: number;
  active: boolean;
  onShowSource: (wp: ResearchSessionWebpageSnapshot) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={`lab-run-step-${idx}`}
      className={`rounded-lg border p-4 transition-colors ${
        active ? 'border-app-accent/60 bg-app-surface' : 'border-app-border bg-app-surface'
      }`}
    >
      <div className="flex items-center gap-2">
        <StepStatusIcon status={step.status} />
        <span className="font-sans font-bold text-app-text min-w-0 flex-1 truncate">
          {idx + 1}. {step.title}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-app-text-faint shrink-0">
          {t(STEP_STATUS_LABEL_KEY[step.status])}
        </span>
      </div>
      {step.subQuery ? (
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-app-text-muted min-w-0">
          <SearchIcon className="w-3 h-3 shrink-0" aria-hidden />
          <span className="font-bold shrink-0">{t('lab.step_subquery_label')}</span>
          <span className="truncate">{step.subQuery}</span>
        </div>
      ) : null}
      {step.searchFailed ? (
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-[#a16207]">
          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
          <span>{t('lab.search_fallback')}</span>
        </div>
      ) : null}
      {step.sources.length > 0 ? (
        <div className="mt-2.5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-app-text-faint mb-1.5">
            {t('lab.step_sources_label')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {step.sources.map((wp, srcIdx) => (
              <button
                key={`${wp.link}-${srcIdx}`}
                type="button"
                data-testid={`lab-run-step-${idx}-source-${srcIdx}`}
                onClick={() => onShowSource(wp)}
                className="max-w-full truncate rounded-full border border-app-border bg-app-surface-subtle px-2.5 py-1 font-sans text-[11px] text-app-text-muted hover:border-app-accent/50 hover:text-app-text transition-colors"
              >
                {wp.title?.trim() || wp.link || t('lab.source_untitled')}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {step.analysis ? (
        <p className="mt-3 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-app-text">
          {step.analysis}
        </p>
      ) : null}
    </div>
  );
}

export function ResearchRunView({ run, onStop, onRetry, onBackToPlan, onShowSource }: ResearchRunViewProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 p-8 overflow-y-auto w-full max-w-3xl mx-auto">
      <div className="w-full bg-app-surface-raised border border-app-border shadow-md rounded-xl p-6 font-sans text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2 text-app-accent font-bold font-mono">
            <Terminal className="w-4 h-4" aria-hidden />
            <span>{t('lab.executing')}</span>
          </div>
          <div className="flex items-center gap-3">
            {run.running && run.stage === 'steps' && run.currentStep >= 0 ? (
              <span className="font-mono text-xs text-app-text-muted" data-testid="lab-step-progress">
                {t('lab.step_progress', {
                  current: run.currentStep + 1,
                  total: run.steps.length,
                })}
              </span>
            ) : null}
            <span className="font-mono text-xs text-app-text-muted" data-testid="lab-calls-progress">
              {t('lab.calls_progress', {
                done: run.callsDone,
                total: run.estimatedLlmCalls + run.estimatedSearchCalls,
              })}
            </span>
            {run.running ? (
              <button
                type="button"
                data-testid="lab-stop-run"
                onClick={onStop}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#b91c1c]/40 bg-app-surface px-3 py-1.5 font-sans text-xs font-bold text-[#b91c1c] hover:bg-[#FEF2F2] transition-colors"
              >
                <Square className="w-3 h-3 fill-current" aria-hidden />
                {t('lab.stop_run')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          {run.steps.map((step, idx) => (
            <RunStepCard
              key={idx}
              step={step}
              idx={idx}
              active={run.running && run.stage === 'steps' && run.currentStep === idx}
              onShowSource={onShowSource}
            />
          ))}
        </div>

        {run.stage === 'synthesizing' ? (
          <div className="mt-6 border-t border-app-border pt-4">
            <div className="flex items-center gap-2 font-mono text-xs text-app-text-muted">
              <Loader2 className="w-4 h-4 animate-spin text-app-accent shrink-0" aria-hidden />
              <span>{run.reportStreamText ? t('lab.report_stream_status') : t('lab.synthesizing')}</span>
            </div>
            {run.reportStreamText ? (
              <pre className="mt-4 max-h-[min(360px,50vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-app-text bg-app-surface border border-app-border rounded-lg p-4">
                {run.reportStreamText}
              </pre>
            ) : null}
          </div>
        ) : null}

        {!run.running && run.outcome === 'aborted' ? (
          <div
            data-testid="lab-run-stopped"
            className="mt-6 rounded-xl border border-[#eab308]/40 bg-[#fffbeb] px-5 py-4 font-sans text-sm text-[#713f12] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div className="flex gap-3 min-w-0">
              <AlertTriangle className="w-5 h-5 shrink-0 text-[#b45309]" aria-hidden />
              <p className="leading-relaxed">{t('lab.run_stopped_banner')}</p>
            </div>
            <button
              type="button"
              data-testid="lab-back-to-plan"
              onClick={onBackToPlan}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-app-border bg-app-surface-raised px-5 py-2.5 text-sm font-bold text-app-text shadow-sm hover:bg-app-surface transition-colors"
            >
              {t('lab.back_to_plan')}
            </button>
          </div>
        ) : null}

        {!run.running && run.outcome === 'failed' ? (
          <div className="mt-6 rounded-xl border border-[#eab308]/40 bg-[#fffbeb] px-5 py-4 font-sans text-sm text-[#713f12] shadow-sm flex flex-col gap-4">
            <div className="flex gap-3 min-w-0">
              <AlertTriangle className="w-5 h-5 shrink-0 text-[#b45309]" aria-hidden />
              <p className="leading-relaxed">
                {run.failedStep != null
                  ? t('lab.run_failed_banner', { step: run.failedStep + 1 })
                  : t('lab.report_failed_banner')}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                data-testid="lab-back-to-plan"
                onClick={onBackToPlan}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-app-border bg-app-surface-raised px-5 py-2.5 text-sm font-bold text-app-text shadow-sm hover:bg-app-surface transition-colors"
              >
                {t('lab.back_to_plan')}
              </button>
              <button
                type="button"
                data-testid="lab-retry-report"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-app-accent px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-app-accent-hover transition-colors"
              >
                {t('lab.retry_generate_report')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
