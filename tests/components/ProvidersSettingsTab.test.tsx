import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { ProvidersSettingsTab } from '../../src/components/settings/ProvidersSettingsTab';
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

const EMPTY: AIConfigV2 = {
  version: 2,
  providers: [],
  activeChat: { providerId: '', modelId: '' },
};

const CC_SWITCH_JSON = JSON.stringify({
  version: 3,
  apps: {
    claude: {
      providers: {
        a: {
          id: 'a',
          name: '中转站',
          settingsConfig: {
            env: {
              ANTHROPIC_AUTH_TOKEN: 'sk-imported',
              ANTHROPIC_BASE_URL: 'https://relay.example.com',
            },
          },
        },
      },
    },
  },
});

/** 用隐藏的 file input 上传，`userEvent.upload` 找它要用 hidden 选项。 */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not rendered');
  return input as HTMLInputElement;
}

describe('ProvidersSettingsTab —— cc-switch 导入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('读出配置文件里的服务商并交给 onChange', async () => {
    const onChange = vi.fn();
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    await userEvent.upload(
      fileInput(),
      new File([CC_SWITCH_JSON], 'config.json', { type: 'application/json' }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as AIConfigV2;
    expect(next.providers).toHaveLength(1);
    expect(next.providers[0]).toMatchObject({
      kind: 'anthropic',
      apiKey: 'sk-imported',
      baseUrl: 'https://relay.example.com',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('settings.ccswitch_result');
  });

  it('文件不是 JSON 时给出提示，且不改配置', async () => {
    const onChange = vi.fn();
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    await userEvent.upload(
      fileInput(),
      new File(['not json at all'], 'config.json', { type: 'application/json' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent('settings.ccswitch_bad_json');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('合法 JSON 但认不出服务商时说清楚，而不是静默无反应', async () => {
    const onChange = vi.fn();
    render(<ProvidersSettingsTab config={EMPTY} onChange={onChange} />);

    await userEvent.upload(
      fileInput(),
      new File([JSON.stringify({ hello: 'world' })], 'config.json', {
        type: 'application/json',
      }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent('settings.ccswitch_none');
    expect(onChange).not.toHaveBeenCalled();
  });
});
