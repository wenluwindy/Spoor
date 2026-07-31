import React from 'react';
import { Bot } from 'lucide-react';

import mirrorIconUrl from '../assets/agents/mirror.png';
import weavingIconUrl from '../assets/agents/weaving.png';
import ironSmoothingIconUrl from '../assets/agents/iron-smoothing.png';
import compassIconUrl from '../assets/agents/compass.png';

const AGENT_ICON_URLS: Record<string, string> = {
  interviewer: mirrorIconUrl,
  synthesizer: weavingIconUrl,
  stylist: ironSmoothingIconUrl,
  futurist: compassIconUrl,
};

export function getAgentIconUrl(agentId?: string | null) {
  return agentId ? AGENT_ICON_URLS[agentId] : undefined;
}

export function AgentIcon({
  agentId,
  className = 'w-5 h-5',
  imageClassName,
  fallbackClassName,
}: {
  agentId?: string | null;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}) {
  const iconUrl = getAgentIconUrl(agentId);

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        draggable={false}
        className={`${className} object-contain ${imageClassName ?? ''}`}
      />
    );
  }

  return <Bot className={`${className} ${fallbackClassName ?? ''}`} aria-hidden />;
}
