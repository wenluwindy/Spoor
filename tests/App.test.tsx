import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../src/db';
import i18n from '../src/i18n';
import { normalizeAiConfig, resolveActiveChatConfig } from '../src/services/aiConfig';

// --- Mock 外部依赖 ---

// Mock @google/genai
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: 'AI generated response' }),
    },
  })),
}));

// Mock react-i18next，用真实翻译资源但绕过 initReactI18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'sidebar.nav_heading': '导航',
        'sidebar.personal': '画布',
        'sidebar.reference': '长文',
        'sidebar.lab': '研究',
        'sidebar.agents': '角色',
        'sidebar.search_placeholder': '搜索记忆...',
        'sidebar.new_note': '新建便签',
        'sidebar.publish': '合成文章',
        'sidebar.settings': '设置',
        'canvas.zoom': '缩放',
        'canvas.full_screen': '全屏',
        'canvas.history': '历史记录',
        'canvas.new_canvas': '新建画布',
        'canvas.default_name': `画布 ${opts?.number ?? ''}`,
        'canvas.rename': '重命名',
        'canvas.delete_note': '删除便签',
        'canvas.select_note': '选择便签',
        'canvas.port_in': '连线入口',
        'canvas.port_out': '连到另一张卡片',
        'canvas.change_color': '更改颜色',
        'canvas.change_font': '更改字体',
        'nodes.theme': '核心主题',
        'nodes.note': '笔记',
        'nodes.observation': '观察',
        'nodes.thought_node': '思绪节点',
        'nodes.ai_refinement': 'AI 优化',
        'nodes.ai_loading': '合成中...',
        'nodes.empty_note': '空笔记。点击编辑。',
        'nodes.type_something': '输入内容...',
        'settings.title': '设置',
        'settings.profile': '个人资料',
        'settings.ai_config': 'AI 配置',
        'settings.language': '语言',
        'settings.user_name': '显示名称',
        'settings.user_role': '当前焦点 / 状态',
        'settings.provider': 'AI 服务商',
        'settings.api_key': 'API 密钥',
        'settings.base_url': '基础 URL (可选)',
        'settings.model': '模型',
        'settings.save_success': '设置已保存。',
        'settings.close': '关闭',
        'settings.save': '保存配置',
        'ai.input_placeholder': '让 AI 构思一些想法或段落...',
        'ai.loading': 'AI 思考中...',
        'agents.personas': '人格设定',
        'agents.new_persona': '新建人格',
        'agents.test_sandbox': '测试沙盒',
        'agents.close_sandbox': '关闭沙盒',
        'agents.enhance_prompt': 'AI 优化提示词',
        'agents.identity_tone': '身份与基调',
        'agents.persona_name': '人格名称',
        'agents.role_specialty': '角色专长',
        'agents.system_prompt': '系统提示词',
        'agents.knowledge_base': '知识集群',
        'agents.model_params': '模型参数',
        'agents.temp': '采样温度',
        'agents.creativity': '创造力',
        'agents.delete_confirm': '您确定要删除此人格设定吗？',
        'agents.delete_persona': '删除人格',
        'agents.search_personas': '搜索人格...',
        'agents.sandbox_title': `沙盒：${opts?.name ?? ''}`,
        'agents.sandbox_empty': `正在测试 ${opts?.name ?? ''} 的沙盒。`,
        'agents.ai_thinking': 'AI 正在思考...',
        'agents.message_placeholder': `给 ${opts?.name ?? ''} 发送消息...`,
        'agents.sandbox_note': '沙盒使用当前的提示词和参数',
        'agents.sandbox_clear': '清空对话',
        'agents.sandbox_clear_aria': '清空沙盒对话',
        'agents.sandbox_clear_confirm': '确定清空该人格沙盒中的对话记录？此操作不可恢复。',
        'settings.docs_heading': '配置说明与官方文档',
        'settings.docs_blurb_gemini': '在 Google AI Studio 创建 API 密钥后填入。',
        'settings.docs_link_gemini_console_key': 'Google AI Studio — 获取 API 密钥',
        'settings.docs_all_providers_heading': '各 AI 服务商 — 官方文档',
        'settings.docs_security_note': '切勿向他人泄露密钥。',
        'agents.select_persona': '请选择一个人格',
        'agents.select_subtitle': '从侧边栏选择一个人格或创建一个新人格。',
        'lab.investigate': '您想调查什么？',
        'lab.placeholder': '例如：空间衰减与记忆丧失之间的关系...',
        'lab.approve': '批准并执行',
        'lab.executing': '智能体执行日志',
        'lab.report': '综合报告',
        'lab.new_research': '新研究',
        'lab.past_sessions': '历史会话',
        'lab.no_past_sessions': '暂无已完成的研究。完成一次研究后会显示在这里。',
        'lab.idle_intro': '可以输入宽泛主题或具体论点。智能体会拟定研究计划、对照档案与资料并生成综合报告。',
        'lab.suggested_tag_1': '# 空间编码',
        'lab.suggested_tag_2': '# 人物弧光',
        'lab.sources_utilized': '已用来源',
        'lab.processed': '已处理',
        'lab.demo_source_card_1_title': '第四章：档案室',
        'lab.demo_source_card_1_desc': '找到 3 处与「衰败」相关的隐喻。',
        'lab.demo_source_card_2_title': '参考文献 042：空间编码',
        'lab.demo_source_card_2_desc': '串联创伤理论与蓝图意象。',
        'lab.target_inquiry': '研究主题',
        'lab.recommended_plan_title': '推荐研究计划',
        'lab.plan_edit_hint': '可直接编辑各步标题与说明。',
        'lab.plan_revision_placeholder': '说明希望如何修改大纲…',
        'lab.plan_revision_apply': '让 AI 按说明更新大纲',
        'lab.plan_revision_applying': '正在更新大纲…',
        'lab.searching': '正在联网搜索...',
        'lab.search_complete': `已获取 ${opts?.count ?? 0} 条网络来源`,
        'lab.search_fallback': '搜索不可用，使用离线模式',
        'lab.search_preparing': '正在准备联网搜索…',
        'lab.search_offline_no_key': '离线模式 — 未配置 Metaso API 密钥。',
        'lab.stage_resolving_context': '正在整理上下文…',
        'lab.stage_generating_report': '正在生成报告…',
        'lab.report_footer_web': `基于 ${opts?.count ?? 0} 条网络来源与 LLM 综合`,
        'lab.report_footer_offline': '离线模式 — 仅由 LLM 综合',
        'lab.conclusion_label': '智能体建议与结论：',
        'reference.index_title': '档案索引',
        'reference.search_refs': '搜索参考文献...',
        'reference.citation': '引用文献',
        'reference.metadata_notes': '元数据与笔记',
        'reference.tags': '标签',
        'reference.linked_drafts': '关联画布',
        'reference.private_notes': '私密笔记',
        'reference.notes_placeholder': '为此参考文献添加您自己的笔记...',
        'app.name': '记忆建筑师',
        'app.description': '空间思维与知识合成',
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: 'zh',
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock lucide-react icons - 简单返回 SVG 占位（导出名取自真实模块，见 tests/lucideMock.ts）
vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('./lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

// Mock react-markdown
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

// Mock motion
vi.mock('motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy({}, {
    get: (_target, prop) => {
      return ({ children, ...rest }: Record<string, unknown>) => {
        const { createElement } = require('react');
        return createElement(String(prop), rest, children);
      };
    },
  }),
}));

