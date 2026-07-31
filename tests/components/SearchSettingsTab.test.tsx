import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { SearchSettingsTab } from '../../src/components/settings/SearchSettingsTab';
import type { AIConfigV2 } from '../../src/types/aiConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
    i18n: { language: 'zh' },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/openExternal', () => ({ openExternalUrl }));

function baseConfig(patch: Partial<AIConfigV2> = {}): AIConfigV2 {
  return {
    version: 2,
    providers: [],
    activeChat: { providerId: '', modelId: '' },
    ...patch,
  };
}

function renderTab(config: AIConfigV2) {
  const onChange = vi.fn();
  render(<SearchSettingsTab config={config} onChange={onChange} />);
  return onChange;
}

describe('SearchSettingsTab', () => {
  it('每家都给一个独立的 Key 输入框', () => {
    renderTab(baseConfig());
    expect(screen.getByLabelText(/settings\.search_key_label.*Metaso/)).toBeInTheDocument();
    expect(screen.getByLabelText(/settings\.search_key_label.*Tavily/)).toBeInTheDocument();
  });

  it('缺省启用秘塔', () => {
    renderTab(baseConfig());
    expect(screen.getByRole('button', { name: 'Metaso' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tavily' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('切换启用的服务只改 searchProvider', async () => {
    const onChange = renderTab(baseConfig({ searchApiKeys: { metaso: 'mk' } }));

    await userEvent.click(screen.getByRole('button', { name: 'Tavily' }));

    const next = onChange.mock.calls[0][0] as AIConfigV2;
    expect(next.searchProvider).toBe('tavily');
    // 切换不该把已填的 Key 冲掉
    expect(next.searchApiKeys).toEqual({ metaso: 'mk' });
  });

  it('各家的 Key 各存各的', async () => {
    const onChange = renderTab(baseConfig({ searchApiKeys: { metaso: 'mk' } }));

    await userEvent.type(screen.getByLabelText(/settings\.search_key_label.*Tavily/), 't');

    const next = onChange.mock.calls[0][0] as AIConfigV2;
    expect(next.searchApiKeys).toEqual({ metaso: 'mk', tavily: 't' });
  });

  it('已存的 Key 回填到对应的框里', () => {
    renderTab(baseConfig({ searchApiKeys: { metaso: 'mk', tavily: 'tvly-x' } }));
    expect(screen.getByLabelText(/settings\.search_key_label.*Metaso/)).toHaveValue('mk');
    expect(screen.getByLabelText(/settings\.search_key_label.*Tavily/)).toHaveValue('tvly-x');
  });

  it('申请 Key 的链接走系统浏览器，不在 webview 里打开', async () => {
    renderTab(baseConfig());

    await userEvent.click(screen.getByRole('link', { name: /Tavily/ }));

    expect(openExternalUrl).toHaveBeenCalledWith('https://app.tavily.com/home');
  });
});
