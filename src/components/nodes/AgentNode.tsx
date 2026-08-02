import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Play } from 'lucide-react';
import type { AgentNodeProps } from './types';
import { resolveAgentLocalizedName } from '../../utils/aiI18n';
import { AgentIcon } from '../AgentIcon';
import { NodeTypeLabel } from './NodeTypeLabel';

export function AgentNode({
  node,
  agentConfigs,
  isAnalyzing,
  onRunAnalysis,
  isAgentAnalysisActionDisabled,
}: AgentNodeProps) {
  const { t } = useTranslation();

  const conf = agentConfigs.find((a) => a.id === node.agentConfigId);
  const runDisabled = isAnalyzing || isAgentAnalysisActionDisabled || !onRunAnalysis;

  return (
    <div
      className="w-full h-full bg-app-surface-raised text-app-text p-4 shadow-lg border border-app-border rounded-lg relative overflow-hidden flex flex-col"
      // 人格强调色（AgentsStudio 里设置）：只覆盖边框，未设置时维持主题描边
      style={conf?.color ? { borderColor: conf.color } : undefined}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-app-accent/8 to-transparent pointer-events-none" aria-hidden />
      <NodeTypeLabel label={t('nodes.agent_label')} className="relative z-10 mb-2" />
      <div className="flex items-start gap-3 relative z-10">
        <div
          className="w-9 h-9 rounded-lg bg-app-surface-subtle border border-app-border flex items-center justify-center text-app-accent shrink-0 overflow-hidden"
          style={conf?.color ? { borderColor: conf.color, borderWidth: 2 } : undefined}
        >
          <AgentIcon
            agentId={conf?.id}
            className="w-full h-full"
            imageClassName="scale-[1.32]"
            fallbackClassName="text-app-accent"
          />
        </div>
        <div className="min-w-0 flex-1 self-center">
          <div className="font-serif text-xl font-bold leading-snug text-app-text">
            {conf ? resolveAgentLocalizedName(conf) : 'Agent'}
          </div>
        </div>
        {onRunAnalysis ? (
          <button
            type="button"
            data-testid="agent-run-analysis"
            title={t('nodes.agent_run_analysis')}
            aria-label={t('nodes.agent_run_analysis')}
            disabled={runDisabled}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!runDisabled) onRunAnalysis();
            }}
            className="shrink-0 w-9 h-9 rounded-lg border border-app-border bg-app-surface flex items-center justify-center text-app-accent hover:bg-app-accent-wash hover:border-app-accent/60 disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-sm"
          >
            <Play className="w-4 h-4" aria-hidden fill="currentColor" />
          </button>
        ) : null}
      </div>
      {isAnalyzing ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-app-surface-raised/75 backdrop-blur-[1px] pointer-events-none"
          data-testid="agent-analyzing-overlay"
        >
          <Loader2 className="w-8 h-8 text-app-accent animate-spin" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}
