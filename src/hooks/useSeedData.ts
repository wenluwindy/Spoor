import { useEffect } from 'react';
import i18n from '../i18n';
import { db } from '../db';
import type { AgentConfig } from '../db';
import { LEGACY_AGENT_PROMPTS, SYSTEM_AGENT_IDS, SYSTEM_AGENT_TUNING, type SystemAgentId } from '../constants/defaultAgents';

/** 仍在使用旧版种子文案时，写入当前语言的默认提示词（不覆盖用户自定义）。 */
async function migrateLegacyAgentPrompts() {
  for (const id of SYSTEM_AGENT_IDS) {
    const legacies = LEGACY_AGENT_PROMPTS[id];
    if (!legacies?.length) continue;
    const row = await db.agents.get(id);
    if (!row) continue;
    const current = (row.prompt ?? '').trim();
    if (legacies.includes(current)) {
      await db.agents.update(id, { prompt: i18n.t(`agents.defaults.${id}.prompt`) });
    }
  }
}

/** Seed the database with default agents, nodes, and articles on first run. */
export function useSeedData() {
  useEffect(() => {
    const seed = async () => {
      const defaultCanvas = await db.canvases.get('default');
      if (!defaultCanvas) {
        await db.canvases.add({
          id: 'default',
          name: i18n.t('seed.canvas_name'),
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      const agentIds = [...SYSTEM_AGENT_IDS];
      const existingAgents = await db.agents.toArray();
      const existingIds = new Set(existingAgents.map(a => a.id));
      const missingIds = agentIds.filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        const toAdd: AgentConfig[] = missingIds.map((id) => {
          const sid = id as SystemAgentId;
          return {
            id: sid,
            name: i18n.t(`agents.defaults.${sid}.name`),
            role: i18n.t(`agents.defaults.${sid}.role`),
            prompt: i18n.t(`agents.defaults.${sid}.prompt`),
            ...SYSTEM_AGENT_TUNING[sid],
          };
        });
        await db.agents.bulkPut(toAdd);
      }

      await migrateLegacyAgentPrompts();
      await db.agents.delete('challenger');
      await db.agents.delete('pragmatist');

      const totalCount = await db.agents.count();
      if (totalCount <= 4) {
        const nodeCount = await db.nodes.count();
        if (nodeCount === 0) {
          await db.articles.put({
            id: 'ref-042',
            title: i18n.t('seed.article_title'),
            content: i18n.t('seed.article_content'),
            date: '1994',
            type: 'REF-042',
            tags: [],
            linkedCanvasIds: [],
          });

          await db.nodes.bulkPut([
            { id: 'theme', type: 'theme', content: i18n.t('seed.theme'), x: 200, y: 300 },
            { id: 'insp1', type: 'note', content: i18n.t('seed.note_1'), x: 500, y: 200 },
            { id: 'ai', type: 'ai', content: i18n.t('seed.ai'), x: 500, y: 400 },
            { id: 'insp2', type: 'note', content: i18n.t('seed.note_2'), x: 800, y: 300 }
          ]);

          await db.edges.bulkPut([
            { id: 'e1', from: 'theme', to: 'insp1' },
            { id: 'e2', from: 'theme', to: 'ai' },
            { id: 'e3', from: 'ai', to: 'insp2' },
            { id: 'e4', from: 'insp1', to: 'insp2' }
          ]);
        }
      }
    };
    seed();
  }, []);
}
