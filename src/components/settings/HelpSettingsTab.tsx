import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink } from 'lucide-react';
import {
  ANTHROPIC_DOC_LINKS,
  CUSTOM_ENDPOINT_DOC_LINKS,
  DEEPSEEK_DOC_LINKS,
  GEMINI_DOC_LINKS,
  METASO_DOC_LINKS,
  DOUBAO_DOC_LINKS,
  MIMO_DOC_LINKS,
  OPENAI_DOC_LINKS,
  type DocLink,
} from '../../constants/aiProviderDocs';
import { SEARCH_PROVIDERS } from '../../constants/searchProviders';
import { openExternalUrl } from '../../utils/openExternal';

/**
 * 帮助页。
 *
 * 原来是通用页底部一个折叠的「配置说明与官方文档」面板，只讲 AI 服务商，
 * 而且默认收着——等于没人会看到。这里全部摊开，并补上项目其它功能的说明。
 *
 * 文案全部走 `t()`：`scripts/check-i18n.mjs` 会拦裸英文，en/zh 键集也必须一致。
 */

const SECTION_TITLE = 'text-[11px] font-bold text-app-text';
const META_LABEL =
  'text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider';
const BODY = 'text-[11px] text-app-text-muted leading-relaxed';

/** 各服务商的文档链接组，帮助页按这个顺序平铺。 */
const PROVIDER_DOCS: { titleKey: string; links: DocLink[] }[] = [
  { titleKey: 'settings.docs_provider_gemini', links: GEMINI_DOC_LINKS },
  { titleKey: 'settings.docs_provider_openai', links: OPENAI_DOC_LINKS },
  { titleKey: 'settings.docs_provider_anthropic', links: ANTHROPIC_DOC_LINKS },
  { titleKey: 'settings.docs_provider_mimo', links: MIMO_DOC_LINKS },
  { titleKey: 'settings.docs_provider_doubao', links: DOUBAO_DOC_LINKS },
  { titleKey: 'settings.docs_provider_deepseek', links: DEEPSEEK_DOC_LINKS },
  { titleKey: 'settings.docs_provider_custom', links: CUSTOM_ENDPOINT_DOC_LINKS },
];

/**
 * 功能帮助的分节。
 *
 * 做成数据而不是一堆 JSX：加一节只要加一条，不用在标记里再复制一遍样式。
 * `bodyKeys` 每一条渲染成一个列表项。
 */
const FEATURE_SECTIONS: { titleKey: string; bodyKeys: string[] }[] = [
  {
    titleKey: 'settings.help_canvas_title',
    bodyKeys: [
      'settings.help_canvas_marquee',
      'settings.help_canvas_pan',
      'settings.help_canvas_space_pan',
      'settings.help_canvas_zoom',
      'settings.help_canvas_context_menu',
      'settings.help_canvas_connect',
      'settings.help_canvas_connect_cancel',
      'settings.help_canvas_grid',
      'settings.help_canvas_fit',
    ],
  },
  {
    titleKey: 'settings.help_nodes_title',
    bodyKeys: [
      'settings.help_nodes_note',
      'settings.help_nodes_theme',
      'settings.help_nodes_ai',
      'settings.help_nodes_media',
      'settings.help_nodes_multiselect',
    ],
  },
  {
    titleKey: 'settings.help_imagegen_title',
    bodyKeys: [
      'settings.help_imagegen_inputs',
      'settings.help_imagegen_protocols',
      'settings.help_imagegen_history',
      'settings.help_imagegen_promote',
    ],
  },
  {
    titleKey: 'settings.help_agents_title',
    bodyKeys: ['settings.help_agents_roster', 'settings.help_agents_usage'],
  },
  {
    titleKey: 'settings.help_lab_title',
    bodyKeys: ['settings.help_lab_flow', 'settings.help_lab_output'],
  },
  {
    titleKey: 'settings.help_search_title',
    bodyKeys: ['settings.help_search_setup', 'settings.help_search_where'],
  },
  {
    titleKey: 'settings.help_storage_title',
    bodyKeys: [
      'settings.help_storage_layout',
      'settings.help_storage_manager',
      'settings.help_storage_originals',
    ],
  },
  {
    titleKey: 'settings.help_local_llm_title',
    bodyKeys: ['settings.help_local_llm_what', 'settings.help_local_llm_docs'],
  },
  {
    titleKey: 'settings.help_theme_title',
    bodyKeys: ['settings.help_theme_scope', 'settings.help_theme_language'],
  },
  {
    titleKey: 'settings.help_data_title',
    bodyKeys: ['settings.help_data_where', 'settings.help_data_backup', 'settings.help_data_keys'],
  },
  {
    titleKey: 'settings.help_update_title',
    bodyKeys: ['settings.help_update_how', 'settings.help_update_safety'],
  },
];

