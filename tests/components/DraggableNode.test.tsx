import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { DraggableNode } from '../../src/components/canvas/DraggableNode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'canvas.port_in': 'PortIn',
        'canvas.port_out': 'PortOut',
        'canvas.delete_note': 'Delete',
        'canvas.cycle_layout': 'Layout',
        'canvas.select_note': 'Select',
      }[key] ?? key),
  }),
}));

function renderNode(props: Partial<React.ComponentProps<typeof DraggableNode>> = {}) {
  const nodesRef = createRef<Record<string, HTMLElement | null>>();
  nodesRef.current = {};
  return render(
    <DraggableNode
      id="n1"
      nodesRef={nodesRef as React.MutableRefObject<Record<string, HTMLElement | null>>}
      isConnecting={false}
      onLink={vi.fn()}
      onDelete={vi.fn()}
      onToggleSelect={vi.fn()}
      isSelected
      {...props}
    >
      <div>Note body</div>
    </DraggableNode>
  );
}

describe('DraggableNode', () => {
  it('编辑态隐藏进出端口、删除、缩放手柄与选择圈（避免 group-hover 再次点亮）', () => {
    renderNode({ isEditing: true, isSelected: true });

    for (const port of ['PortIn', 'PortOut']) {
      expect(screen.getByLabelText(port)).toHaveClass('pointer-events-none');
      expect(screen.getByLabelText(port)).toHaveClass('!opacity-0');
    }
    const bottomBar = screen.getByLabelText('Delete').parentElement;
    expect(bottomBar).toHaveClass('pointer-events-none');
    expect(bottomBar).toHaveClass('!opacity-0');
    expect(screen.getByLabelText('Select')).toHaveClass('pointer-events-none');

    const resize = document.querySelector('.cursor-nwse-resize');
    expect(resize).toBeTruthy();
    expect(resize).toHaveClass('pointer-events-none');
    expect(resize).toHaveClass('!opacity-0');
  });

  it('非编辑且选中时进出端口常态可见', () => {
    renderNode({ isEditing: false, isSelected: true });
    for (const port of ['PortIn', 'PortOut']) {
      expect(screen.getByLabelText(port)).toHaveClass('opacity-100');
      expect(screen.getByLabelText(port)).not.toHaveClass('pointer-events-none');
    }
  });

  it('编辑态不显示选中描边 ring', () => {
    const { container } = renderNode({ isEditing: true, isSelected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('ring-2');
  });

  it('非编辑且选中时显示 ring', () => {
    const { container } = renderNode({ isEditing: false, isSelected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });

  describe('仅主键触发拖拽（右键留给上下文菜单）', () => {
    it('左键按下并移动会拖走节点', () => {
      const { container } = renderNode({ initialX: 100, initialY: 50 });
      const root = container.firstElementChild as HTMLElement;

      fireEvent.pointerDown(root, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { clientX: 200, clientY: 30 });

      expect(root.style.left).toBe('300px');
      expect(root.style.top).toBe('80px');
    });

    it('右键按下并移动不会拖走节点', () => {
      const { container } = renderNode({ initialX: 100, initialY: 50 });
      const root = container.firstElementChild as HTMLElement;

      fireEvent.pointerDown(root, { button: 2, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { clientX: 200, clientY: 30 });

      expect(root.style.left).toBe('100px');
      expect(root.style.top).toBe('50px');
    });

    it('右键按下不触发连线', () => {
      const onLink = vi.fn();
      const { container } = renderNode({ isConnecting: true, onLink });
      const root = container.firstElementChild as HTMLElement;

      fireEvent.pointerDown(root, { button: 2 });
      expect(onLink).not.toHaveBeenCalled();

      fireEvent.pointerDown(root, { button: 0 });
      expect(onLink).toHaveBeenCalledWith('n1');
    });

    it('右键按下不改变 Ctrl+C 的便签焦点', () => {
      const onStickyActivate = vi.fn();
      const { container } = renderNode({ onStickyActivate });
      const root = container.firstElementChild as HTMLElement;

      fireEvent.pointerDown(root, { button: 2 });
      expect(onStickyActivate).not.toHaveBeenCalled();

      fireEvent.pointerDown(root, { button: 0 });
      expect(onStickyActivate).toHaveBeenCalledWith('n1');
    });
  });
});
