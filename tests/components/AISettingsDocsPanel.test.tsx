import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AISettingsDocsPanel } from '../../src/components/AISettingsDocsPanel';
import { GEMINI_DOC_LINKS } from '../../src/constants/aiProviderDocs';

const openExternalMock = vi.fn();

vi.mock('../../src/utils/openExternal', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('lucide-react', () => ({
  BookOpen: () => null,
  ExternalLink: () => null,
}));

describe('AISettingsDocsPanel', () => {
  beforeEach(() => {
    openExternalMock.mockClear();
  });

  it('渲染配置说明标题与展开/收起文案', () => {
    render(<AISettingsDocsPanel provider="gemini" />);
    expect(screen.getByText('settings.docs_heading')).toBeInTheDocument();
    expect(screen.getByText('settings.docs_expand')).toBeInTheDocument();
  });

  it('gemini 提供商显示对应说明与官方链接', () => {
    render(<AISettingsDocsPanel provider="gemini" />);
    expect(screen.getByText('settings.docs_blurb_gemini')).toBeInTheDocument();
    expect(screen.getByText('settings.docs_official_links')).toBeInTheDocument();
    for (const link of GEMINI_DOC_LINKS) {
      expect(screen.getAllByText(link.labelKey).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('点击文档链接调用 openExternalUrl', async () => {
    const user = userEvent.setup();
    render(<AISettingsDocsPanel provider="gemini" />);
    const anchor = screen.getAllByRole('link').find((el) => el.getAttribute('href') === GEMINI_DOC_LINKS[0].href);
    expect(anchor).toBeDefined();
    await user.click(anchor!);
    expect(openExternalMock).toHaveBeenCalledWith(GEMINI_DOC_LINKS[0].href);
  });

  it('local_llama 显示本地模型 readme 说明', () => {
    render(<AISettingsDocsPanel provider="local_llama" />);
    expect(screen.getByText('settings.docs_blurb_local_llama')).toBeInTheDocument();
    expect(screen.getAllByText('settings.docs_local_llama_readme').length).toBeGreaterThanOrEqual(1);
  });

  it('展示全部服务商文档分区标题', () => {
    render(<AISettingsDocsPanel provider="openai" />);
    expect(screen.getByText('settings.docs_all_providers_heading')).toBeInTheDocument();
    expect(screen.getByText('settings.docs_provider_gemini')).toBeInTheDocument();
    expect(screen.getByText('settings.docs_metaso_heading')).toBeInTheDocument();
  });
});
