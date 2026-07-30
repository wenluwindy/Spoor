import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acceptToDialogFilters, pickFiles } from '../../src/utils/filePicker';

const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));
const open = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/isTauriRuntime', () => ({ isTauriRuntime }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }));

describe('acceptToDialogFilters', () => {
  it('展开 image/* 通配', () => {
    const [filter] = acceptToDialogFilters('image/*');
    expect(filter.extensions).toContain('png');
    expect(filter.extensions).toContain('jpg');
    expect(filter.extensions).toContain('webp');
  });

  it('展开 video/* 通配', () => {
    const [filter] = acceptToDialogFilters('video/*');
    expect(filter.extensions).toContain('mp4');
    expect(filter.extensions).toContain('mov');
  });

  it('点号扩展名去掉点', () => {
    expect(acceptToDialogFilters('.docx,.txt,.md')[0].extensions).toEqual(['docx', 'txt', 'md']);
  });

  it('混合 accept 合并且去重', () => {
    const [filter] = acceptToDialogFilters('image/*,.png,.docx');
    expect(filter.extensions.filter((e) => e === 'png')).toHaveLength(1);
    expect(filter.extensions).toContain('docx');
  });

  it('空 accept 得到空过滤器（对话框显示全部文件）', () => {
    expect(acceptToDialogFilters('')).toEqual([]);
    expect(acceptToDialogFilters('  ,  ')).toEqual([]);
  });
});

describe('pickFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it('桌面端返回绝对路径而不是 File', async () => {
    open.mockResolvedValue(['D:\\a.png', 'D:\\b.png']);
    const picked = await pickFiles('image/*');
    expect(picked).toEqual({ kind: 'paths', paths: ['D:\\a.png', 'D:\\b.png'] });
  });

  it('单选时把字符串包成数组', async () => {
    open.mockResolvedValue('D:\\a.png');
    expect(await pickFiles('image/*', false)).toEqual({ kind: 'paths', paths: ['D:\\a.png'] });
  });

  it('用户取消得到空路径列表', async () => {
    open.mockResolvedValue(null);
    expect(await pickFiles('image/*')).toEqual({ kind: 'paths', paths: [] });
  });

  it('accept 被转成对话框过滤器', async () => {
    open.mockResolvedValue(null);
    await pickFiles('.docx,.txt', true);
    expect(open).toHaveBeenCalledWith({
      multiple: true,
      filters: [{ name: 'files', extensions: ['docx', 'txt'] }],
    });
  });

  it('原生对话框抛错时退回 <input>，不让「插入图片」整个失效', async () => {
    open.mockRejectedValue(new Error('plugin missing'));
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(function (this: HTMLInputElement) {
        // 立刻按「未选择」结束，免得等 400ms 宽限期
        this.dispatchEvent(new Event('change'));
      });

    const picked = await pickFiles('image/*');
    expect(picked.kind).toBe('files');
    clickSpy.mockRestore();
  });

  it('浏览器（非桌面端）直接走 <input>', async () => {
    isTauriRuntime.mockReturnValue(false);
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(function (this: HTMLInputElement) {
        this.dispatchEvent(new Event('change'));
      });

    const picked = await pickFiles('image/*');
    expect(picked).toEqual({ kind: 'files', files: [] });
    expect(open).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
