import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { ProvidersSettingsTab } from '../../src/components/settings/ProvidersSettingsTab';
import type { AIConfigV2 } from '../../src/types/aiConfig';

const readCcSwitchConfig = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/ccSwitchConfig', () => ({ readCcSwitchConfig }));

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

const EMPTY: AIConfigV2 = {
  version: 2,
  providers: [],
  activeChat: { providerId: '', modelId: '' },
};

const CC_SWITCH_CONFIG = {
  providers: [
    {
      appType: 'claude',
      name: '中转站',
      settingsConfig: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-imported',
          ANTHROPIC_BASE_URL: 'https://relay.example.com',
        },
      },
    },
  ],
};

describe('ProvidersSettingsTab —— cc-switch 导入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('点击后直接读取默认配置并交给 onChange，不渲染文件选择框', async () => {
    const onChange = vi.fn();
    readCcSwitchConfig.mockResolvedValue({ status: 'found', config: CC_SWITCH_CONFIG });
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'settings.ccswitch_import' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(readCcSwitchConfig).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as AIConfigV2;
    expect(next.providers).toHaveLength(1);
    expect(next.providers[0]).toMatchObject({
      kind: 'anthropic',
      apiKey: 'sk-imported',
      baseUrl: 'https://relay.example.com',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('settings.ccswitch_result');
  });

  it('数据库读取失败时给出提示，且不改配置', async () => {
    const onChange = vi.fn();
    readCcSwitchConfig.mockResolvedValue({
      status: 'read_failed',
      detail: 'database is locked',
    });
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'settings.ccswitch_import' }));

    expect(await screen.findByRole('status')).toHaveTextContent('settings.ccswitch_read_failed');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('数据库里没有可用服务商时说清楚，而不是静默无反应', async () => {
    const onChange = vi.fn();
    readCcSwitchConfig.mockResolvedValue({
      status: 'found',
      config: { providers: [] },
    });
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'settings.ccswitch_import' }));

    expect(await screen.findByRole('status')).toHaveTextContent('settings.ccswitch_none');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('未安装 CC Switch 时给出明确提示', async () => {
    const onChange = vi.fn();
    readCcSwitchConfig.mockResolvedValue({ status: 'not_installed' });
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'settings.ccswitch_import' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'settings.ccswitch_not_installed',
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
