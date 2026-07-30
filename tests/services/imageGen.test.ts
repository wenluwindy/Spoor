import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IMAGE_GEN_MAX_CONCURRENCY,
  generateImages,
  isImageGenFailure,
  pendingImageGenCount,
  resetImageGenQueue,
} from '../../src/services/imageGen';
import type { ResolvedImageModel } from '../../src/services/aiConfig';

const invoke = vi.hoisted(() => vi.fn());
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));

const target: ResolvedImageModel = {
  provider: {
    id: 'p1',
    name: '火山方舟',
    kind: 'doubao',
    apiKey: 'ark-x',
    baseUrl: 'https://ark/api/v3',
    chatModels: [],
    imageModels: [],
  },
  model: {
    id: 'm1',
    modelName: 'seedream',
    label: 'Seedream',
    capabilities: { textToImage: true, imageToImage: true, maxRefImages: 4 },
    defaultParams: { size: '2048x2048', n: 1 },
  },
  apiKind: 'doubao_seedream',
};

const params = (over: Partial<Parameters<typeof generateImages>[0]> = {}) => ({
  taskId: 't1',
  target,
  prompt: '一只猫',
  refImages: [],
  ...over,
});

describe('isImageGenFailure', () => {
  it('认带 code 的对象', () => {
    expect(isImageGenFailure({ code: 'network' })).toBe(true);
    expect(isImageGenFailure({ code: 'http_error', httpStatus: 500 })).toBe(true);
  });

  it('不认普通 Error 与空值', () => {
    expect(isImageGenFailure(new Error('x'))).toBe(false);
    expect(isImageGenFailure(null)).toBe(false);
    expect(isImageGenFailure('network')).toBe(false);
  });
});

describe('generateImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetImageGenQueue();
    isTauriRuntime.mockReturnValue(true);
    invoke.mockResolvedValue(['media/generated/2026/07/a.png']);
  });

  it('把服务商信息展开成 Rust 侧的请求参数', async () => {
    await generateImages(params({ refImages: ['media/uploaded/ref.png'] }));

    expect(invoke).toHaveBeenCalledWith('image_generate', {
      req: expect.objectContaining({
        apiKind: 'doubao_seedream',
        baseUrl: 'https://ark/api/v3',
        apiKey: 'ark-x',
        model: 'seedream',
        prompt: '一只猫',
        refImages: ['media/uploaded/ref.png'],
        taskId: 't1',
      }),
    });
  });

  it('没传尺寸时用模型的默认参数', async () => {
    await generateImages(params());
    const req = invoke.mock.calls[0][1].req;
    expect(req.size).toBe('2048x2048');
    expect(req.n).toBe(1);
  });

  it('显式参数覆盖默认', async () => {
    await generateImages(params({ size: '1024x1024', n: 2 }));
    const req = invoke.mock.calls[0][1].req;
    expect(req.size).toBe('1024x1024');
    expect(req.n).toBe(2);
  });

  it('返回相对路径数组', async () => {
    invoke.mockResolvedValue(['media/a.png', 'media/b.png']);
    expect(await generateImages(params())).toEqual(['media/a.png', 'media/b.png']);
  });

  it('非桌面端直接抛 desktop_only，不发请求', async () => {
    isTauriRuntime.mockReturnValue(false);
    const err = await generateImages(params()).catch((e) => e);
    expect(err).toEqual({ code: 'desktop_only' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('Rust 的错误码原样抛出，交给 UI 翻译', async () => {
    invoke.mockRejectedValue({ code: 'quota_exceeded', httpStatus: 429, detail: 'x' });
    const err = await generateImages(params()).catch((e) => e);
    expect(isImageGenFailure(err)).toBe(true);
    expect(err.code).toBe('quota_exceeded');
  });
});

describe('并发队列', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetImageGenQueue();
    isTauriRuntime.mockReturnValue(true);
  });

  it('超出上限的排队，不并发发出去', async () => {
    const resolvers: ((v: string[]) => void)[] = [];
    invoke.mockImplementation(() => new Promise<string[]>((resolve) => resolvers.push(resolve)));

    const total = IMAGE_GEN_MAX_CONCURRENCY + 2;
    const running = Array.from({ length: total }, (_, i) =>
      generateImages(params({ taskId: `t${i}` })),
    );

    // generateImages 里有 await acquire() 与动态 import 两道异步边界，
    // 单个微任务 tick 追不上，用 waitFor 等到稳定态
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(IMAGE_GEN_MAX_CONCURRENCY));
    expect(pendingImageGenCount()).toBe(2);

    // 放行一个，队列应补上一个
    resolvers[0](['media/a.png']);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(IMAGE_GEN_MAX_CONCURRENCY + 1));

    // 逐个放行：排在后面的要等前面腾出名额才会真正发出去
    for (let i = 1; i < total; i++) {
      await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(i));
      resolvers[i](['media/a.png']);
    }
    await Promise.all(running);

    expect(invoke).toHaveBeenCalledTimes(total);
    expect(pendingImageGenCount()).toBe(0);
  });

  it('失败也释放名额，否则一次报错会把队列永久卡死', async () => {
    invoke.mockRejectedValueOnce({ code: 'network' }).mockResolvedValue(['media/a.png']);

    await generateImages(params({ taskId: 'boom' })).catch(() => undefined);
    await generateImages(params({ taskId: 'after' }));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(pendingImageGenCount()).toBe(0);
  });
});