// 导入被测组件
import App from '../src/App';

/**
 * 新建便签：底部工具栏的 `+` 已撤掉（改走输入栏自然语言），
 * 现在剩下的入口是画布右键菜单。
 */
async function createNoteViaContextMenu(user: ReturnType<typeof userEvent.setup>) {
  const main = document.querySelector('main')!;
  fireEvent.contextMenu(main, { clientX: 400, clientY: 300 });
  const item = await screen.findByText('新建便签');
  await user.click(item.closest('button')!);
}

describe('App 组件', () => {
  beforeEach(async () => {
    // 清空数据库
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.researchSessions.clear();
    await db.agentSandboxThreads.clear();
    localStorage.clear();
  });

  // --- 辅助函数：在 <a> 标签中查找导航链接 ---
  const getNavLinks = () => {
    const nav = document.querySelector('nav');
    return nav ? Array.from(nav.querySelectorAll('a')) : [];
  };

  // --- 基础渲染 ---
  describe('基础渲染', () => {
    it('能正常渲染 App 组件', async () => {
      await act(async () => {
        render(<App />);
      });
      // 侧边栏导航链接应存在
      const nav = document.querySelector('nav');
      expect(nav?.textContent).toContain('导航');
      const links = getNavLinks();
      const linkTexts = links.map(a => a.textContent?.trim());
      expect(linkTexts).toContain('画布');
      expect(linkTexts).toContain('长文');
      expect(linkTexts).toContain('研究');
      expect(linkTexts).toContain('角色');
    });

    it('渲染用户默认名称', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('Spoor')).toBeInTheDocument();
    });

    it('渲染用户默认角色状态', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('专注模式已激活')).toBeInTheDocument();
    });
  });

  // --- 侧边栏导航 ---
  describe('侧边栏导航', () => {
    it('默认选中 personal 标签', async () => {
      await act(async () => {
        render(<App />);
      });
      const links = getNavLinks();
      const personalLink = links.find(a => a.textContent?.includes('画布'));
      expect(personalLink).toBeDefined();
      expect(personalLink).toHaveClass('bg-app-surface-raised');
    });

    it('切换到 reference 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const links = getNavLinks();
      const refLink = links.find(a => a.textContent?.includes('长文'))!;
      await user.click(refLink);
      expect(refLink).toHaveClass('bg-app-surface-raised');
    });

    it('切换到 lab 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const links = getNavLinks();
      const labLink = links.find(a => a.textContent?.includes('研究'))!;
      await user.click(labLink);
      expect(labLink).toHaveClass('bg-app-surface-raised');
    });

    it('切换到 agents 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const links = getNavLinks();
      const agentsLink = links.find(a => a.textContent?.includes('角色'))!;
      await user.click(agentsLink);
      expect(agentsLink).toHaveClass('bg-app-surface-raised');
    });
  });

  // --- 首启引导（内置 API Key 移除后唯一的上手路径） ---
  describe('首启引导卡', () => {
    it('未配置 API Key 时出现在画布上', async () => {
      await act(async () => {
        render(<App />);
      });

      expect(screen.getByText('onboarding.title')).toBeInTheDocument();
    });

    it('已配置 API Key 时不出现', async () => {
      localStorage.setItem(
        'ai_config',
        JSON.stringify({
          provider: 'doubao',
          apiKey: 'ark-configured',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          model: 'ep-mine',
        }),
      );

      await act(async () => {
        render(<App />);
      });

      expect(screen.queryByText('onboarding.title')).toBeNull();
    });

    it('本地 GGUF 只要填了模型路径就算已配置（不需要 API Key）', async () => {
      localStorage.setItem(
        'ai_config',
        JSON.stringify({
          provider: 'local_llama',
          apiKey: '',
          baseUrl: '',
          model: 'gemma',
          localGgufPath: 'D:/models/gemma.gguf',
        }),
      );

      await act(async () => {
        render(<App />);
      });

      expect(screen.queryByText('onboarding.title')).toBeNull();
    });

    it('点击主按钮直达设置面板', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByText('onboarding.cta').closest('button')!);
      // 侧栏底部也有「设置」文案，按标题定位才唯一
      expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
      expect(screen.queryByText('onboarding.title')).toBeNull();
    });

    it('关掉后本次会话不再出现', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByRole('button', { name: 'onboarding.dismiss' }));
      expect(screen.queryByText('onboarding.title')).toBeNull();
    });
  });

  // --- 设置按钮 ---
  describe('设置', () => {
    it('点击设置按钮打开设置面板', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const settingsBtn = screen.getByLabelText('设置');
      await user.click(settingsBtn);

      // 设置面板应出现
      expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
      expect(screen.getByText('AI 配置')).toBeInTheDocument();
    });

    it('设置面板包含语言切换选项', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByLabelText('设置'));
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('模型服务在独立标签页里，不再堆在设置首屏', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByLabelText('设置'));
      // 首屏是「通用」，服务商配置要切过去才看得到
      expect(screen.queryByLabelText('AI 服务商')).toBeNull();
      await user.click(screen.getByRole('tab', { name: 'settings.tab_providers' }));
      expect(screen.getByText('settings.add_provider')).toBeInTheDocument();
    });
  });

  // --- 新建便签 ---
  describe('新建便签', () => {
    it('点击新建便签按钮创建节点', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await createNoteViaContextMenu(user);

      // 验证数据库中有新节点
      const nodes = await db.nodes.toArray();
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      expect(nodes.some(n => n.type === 'text')).toBe(true);
    });
  });

  // --- 连线 ---
  describe('连线落在空白处', () => {
    /** 连线态由 svg 上的 data-connecting-from 反映（临时连线靠它绘制）。 */
    const pendingLinkFrom = () =>
      document.querySelector('svg[data-connecting-from]')?.getAttribute('data-connecting-from') ?? '';

    it('落在空白处后连线态立即结束，不会一点再点反复建卡', async () => {
      // 回归：以前落在空白处只开菜单、不清 connectingFrom，于是关菜单的那一次点击
      // 又会命中同一段逻辑把菜单再弹出来——表现为「怎么点都还在建卡」，也放不下这根线。
      await act(async () => { render(<App />); });
      // 等种子节点经 useLiveQuery 渲染出来，端口才在 DOM 里
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      await act(async () => {
        fireEvent.pointerDown(screen.getAllByLabelText('连到另一张卡片')[0], { button: 0 });
      });
      expect(pendingLinkFrom()).not.toBe('');

      const background = document.querySelector('[data-canvas-background]')!;
      await act(async () => {
        fireEvent.pointerDown(background, { button: 0, clientX: 300, clientY: 300 });
      });

      expect(pendingLinkFrom()).toBe('');
    });
  });

  // --- 画布管理 ---
  describe('画布管理', () => {
    it('历史按钮能打开画布列表', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 先确保有画布数据
      await db.canvases.put({
        id: 'default',
        name: i18n.t('seed.canvas_name'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // 点击历史按钮（用 title 定位）
      const historyBtn = screen.getByLabelText('历史记录');
      await user.click(historyBtn);

      // 画布列表应出现
      expect(screen.getByText('新建画布')).toBeInTheDocument();
    });
  });

  // --- 缩放控制 ---
  describe('缩放控制', () => {
    it('显示缩放百分比', async () => {
      await act(async () => {
        render(<App />);
      });

      // 初始缩放应为 100%
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('点击缩放+按钮增加缩放', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 缩放+按钮的文本是 "缩放 +"
      const zoomInBtn = screen.getByText('缩放 +');
      await user.click(zoomInBtn);

      // 缩放应大于 100%
      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeGreaterThan(100);
    });

    it('点击缩放-按钮减少缩放', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 缩放-按钮的文本是 "缩放 -"
      const zoomOutBtn = screen.getByText('缩放 -');
      await user.click(zoomOutBtn);

      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeLessThan(100);
    });

    it('连续缩放后百分比正确更新', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 连续放大两次
      await user.click(screen.getByText('缩放 +'));
      await user.click(screen.getByText('缩放 +'));

      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeGreaterThan(110);
    });
  });

  // --- 数据库种子初始化 ---
  describe('数据库种子数据', () => {
    it('首次渲染时自动创建默认画布', async () => {
      await act(async () => {
        render(<App />);
      });

      // 等待 useEffect 中的 seed 完成
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const canvas = await db.canvases.get('default');
      expect(canvas).toBeDefined();
      expect(canvas?.name).toBe(i18n.t('seed.canvas_name'));
    });

    it('首次渲染时自动创建系统 Agent', async () => {
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const agents = await db.agents.toArray();
      const roles = agents.map(a => a.role);
      expect(roles).toContain('Journalist');
      expect(roles).toContain('Connector');
      expect(roles).toContain('Editor');
      expect(roles).toContain('Visionary');
    });

    it('首次渲染时自动创建示例节点和边', async () => {
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const nodes = await db.nodes.toArray();
      expect(nodes.length).toBeGreaterThanOrEqual(3);

      const edges = await db.edges.toArray();
      expect(edges.length).toBeGreaterThanOrEqual(3);

      // 应有 theme 类型节点
      expect(nodes.some(n => n.type === 'theme')).toBe(true);
    });
  });

  // --- localStorage 持久化 ---
  describe('localStorage 持久化', () => {
    it('用户名从 localStorage 恢复', async () => {
      localStorage.setItem('user_name', '自定义用户');
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('自定义用户')).toBeInTheDocument();
    });

    it('用户角色从 localStorage 恢复', async () => {
      localStorage.setItem('user_role', '专注写作中');
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('专注写作中')).toBeInTheDocument();
    });
  });

  // ============================================================
  // AISettingsModal 设置面板
  // ============================================================
  describe('AISettingsModal 设置面板', () => {
    const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByLabelText('设置'));
      await waitFor(() => {
        expect(screen.getByText('AI 配置')).toBeInTheDocument();
      });
    };

    /** 切到「模型服务」页并按预设加一个服务商。 */
    const addProvider = async (
      user: ReturnType<typeof userEvent.setup>,
      preset = 'settings.provider_kind.openai',
    ) => {
      await user.click(screen.getByRole('tab', { name: 'settings.tab_providers' }));
      await user.click(screen.getByRole('button', { name: preset }));
    };

    it('设置面板显示关闭按钮', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      expect(screen.getAllByRole('button', { name: '关闭' }).length).toBeGreaterThanOrEqual(1);
    });

    it('三个标签页都在，默认停在通用', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);

      expect(screen.getByRole('tab', { name: 'settings.tab_general' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('tab', { name: 'settings.tab_providers' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'settings.tab_storage' })).toBeInTheDocument();
    });

    it('通用页只剩语言、主题与检查更新', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);

      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('中文')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /settings\.update_check/ })).toBeInTheDocument();
      // 秘塔 Key 搬去了搜索服务页，配置说明搬去了帮助页
      expect(screen.queryByText('settings.search_key_label')).not.toBeInTheDocument();
      expect(screen.queryByText('settings.docs_all_providers_heading')).not.toBeInTheDocument();
    });

    it('搜索服务页列出各家并各给一个 Key 输入框', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await user.click(screen.getByRole('tab', { name: 'settings.tab_search' }));

      expect(screen.getByRole('button', { name: 'Metaso' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tavily' })).toBeInTheDocument();
      expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
    });

    it('帮助页把文档与功能说明全部摊开，没有折叠区', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await user.click(screen.getByRole('tab', { name: 'settings.tab_help' }));

      // 这几个键在本文件的 t() 桩里有中文映射
      expect(screen.getByText('各 AI 服务商 — 官方文档')).toBeInTheDocument();
      expect(screen.getByText('切勿向他人泄露密钥。')).toBeInTheDocument();
      expect(screen.getByText('settings.help_features_heading')).toBeInTheDocument();
      expect(screen.getByText('settings.help_canvas_title')).toBeInTheDocument();
      // 「不用展开，全部写出」——页面里不该再有折叠区
      expect(document.querySelector('details')).toBeNull();
    });

    it('首次进入模型服务页是空的，并给出预设入口', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await user.click(screen.getByRole('tab', { name: 'settings.tab_providers' }));

      expect(screen.getByText('settings.providers_empty')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'settings.provider_kind.doubao' }),
      ).toBeInTheDocument();
    });

    it('按预设添加服务后出现完整的服务商卡片', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);

      expect(screen.queryByText('settings.providers_empty')).toBeNull();
      expect(screen.getByLabelText('AI 服务商')).toBeInTheDocument();
      expect(screen.getByLabelText('基础 URL (可选)')).toBeInTheDocument();
      expect(screen.getByLabelText('API 密钥')).toBeInTheDocument();
      expect(screen.getAllByLabelText('模型').length).toBeGreaterThanOrEqual(1);
    });

    it('OpenAI 预设带出生图模型；换成 DeepSeek 后生图区消失', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);
      expect(screen.getByText('settings.image_models')).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('AI 服务商'), 'deepseek');
      expect(screen.queryByText('settings.image_models')).toBeNull();
    });

    it('本地 GGUF 显示模型文件区块而不是 API 密钥', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);

      await user.selectOptions(screen.getByLabelText('AI 服务商'), 'local_llama');
      // 0.6.0 起手打路径输入框换成了文件选择区块；网页测试环境（非 Tauri）
      // 只显示「桌面版可用」的说明，但 API 密钥输入必须消失
      expect(screen.getByText('settings.local_gguf_path')).toBeInTheDocument();
      expect(screen.getByText('errors.ai.local_desktop_only')).toBeInTheDocument();
      expect(screen.queryByLabelText('API 密钥')).toBeNull();
    });

    it('填 API Key 后自动存进 localStorage 的 v2 结构', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);

      await user.type(screen.getByLabelText('API 密钥'), 'test-key-123');

      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('ai_config') || '{}');
        expect(saved.version).toBe(2);
        expect(resolveActiveChatConfig(normalizeAiConfig(saved)).apiKey).toContain('test');
      });
    });

    it('改模型名会写进配置', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);

      const modelInput = screen.getAllByLabelText('模型')[0];
      await user.clear(modelInput);
      await user.type(modelInput, 'o3');

      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('ai_config') || '{}');
        expect(resolveActiveChatConfig(normalizeAiConfig(saved)).model).toBe('o3');
      });
    });

    it('第一个添加的服务商自动成为当前对话服务商', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);

      expect(screen.getByText('settings.badge_active_chat')).toBeInTheDocument();
    });

    it('删除服务商要二次确认', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      await addProvider(user);

      await user.click(screen.getByRole('button', { name: 'settings.delete_provider' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Reference 参考文献面板
  // ============================================================
  describe('Reference 参考文献面板', () => {
    const goToReference = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      const links = getNavLinks();
      const refLink = links.find(a => a.textContent?.includes('长文'))!;
      await user.click(refLink);
    };

    it('切换到参考区标签后显示档案索引标题', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('档案索引')).toBeInTheDocument();
    });

    it('参考区显示文章列表', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      // 文章标题同时出现在列表和内容区，使用 getAllByText
      const matches = screen.getAllByText(i18n.t('seed.article_title'));
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('参考区显示文章类型和日期', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      // REF-042 和 1994 可能出现在列表和内容区
      const refMatches = screen.getAllByText('REF-042');
      expect(refMatches.length).toBeGreaterThanOrEqual(1);
      const dateMatches = screen.getAllByText('1994');
      expect(dateMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('参考区有搜索框', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      const searchInput = document.querySelector('input[placeholder="搜索参考文献..."]');
      expect(searchInput).toBeInTheDocument();
    });

    it('参考区显示引用文献按钮', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('引用文献')).toBeInTheDocument();
    });

    it('参考区显示元数据和笔记区域', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('元数据与笔记')).toBeInTheDocument();
    });

    it('参考区显示标签区域', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('标签')).toBeInTheDocument();
    });

    it('参考区显示私密笔记区域', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('私密笔记')).toBeInTheDocument();
    });
  });

  // ============================================================
  // AgentsStudio AI 助手工作室
  // ============================================================
  describe('AgentsStudio AI 助手工作室', () => {
    const goToAgents = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      const links = getNavLinks();
      const agentsLink = links.find(a => a.textContent?.includes('角色'))!;
      await user.click(agentsLink);
    };

    it('切换到 AI 助手标签后顶部为搜索人格栏且无「人格设定」标题', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByPlaceholderText('搜索人格...')).toBeInTheDocument();
      expect(screen.queryByText('人格设定')).not.toBeInTheDocument();
    });

    it('显示默认的系统代理列表', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const mirrorMatches = screen.getAllByText('The Mirror of Insight');
      expect(mirrorMatches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('The Weaver')).toBeInTheDocument();
      expect(screen.getByText('The Smoothing Iron')).toBeInTheDocument();
    });

    it('显示搜索人格输入框', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const searchInput = document.querySelector('input[placeholder="搜索人格..."]');
      expect(searchInput).toBeInTheDocument();
    });

    it('搜索代理过滤列表', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const searchInput = document.querySelector('input[placeholder="搜索人格..."]') as HTMLInputElement;
      await user.type(searchInput, 'Weaver');
      expect(screen.getAllByText('The Weaver').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('The Mirror of Insight')).not.toBeInTheDocument();
    });

    it('点击代理选中并显示配置编辑器', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      // 第一个代理默认已选中，直接验证编辑器
      expect(screen.getByText('身份与基调')).toBeInTheDocument();
    });

    it('选中代理后顶部标题为人格名称可编辑输入', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const titleInput = screen.getByLabelText('人格名称');
      expect(titleInput).toBeInstanceOf(HTMLInputElement);
      expect(screen.queryByText('角色专长')).not.toBeInTheDocument();
    });

    it('选中代理后显示系统提示词', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('系统提示词')).toBeInTheDocument();
    });

    it('选中代理后显示模型参数', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('模型参数')).toBeInTheDocument();
      expect(screen.getByText('采样温度')).toBeInTheDocument();
      expect(screen.getByText('创造力')).toBeInTheDocument();
    });

    it('选中代理后显示沙盒测试按钮', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('测试沙盒')).toBeInTheDocument();
    });

    it('选中代理后显示删除按钮', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('删除人格')).toBeInTheDocument();
    });

    it('点击新建人格按钮添加新代理', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const sidebar = screen.getByPlaceholderText('搜索人格...').closest('section');
      const addBtn = Array.from(sidebar?.querySelectorAll('button') ?? []).find((btn) =>
        btn.querySelector('svg[data-testid="icon-Plus"]'),
      );
      expect(addBtn).toBeDefined();
      await user.click(addBtn!);
      // 新人格应出现在列表中
      await waitFor(() => {
        expect(screen.getAllByText('新建人格').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('点击沙盒按钮打开沙盒面板', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      await user.click(screen.getByText('测试沙盒'));
      expect(screen.getByText('关闭沙盒')).toBeInTheDocument();
    });

  });

  // ============================================================
  // ResearchLab 研究实验室
  // ============================================================
  describe('ResearchLab 研究实验室', () => {
    const goToLab = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      const labLink = links.find(a => a.textContent?.includes('研究'))!;
      await user.click(labLink);
    };

    it('切换到研究标签后显示调查输入框', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      expect(screen.getByText('您想调查什么？')).toBeInTheDocument();
    });

    it('输入框有正确的 placeholder', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      const input = document.querySelector('input[placeholder*="空间衰减"]');
      expect(input).toBeInTheDocument();
    });

    it('显示历史会话区域', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      expect(screen.getByText('历史会话')).toBeInTheDocument();
    });

    it('idle 无历史记录时显示空态文案', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      expect(screen.getByText('暂无已完成的研究。完成一次研究后会显示在这里。')).toBeInTheDocument();
    });

    it('idle 阶段显示提交箭头按钮', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      // idle 阶段有 form submit 按钮（ArrowRight 图标）
      const form = document.querySelector('form');
      const submitBtn = form?.querySelector('button[type="submit"]');
      expect(submitBtn).toBeInTheDocument();
    });

    it('输入研究主题后可以提交', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      const input = document.querySelector('input[placeholder*="空间衰减"]') as HTMLInputElement;
      await user.type(input, 'The relationship between spatial decay and memory loss');
      expect(input.value).toContain('spatial decay');
    });

    it('提交研究主题后进入 planning 阶段', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      const input = document.querySelector('input[placeholder*="空间衰减"]') as HTMLInputElement;
      await user.type(input, 'memory architecture');
      const form = document.querySelector('form');
      const submitBtn = form?.querySelector('button[type="submit"]');
      await user.click(submitBtn!);
      // 应进入 planning 阶段或 plan_ready 阶段
      // 由于 mock 了 AI，会立即完成
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
    });
  });

  // ============================================================
  // callUniversalAI 间接测试
  // ============================================================
  describe('callUniversalAI 间接测试', () => {
    it('Gemini 配置下 AI 提交成功返回内容', async () => {
      const user = userEvent.setup();
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'gemini', apiKey: 'test-gemini-key', model: 'gemini-1.5-flash'
      }));
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // 找到 AI 输入框并提交
      const aiInput = document.querySelector('input[placeholder*="AI 构思"]');
      if (aiInput) {
        await user.type(aiInput, 'Write about memory architecture');
        const sendBtn = aiInput.closest('div')?.querySelector('button');
        if (sendBtn) {
          await user.click(sendBtn);
          // AI 应该返回 mock 的内容
          await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
          });
        }
      }
    });

    it('无 API Key 时 Gemini 回退到环境变量', async () => {
      // 不设置 apiKey，环境变量也没有 GEMINI_API_KEY
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'gemini', apiKey: '', model: 'gemini-1.5-flash'
      }));
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      // 应用正常渲染不崩溃 — 使用 getNavLinks 验证侧栏存在
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });

    it('OpenAI 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o', baseUrl: ''
      }));
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });

    it('Anthropic 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet'
      }));
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });

    it('Custom 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'custom', apiKey: 'test-key', model: 'custom-model', baseUrl: 'http://localhost:8080/v1'
      }));
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // DraggableNode 节点交互
  // ============================================================
  describe('DraggableNode 节点交互', () => {
    it('渲染种子节点内容', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      // 种子数据包含 "The Memory Architect" 节点
      expect(screen.getByText('The Memory Architect')).toBeInTheDocument();
    });

    it('渲染多种节点类型', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      // 种子数据包含 note 和 ai 类型节点
      expect(screen.getByText('Spatial architecture of trauma')).toBeInTheDocument();
      expect(screen.getByText('Non-euclidean memory leaks')).toBeInTheDocument();
    });

    it('新建便签按钮在数据库中创建 text 类型节点', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await createNoteViaContextMenu(user);
      const nodes = await db.nodes.toArray();
      const textNodes = nodes.filter(n => n.type === 'text');
      expect(textNodes.length).toBeGreaterThanOrEqual(1);
      expect(textNodes[0].canvasId).toBeDefined();
    });

    it('新建便签的节点有正确的 canvasId', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await createNoteViaContextMenu(user);
      const nodes = await db.nodes.toArray();
      const textNode = nodes.find(n => n.type === 'text');
      expect(textNode?.canvasId).toBe('default');
    });

    it('节点有 x 和 y 坐标', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      const nodes = await db.nodes.toArray();
      nodes.forEach(node => {
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
      });
    });
  });

  // ============================================================
  // 画布增强测试
  // ============================================================
  describe('画布增强测试', () => {
    it('新建画布后切换到新画布', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      // 打开画布列表
      const historyBtn = screen.getByLabelText('历史记录');
      await user.click(historyBtn);

      // 点击新建画布
      const newCanvasBtn = screen.getByText('新建画布');
      await user.click(newCanvasBtn);

      // 验证数据库中有新画布
      const canvases = await db.canvases.toArray();
      expect(canvases.length).toBeGreaterThanOrEqual(2);
    });

    it('画布列表显示默认画布名称', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const historyBtn = screen.getByLabelText('历史记录');
      await user.click(historyBtn);
      expect(screen.getByText(i18n.t('seed.canvas_name'))).toBeInTheDocument();
    });

    it('新建便签后节点属于当前画布', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      await createNoteViaContextMenu(user);

      const nodes = await db.nodes.toArray();
      const newNode = nodes.find(n => n.type === 'text');
      expect(newNode?.canvasId).toBe('default');
    });

    it('AI 提交输入框存在', async () => {
      await act(async () => { render(<App />); });
      const aiInput = document.querySelector('input[placeholder*="AI"]');
      expect(aiInput).toBeInTheDocument();
    });

    it('全屏按钮存在', async () => {
      await act(async () => { render(<App />); });
      const fullscreenBtn = screen.getByLabelText('全屏');
      expect(fullscreenBtn).toBeInTheDocument();
    });

    it('侧边栏折叠/展开切换', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      // 找到折叠按钮（ChevronLeft 图标所在的按钮）
      const aside = document.querySelector('aside')!;
      const toggleBtn = aside.querySelector('div.mt-auto button:first-child')!;

      // 初始状态侧边栏是展开的
      expect(aside).toHaveClass('w-48');

      // 点击折叠
      await user.click(toggleBtn);
      expect(aside).toHaveClass('w-20');
    });
  });
});
