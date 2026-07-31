import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageNode } from '../../src/components/nodes/ImageNode';
import { VideoNode } from '../../src/components/nodes/VideoNode';
import type { CanvasNode } from '../../src/db';

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

const base = (extra: Partial<CanvasNode>): CanvasNode => ({
  id: 'n1',
  type: 'image',
  x: 0,
  y: 0,
  ...extra,
});

const props = (node: CanvasNode) => ({
  node,
  editingNodeId: null,
  setEditingNodeId: vi.fn(),
});

describe('ImageNode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('有 filePath 时走 spoor-media 协议', () => {
    render(<ImageNode {...props(base({ filePath: 'media/uploaded/a.png' }))} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'http://spoor-media.localhost/media/uploaded/a.png',
    );
  });

  it('只有旧的 content（data URL）时照常显示', () => {
    render(<ImageNode {...props(base({ content: 'data:image/png;base64,X' }))} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,X');
  });

  it('filePath 优先于 content', () => {
    render(
      <ImageNode
        {...props(base({ filePath: 'media/uploaded/a.png', content: 'data:image/png;base64,X' }))}
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'http://spoor-media.localhost/media/uploaded/a.png',
    );
  });

  it('两者皆空时显示占位而不是空 img', () => {
    render(<ImageNode {...props(base({}))} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('nodes.media_missing')).toBeInTheDocument();
  });

  it('加载失败（文件被删）时切成占位，不留破图', () => {
    render(
      <ImageNode {...props(base({ filePath: 'media/uploaded/gone.png', fileName: '旧图.png' }))} />,
    );
    fireEvent.error(screen.getByRole('img'));

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('nodes.media_missing')).toBeInTheDocument();
    expect(screen.getByText('旧图.png')).toBeInTheDocument();
  });

  it('占位没有 fileName 时回落到 description', () => {
    render(<ImageNode {...props(base({ description: '会议白板.png' }))} />);
    expect(screen.getByText('会议白板.png')).toBeInTheDocument();
  });

  it('普通图片卡有类型标题，且没有「查看详情」入口', () => {
    render(<ImageNode {...props(base({ filePath: 'media/uploaded/a.png' }))} />);
    expect(screen.getByText('nodes.image_label')).toBeInTheDocument();
    expect(screen.queryByLabelText('imagegen.meta_view')).toBeNull();
  });

  it('生图结果卡标题为「结果」并给出「查看详情」', () => {
    render(
      <ImageNode
        {...props(
          base({
            filePath: 'media/generated/x.png',
            imageGenMeta: {
              prompt: '一只在雨里的猫',
              providerName: 'Provider',
              modelName: 'Model 1',
              size: '1024x1024',
              refPaths: [],
              createdAt: 0,
            },
          }),
        )}
      />,
    );
    expect(screen.getByText('nodes.image_result_label')).toBeInTheDocument();
    expect(screen.getByLabelText('imagegen.meta_view')).toBeInTheDocument();
  });

  it('点「查看详情」弹出生成详情，含提示词与模型', () => {
    render(
      <ImageNode
        {...props(
          base({
            filePath: 'media/generated/x.png',
            imageGenMeta: {
              prompt: '一只在雨里的猫',
              providerName: 'Provider',
              modelName: 'Model 1',
              size: '1024x1024',
              refPaths: ['media/uploaded/ref.png'],
              createdAt: 0,
            },
          }),
        )}
      />,
    );
    fireEvent.click(screen.getByLabelText('imagegen.meta_view'));
    expect(screen.getByText('imagegen.meta_title')).toBeInTheDocument();
    expect(screen.getByText('一只在雨里的猫')).toBeInTheDocument();
    expect(screen.getByText('Model 1')).toBeInTheDocument();
    expect(screen.getByText('imagegen.meta_refs')).toBeInTheDocument();
  });
});

describe('VideoNode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('有 filePath 时走 spoor-media 协议（Range 由 Rust 侧支持）', () => {
    const { container } = render(
      <VideoNode {...props(base({ type: 'video', filePath: 'media/uploaded/v.mp4' }))} />,
    );
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'http://spoor-media.localhost/media/uploaded/v.mp4',
    );
  });

  it('加载失败时显示占位', () => {
    const { container } = render(
      <VideoNode {...props(base({ type: 'video', filePath: 'media/uploaded/gone.mp4' }))} />,
    );
    fireEvent.error(container.querySelector('video')!);

    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('nodes.media_missing')).toBeInTheDocument();
  });

  it('两者皆空时显示占位', () => {
    const { container } = render(<VideoNode {...props(base({ type: 'video' }))} />);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('nodes.media_missing')).toBeInTheDocument();
  });
});
