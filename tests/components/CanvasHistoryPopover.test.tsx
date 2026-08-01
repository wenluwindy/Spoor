import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CanvasHistoryPopover } from '../../src/components/CanvasHistoryPopover';
import type { Canvas } from '../../src/db';

const confirmMock = vi.hoisted(() => vi.fn());
const alertMock = vi.hoisted(() => vi.fn());
const deleteCanvasWithContents = vi.hoisted(() => vi.fn());
const exportCanvasToFile = vi.hoisted(() => vi.fn());
const importCanvasFromFile = vi.hoisted(() => vi.fn());
const exportCanvasAsMarkdown = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${opts.name}` : key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
  // 组件现在经 canvasPortability → aiI18n 拉到 src/i18n，那里要 use(initReactI18next)
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

// 只换掉 useAppDialog：tests/testing-library.tsx 会用真的 AppDialogProvider 包一层
vi.mock('../../src/components/AppDialogProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/AppDialogProvider')>()),
  useAppDialog: () => ({ confirm: confirmMock, alert: alertMock }),
}));

vi.mock('../../src/services/canvasRepository', () => ({ deleteCanvasWithContents }));

vi.mock('../../src/services/canvasPortability', () => ({
  exportCanvasToFile,
  exportCanvasAsMarkdown,
  importCanvasFromFile,
}));

vi.mock('../../src/db', () => ({
  db: { canvases: { update: vi.fn(), add: vi.fn() } },
}));

const CANVASES: Canvas[] = [
  { id: 'default', name: '默认画布', createdAt: 1, updatedAt: 1 },
  { id: 'c2', name: '第二张', createdAt: 2, updatedAt: 2 },
];

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'canvas.history' }));
}

function renderPopover(props: Partial<React.ComponentProps<typeof CanvasHistoryPopover>> = {}) {
  const setActiveCanvasId = vi.fn();
  const onExportImage = vi.fn();
  render(
    <CanvasHistoryPopover
      canvases={CANVASES}
      activeCanvasId="default"
      setActiveCanvasId={setActiveCanvasId}
      onExportImage={onExportImage}
      {...props}
    />,
  );
  return { setActiveCanvasId, onExportImage };
}

describe('CanvasHistoryPopover 删除画布', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    deleteCanvasWithContents.mockResolvedValue(undefined);
  });

  it('每张画布都有删除按钮', async () => {
    const user = userEvent.setup();
    renderPopover();
    await openPopover(user);
    expect(screen.getAllByRole('button', { name: 'canvas.delete_canvas' })).toHaveLength(2);
  });

  it('先弹确认再删，确认文案带画布名且标为危险操作', async () => {
    const user = userEvent.setup();
    renderPopover();
    await openPopover(user);

    await user.click(screen.getAllByRole('button', { name: 'canvas.delete_canvas' })[1]);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0][0]).toMatchObject({
      message: 'canvas.delete_canvas_confirm:第二张',
      variant: 'danger',
    });
    await waitFor(() => expect(deleteCanvasWithContents).toHaveBeenCalledWith('c2'));
  });

  it('取消确认就不删', async () => {
    const user = userEvent.setup();
    confirmMock.mockResolvedValue(false);
    renderPopover();
    await openPopover(user);

    await user.click(screen.getAllByRole('button', { name: 'canvas.delete_canvas' })[1]);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(deleteCanvasWithContents).not.toHaveBeenCalled());
  });

  it('删当前画布时先切到另一张，不会停在已删的画布上', async () => {
    const user = userEvent.setup();
    const { setActiveCanvasId } = renderPopover({ activeCanvasId: 'c2' });
    await openPopover(user);

    await user.click(screen.getAllByRole('button', { name: 'canvas.delete_canvas' })[1]);

    await waitFor(() => expect(setActiveCanvasId).toHaveBeenCalledWith('default'));
    expect(deleteCanvasWithContents).toHaveBeenCalledWith('c2');
  });

  it('删非当前画布时不切换', async () => {
    const user = userEvent.setup();
    const { setActiveCanvasId } = renderPopover({ activeCanvasId: 'default' });
    await openPopover(user);

    await user.click(screen.getAllByRole('button', { name: 'canvas.delete_canvas' })[1]);

    await waitFor(() => expect(deleteCanvasWithContents).toHaveBeenCalled());
    expect(setActiveCanvasId).not.toHaveBeenCalled();
  });

  it('只剩一张画布时禁用删除，点了也不弹确认', async () => {
    const user = userEvent.setup();
    renderPopover({ canvases: [CANVASES[0]] });
    await openPopover(user);

    const btn = screen.getByRole('button', { name: 'canvas.delete_canvas_last' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');

    await user.click(btn);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(deleteCanvasWithContents).not.toHaveBeenCalled();
  });

  it('删除按钮不会顺带切换到该画布', async () => {
    const user = userEvent.setup();
    const { setActiveCanvasId } = renderPopover({ activeCanvasId: 'default' });
    await openPopover(user);

    await user.click(screen.getAllByRole('button', { name: 'canvas.delete_canvas' })[1]);
    await waitFor(() => expect(deleteCanvasWithContents).toHaveBeenCalled());
    expect(setActiveCanvasId).not.toHaveBeenCalledWith('c2');
  });

  it('重命名按钮仍在', async () => {
    const user = userEvent.setup();
    renderPopover();
    await openPopover(user);
    expect(screen.getAllByRole('button', { name: 'canvas.rename' })).toHaveLength(2);
  });
});

describe('CanvasHistoryPopover 导入导出', () => {
  const NO_DEGRADATION = { links: 0, groups: 0, skipped: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    exportCanvasToFile.mockResolvedValue(true);
    exportCanvasAsMarkdown.mockResolvedValue(null);
    importCanvasFromFile.mockResolvedValue(null);
  });

  it('导出的是当前画布，并带上它的名字', async () => {
    const user = userEvent.setup();
    renderPopover({ activeCanvasId: 'c2' });
    await openPopover(user);

    await user.click(screen.getByText('canvas.export_json_canvas'));

    await waitFor(() => expect(exportCanvasToFile).toHaveBeenCalledWith('c2', '第二张'));
  });

  it('导入成功后切到新画布并报出节点数', async () => {
    const user = userEvent.setup();
    importCanvasFromFile.mockResolvedValue({
      canvasId: 'imported',
      canvasName: '别处来的',
      nodeCount: 12,
      edgeCount: 3,
      degraded: NO_DEGRADATION,
    });
    const { setActiveCanvasId } = renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.import_json_canvas'));

    await waitFor(() => expect(setActiveCanvasId).toHaveBeenCalledWith('imported'));
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(String(alertMock.mock.calls[0][0].message)).toContain('canvas.import_done');
    expect(String(alertMock.mock.calls[0][0].message)).not.toContain('canvas.import_degraded');
  });

  it('有降级时一并说明，不静默丢数据', async () => {
    const user = userEvent.setup();
    importCanvasFromFile.mockResolvedValue({
      canvasId: 'imported',
      canvasName: 'x',
      nodeCount: 3,
      edgeCount: 0,
      degraded: { links: 1, groups: 2, skipped: 0 },
    });
    renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.import_json_canvas'));

    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(String(alertMock.mock.calls[0][0].message)).toContain('canvas.import_degraded');
  });

  it('用户在文件对话框里取消时不提示、不切画布', async () => {
    const user = userEvent.setup();
    const { setActiveCanvasId } = renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.import_json_canvas'));

    await waitFor(() => expect(importCanvasFromFile).toHaveBeenCalled());
    expect(alertMock).not.toHaveBeenCalled();
    expect(setActiveCanvasId).not.toHaveBeenCalled();
  });

  it('文件格式不对时给一条明确的提示', async () => {
    const user = userEvent.setup();
    importCanvasFromFile.mockRejectedValue(new Error('invalid_json_canvas'));
    const { setActiveCanvasId } = renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.import_json_canvas'));

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith({ message: 'canvas.import_failed' }));
    expect(setActiveCanvasId).not.toHaveBeenCalled();
  });

  it('导出 Markdown 包走的也是当前画布', async () => {
    const user = userEvent.setup();
    renderPopover({ activeCanvasId: 'c2' });
    await openPopover(user);

    await user.click(screen.getByText('canvas.export_markdown'));

    await waitFor(() =>
      expect(exportCanvasAsMarkdown).toHaveBeenCalledWith('c2', '第二张', expect.any(Date)),
    );
  });

  it('有原件没能复制出来时说一声', async () => {
    const user = userEvent.setup();
    exportCanvasAsMarkdown.mockResolvedValue({
      directory: 'D:/x',
      assetsCopied: 2,
      assetsMissing: 3,
    });
    renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.export_markdown'));

    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(alertMock.mock.calls[0][0].message).toBe('canvas.export_markdown_missing');
  });

  it('全部原件都复制成功时不打扰', async () => {
    const user = userEvent.setup();
    exportCanvasAsMarkdown.mockResolvedValue({
      directory: 'D:/x',
      assetsCopied: 2,
      assetsMissing: 0,
    });
    renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.export_markdown'));

    await waitFor(() => expect(exportCanvasAsMarkdown).toHaveBeenCalled());
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('导出 PNG 交给 App（它才够得着画布 DOM）并收起面板', async () => {
    const user = userEvent.setup();
    const { onExportImage } = renderPopover();
    await openPopover(user);

    await user.click(screen.getByText('canvas.export_image'));

    expect(onExportImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('canvas.export_image')).not.toBeInTheDocument();
  });
});
