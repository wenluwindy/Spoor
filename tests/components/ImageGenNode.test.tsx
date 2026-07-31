import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageGenNode } from '../../src/components/nodes/ImageGenNode';
import type { CanvasNode } from '../../src/db';
import type { AIConfigV2 } from '../../src/types/aiConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

/**
 * 一个带尺寸预设的服务商，和一个不带预设的（对应 Gemini / 自定义端点）。
 * 传数组可指定预设内容——RightAPI 给的是宽高比而不是像素。
 */
function makeConfig(withSizeOptions: boolean | string[]): AIConfigV2 {
  const sizeOptions = Array.isArray(withSizeOptions)
    ? withSizeOptions
    : withSizeOptions
      ? ['1024x1024', '2048x2048']
      : undefined;
  return {
    version: 2,
    activeChat: null,
    providers: [
      {
        id: 'p1',
        kind: 'doubao',
        name: 'Provider',
        apiKey: 'k',
        baseUrl: 'https://example.com',
        chatModels: [],
        imageModels: [
          {
            id: 'm1',
            modelName: 'model-1',
            label: 'Model 1',
            capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
            ...(sizeOptions ? { sizeOptions } : {}),
            defaultParams: { n: 1 },
          },
        ],
      },
    ],
  } as unknown as AIConfigV2;
}

const genNode = (extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'gen',
  canvasId: 'c1',
  type: 'imagegen',
  x: 0,
  y: 0,
  imageGenProviderId: 'p1',
  imageGenModelId: 'm1',
  ...extra,
});

const textNode: CanvasNode = {
  id: 'txt',
  canvasId: 'c1',
  type: 'text',
  content: '一只在雨里的猫',
  x: 0,
  y: 0,
};

function renderNode(opts: {
  withSizeOptions?: boolean | string[];
  upstreamText?: boolean;
  node?: Partial<CanvasNode>;
  onPatch?: (patch: Partial<CanvasNode>) => void;
} = {}) {
  const nodes = opts.upstreamText ? [genNode(opts.node), textNode] : [genNode(opts.node)];
  const edges = opts.upstreamText ? [{ from: 'txt', to: 'gen' }] : [];
  return render(
    <ImageGenNode
      node={genNode(opts.node)}
      aiConfig={makeConfig(opts.withSizeOptions ?? false)}
      nodes={nodes}
      edges={edges}
      isGenerating={false}
      onGenerate={vi.fn()}
      onCancel={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn()}
      onDeleteResult={vi.fn()}
      onSetActiveIndex={vi.fn()}
    />,
  );
}

describe('ImageGenNode 尺寸控件', () => {
  it('模型没有预设尺寸时也给出宽高输入（此前这一栏整个不渲染）', () => {
    renderNode({ withSizeOptions: false });
    expect(screen.getByLabelText('imagegen.size_width')).toBeInTheDocument();
    expect(screen.getByLabelText('imagegen.size_height')).toBeInTheDocument();
  });

  it('有预设尺寸时给下拉，且带一个「自定义」选项', () => {
    renderNode({ withSizeOptions: true });
    const select = screen.getByLabelText('imagegen.size') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('1024x1024');
    expect(values).toContain('2048x2048');
    expect(values.some((v) => v.includes('custom'))).toBe(true);
  });

  it('预设是宽高比时不给「自定义」——那一档只能产出服务端不认的像素串', () => {
    renderNode({ withSizeOptions: ['1:1', '16:9', '9:16', '4:3'] });

    const select = screen.getByLabelText('imagegen.size') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['1:1', '16:9', '9:16', '4:3']);
    expect(screen.queryByLabelText('imagegen.size_width')).not.toBeInTheDocument();
  });

  it('比例预设下选中项写回的就是比例本身', () => {
    const onPatch = vi.fn();
    renderNode({ withSizeOptions: ['1:1', '16:9'], onPatch });

    fireEvent.change(screen.getByLabelText('imagegen.size'), { target: { value: '16:9' } });

    expect(onPatch).toHaveBeenCalledWith({ imageGenParams: { size: '16:9' } });
  });

  it('改宽度时以 "宽x高" 写回 imageGenParams', () => {
    const onPatch = vi.fn();
    renderNode({ withSizeOptions: false, node: { imageGenParams: { size: '1024x1024' } }, onPatch });

    fireEvent.change(screen.getByLabelText('imagegen.size_width'), { target: { value: '1920' } });

    expect(onPatch).toHaveBeenCalledWith({ imageGenParams: { size: '1920x1024' } });
  });

  it('无预设时给出四个常用比例快捷项', () => {
    renderNode({ withSizeOptions: false });
    // mock 的 t 不做插值，四个按钮的 aria-label 相同，按数量断言
    expect(screen.getAllByLabelText('imagegen.size_ratio')).toHaveLength(4);
    expect(screen.getByText('16:9')).toBeInTheDocument();
  });

  it('点比例快捷项按长边换算出新尺寸', () => {
    const onPatch = vi.fn();
    renderNode({ withSizeOptions: false, node: { imageGenParams: { size: '1024x1024' } }, onPatch });

    fireEvent.click(screen.getByText('16:9'));

    expect(onPatch).toHaveBeenCalledWith({ imageGenParams: { size: '1024x576' } });
  });
});

describe('ImageGenNode 提示词框', () => {
  it('没有上游文本时提示词框常显——那是唯一的输入口', () => {
    renderNode({ upstreamText: false });
    expect(screen.getByLabelText('imagegen.prompt')).toBeInTheDocument();
  });

  it('上游连了文本卡时默认收起提示词框', () => {
    renderNode({ upstreamText: true });
    expect(screen.queryByLabelText('imagegen.prompt')).toBeNull();
    expect(screen.getByText('imagegen.upstream_as_prompt')).toBeInTheDocument();
  });

  it('点「补充提示词」后展开', () => {
    renderNode({ upstreamText: true });
    fireEvent.click(screen.getByText('imagegen.prompt_expand'));
    expect(screen.getByLabelText('imagegen.prompt')).toBeInTheDocument();
  });
});