function DocLinksList({ links }: { links: DocLink[] }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {links.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            role="link"
            className="inline-flex items-center gap-1 text-[11px] text-[#1d4ed8] hover:underline break-all cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              void openExternalUrl(l.href);
            }}
          >
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
            {t(l.labelKey)}
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface HelpSettingsTabProps {
  /** 当前对话服务商，用来把它的配置说明顶到最前面。 */
  activeProviderKind: string;
}

function blurbKeyForProvider(provider: string): string {
  switch (provider) {
    case 'gemini':
    case 'openai':
    case 'anthropic':
    case 'mimo':
    case 'doubao':
    case 'deepseek':
    case 'custom':
    case 'local_llama':
      return `settings.docs_blurb_${provider}`;
    default:
      return 'settings.docs_blurb_generic';
  }
}

export function HelpSettingsTab({ activeProviderKind }: HelpSettingsTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-lg bg-app-accent/10 border border-app-accent/20 flex items-center justify-center text-app-accent shrink-0">
          <BookOpen className="w-4 h-4" />
        </div>
        <p className={BODY}>{t('settings.docs_intro')}</p>
      </div>

      {/* ── 当前服务商的配置说明 ── */}
      <section className="space-y-2">
        <p className={META_LABEL}>{t('settings.docs_heading')}</p>
        <p className={BODY}>{t(blurbKeyForProvider(activeProviderKind))}</p>
        {activeProviderKind === 'local_llama' && (
          <p className={BODY}>{t('settings.docs_local_llama_readme')}</p>
        )}
      </section>

      <div className="h-px bg-app-surface-subtle" />

      {/* ── 各服务商官方文档 ── */}
      <section className="space-y-3">
        <p className={META_LABEL}>{t('settings.docs_all_providers_heading')}</p>
        <p className={BODY}>{t('settings.docs_all_providers_intro')}</p>
        <div className="space-y-3">
          {PROVIDER_DOCS.map((group) => (
            <div key={group.titleKey}>
              <p className={SECTION_TITLE}>{t(group.titleKey)}</p>
              <DocLinksList links={group.links} />
            </div>
          ))}
          <div>
            <p className={SECTION_TITLE}>{t('settings.docs_provider_local_llama')}</p>
            <p className={`${BODY} mt-1.5`}>{t('settings.docs_local_llama_readme')}</p>
          </div>
        </div>
      </section>

      <div className="h-px bg-app-surface-subtle" />

      {/* ── 搜索服务 ── */}
      <section className="space-y-2">
        <p className={META_LABEL}>{t('settings.docs_search_heading')}</p>
        <p className={BODY}>{t('settings.docs_search_blurb')}</p>
        <DocLinksList links={METASO_DOC_LINKS} />
        <ul className="space-y-1.5">
          {SEARCH_PROVIDERS.map((provider) => (
            <li key={provider.kind}>
              <a
                href={provider.consoleUrl}
                role="link"
                className="inline-flex items-center gap-1 text-[11px] text-[#1d4ed8] hover:underline break-all cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(provider.consoleUrl);
                }}
              >
                <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                {t('settings.search_get_key', { name: provider.label })}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className="h-px bg-app-surface-subtle" />

      {/* ── 功能帮助 ── */}
      <section className="space-y-4">
        <p className={META_LABEL}>{t('settings.help_features_heading')}</p>
        {FEATURE_SECTIONS.map((section) => (
          <div key={section.titleKey} className="space-y-1.5">
            <p className={SECTION_TITLE}>{t(section.titleKey)}</p>
            <ul className="space-y-1 pl-4 list-disc marker:text-app-text-faint">
              {section.bodyKeys.map((key) => (
                <li key={key} className={BODY}>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="text-[10px] text-app-text-faint leading-relaxed">
        {t('settings.docs_security_note')}
      </p>
    </div>
  );
}
