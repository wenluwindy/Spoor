import { db } from '../db';
import { SYSTEM_AGENT_IDS } from '../constants/defaultAgents';

/** 删除内置六条 Agent，便于开发者在拉取新默认文案后由 `useSeedData` 重新写入。 */
export async function resetBuiltinAgentsInDb(): Promise<void> {
  await Promise.all(SYSTEM_AGENT_IDS.map((id) => db.agents.delete(id)));
}

const win = typeof globalThis !== 'undefined' ? (globalThis as typeof globalThis & { __SCRIBE_RESET_BUILTIN_AGENTS?: () => Promise<void> }) : undefined;

/** 挂载 `globalThis.__SCRIBE_RESET_BUILTIN_AGENTS`（仅 dev）；执行删除后刷新页面即可由 `useSeedData` 重灌默认。 */
export function registerDevBuiltinAgentReset(): void {
  if (!import.meta.env.DEV || !win) return;
  win.__SCRIBE_RESET_BUILTIN_AGENTS = () => resetBuiltinAgentsInDb();
}
