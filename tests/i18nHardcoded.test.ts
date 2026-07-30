import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import i18n from '../src/i18n';

/**
 * 回归防线：升级前散落在源码里的英文/中文硬编码文案，不能悄悄回来。
 *
 * 只查具体字面量，不做泛化扫描——泛化扫描留给 scripts/check-i18n.mjs。
 */
const FORBIDDEN_LITERALS: { needle: string; where: string }[] = [
  { needle: 'Upload File', where: 'CanvasToolbar 上传按钮提示' },
  { needle: 'Atmospheric Library', where: 'ImageNode alt' },
  { needle: 'Curator Profile', where: 'Sidebar 头像 alt' },
  { needle: 'Central research objective', where: 'ThemeNode 默认描述' },
  { needle: 'LATENT_SPACE', where: 'ThemeNode 页脚' },
  { needle: 'Spatial Encoding', where: 'ThemeNode 页脚' },
  { needle: 'Archive Extraction', where: 'ResearchLab 兜底计划' },
  { needle: 'Thematic Networking', where: 'ResearchLab 兜底计划' },
  { needle: 'You are a specialized agent', where: 'AgentsStudio 提示词占位符' },
  { needle: 'Custom Endpoint', where: 'AISettingsModal 服务商选项' },
  { needle: "'Saving...'", where: 'Reference 笔记保存状态' },
  { needle: "'Assistant'", where: 'AgentsStudio 新建人设角色' },
  { needle: "'Main Workspace'", where: 'useSeedData 默认画布名' },
  { needle: '(空文档)', where: 'DocumentNode / utils/file 空文档占位' },
  { needle: 'VITE_BUILTIN', where: '内置 API Key 机制' },
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

const SOURCES = walk('src').map((file) => ({
  file: file.split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8'),
}));

describe('硬编码文案回归', () => {
  it.each(FORBIDDEN_LITERALS)('$where 不再出现硬编码 $needle', ({ needle }) => {
    const hits = SOURCES.filter(
      // i18n 资源文件本身当然会包含这些英文——它们是 en 文案，不是硬编码
      (s) => !s.file.startsWith('src/i18n/') && s.text.includes(needle),
    ).map((s) => s.file);
    expect(hits).toEqual([]);
  });
});

describe('新增文案的中英双语完整性', () => {
  const NEW_KEYS = [
    'canvas.upload_file',
    'canvas.menu.insert_image',
    'canvas.menu.delete_node',
    'canvas.menu.link_all_to_this',
    'nodes.image_alt',
    'nodes.document_label',
    'nodes.empty_document_body',
    'nodes.theme_default_desc',
    'nodes.theme_footer_encoding',
    'nodes.theme_footer_latent',
    'sidebar.avatar_alt',
    'agents.default_role',
    'agents.prompt_placeholder',
    'agents.sandbox_error',
    'reference.note_saving',
    'reference.note_saved',
    'settings.provider_custom',
    'settings.doubao_model_hint',
    'lab.plan_fallback.step1_title',
    'lab.parse_error_report.intro',
    'seed.canvas_name',
    'seed.article_title',
    'desktop_only.title',
    'onboarding.title',
  ];

  it.each(NEW_KEYS)('%s 在 en 与 zh 中都有值', (key) => {
    for (const lng of ['en', 'zh']) {
      const value = i18n.getFixedT(lng)(key);
      expect(value, `${lng}:${key}`).not.toBe(key);
      expect(String(value).trim().length).toBeGreaterThan(0);
    }
  });

  it('中文文案确实是中文（不是把英文抄过去）', () => {
    const cjk = /[一-鿿]/;
    const latinOnlyAllowed = new Set(['seed.canvas_name']);
    for (const key of NEW_KEYS) {
      if (latinOnlyAllowed.has(key)) continue;
      const zhValue = String(i18n.getFixedT('zh')(key));
      expect(cjk.test(zhValue), `${key} -> ${zhValue}`).toBe(true);
    }
  });
});
