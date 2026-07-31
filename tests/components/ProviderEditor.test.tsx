import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '../testing-library';
import { ProviderEditor } from '../../src/components/settings/ProviderEditor';
import type { AIConfigV2, AIProviderProfile, ProviderKind } from '../../src/types/aiConfig';

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

function makeProvider(patch: Partial<AIProviderProfile> = {}): AIProviderProfile {
  return {
    id: 'p1',
    name: '中转站',
    kind: 'custom' as ProviderKind,
    apiKey: 'sk-x',
    baseUrl: '',
    chatModels: [{ id: 'c1', modelName: 'gpt-4o', label: 'gpt-4o' }],
    imageModels: [],
    imageApiKind: 'custom_openai_images',
    ...patch,
  };
}

function makeConfig(provider: AIProviderProfile): AIConfigV2 {
  return {
    version: 2,
    providers: [provider],
    activeChat: { providerId: provider.id, modelId: 'c1' },
  };
}

function renderEditor(provider: AIProviderProfile) {
  const onChange = vi.fn();
  const config = makeConfig(provider);
  render(
    <ProviderEditor
      config={config}
      provider={provider}
      onChange={onChange}
      onRequestDelete={vi.fn()}
    />,
  );
  return onChange;
}

describe('ProviderEditor —— 生图协议', () => {
  it('自定义端点才让选协议', () => {
    renderEditor(makeProvider());
    expect(screen.getByLabelText('settings.image_api_kind')).toBeInTheDocument();
  });

  it('协议由 kind 唯一确定的服务商不显示这个选择器', () => {
    renderEditor(makeProvider({ kind: 'openai', imageApiKind: 'openai_images' }));
    expect(screen.queryByLabelText('settings.image_api_kind')).not.toBeInTheDocument();
  });

  it('选 RightAPI 时把空着的 Base URL 补成绘图基址', async () => {
    const onChange = renderEditor(makeProvider({ baseUrl: '' }));

    await userEvent.selectOptions(
      screen.getByLabelText('settings.image_api_kind'),
      'rightapi_draw',
    );

    const next = onChange.mock.calls[0][0] as AIConfigV2;
    expect(next.providers[0].imageApiKind).toBe('rightapi_draw');
    // 是 rightapi.ai，不是 right.ai——填错域名连接会被直接断开
    expect(next.providers[0].baseUrl).toBe('https://www.rightapi.ai/draw/v1');
  });

  it('已经填过的 Base URL 不被覆盖', async () => {
    const onChange = renderEditor(makeProvider({ baseUrl: 'https://gw.internal/draw/v1' }));

    await userEvent.selectOptions(
      screen.getByLabelText('settings.image_api_kind'),
      'rightapi_draw',
    );

    const next = onChange.mock.calls[0][0] as AIConfigV2;
    expect(next.providers[0].baseUrl).toBe('https://gw.internal/draw/v1');
  });

  it('选中 RightAPI 后给出该协议的预设模型', () => {
    renderEditor(makeProvider({ imageApiKind: 'rightapi_draw' }));
    expect(screen.getByRole('button', { name: '+ Nano Banana Fast (RightAPI)' })).toBeInTheDocument();
  });
});
