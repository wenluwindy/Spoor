import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CanvasHistoryPopover } from '../../src/components/CanvasHistoryPopover';
import type { Canvas } from '../../src/db';

const confirmMock = vi.hoisted(() => vi.fn());
const deleteCanvasWithContents = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${opts.name}` : key,
    i18n: { language: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

// 只换掉 useAppDialog：tests/testing-library.tsx 会用真的 AppDialogProvider 包一层
vi.mock('../../src/components/AppDialogProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/AppDialogProvider')>()),
  useAppDialog: () => ({ confirm: confirmMock, alert: vi.fn() }),
}));

vi.mock('../../src/services/canvasRepository', () => ({ deleteCanvasWithContents }));

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
  render(
    <CanvasHistoryPopover
      canvases={CANVASES}
      activeCanvasId="default"
      setActiveCanvasId={setActiveCanvasId}
      {...props}
    />,
  );
  return { setActiveCanvasId };
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
