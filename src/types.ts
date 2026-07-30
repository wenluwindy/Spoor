import type { AIConfig } from './components/AISettingsModal';

export type CallAIFn = (params: {
  config: AIConfig;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  /** When set, OpenAI-compatible providers emit incremental full text; others invoke once at completion. */
  onStreamChunk?: (accumulatedText: string) => void;
}) => Promise<string | undefined>;
