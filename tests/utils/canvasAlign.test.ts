import { describe, it, expect } from 'vitest';
import { alignNodes, distributeNodes, type AlignableNode } from '../../src/utils/canvasAlign';

const n = (id: string, x: number, y: number, width = 100, height = 50): AlignableNode => ({
  id, x, y, width, height,
});

describe('alignNodes', () => {
  it('少于两张不动', () => {
    expect(alignNodes([n('a', 0, 0)], 'left')).toEqual([]);
  });

  it('左对齐：全部对到选区最左缘，纵坐标不动', () => {
    const patches = alignNodes([n('a', 10, 0), n('b', 50, 30)], 'left');
    expect(patches).toEqual([{ id: 'b', x: 10, y: 30 }]);
  });

  it('右对齐按各自宽度补偿', () => {
    const patches = alignNodes([n('a', 0, 0, 100), n('b', 20, 30, 60)], 'right');
    // 选区右缘 = 100；b 宽 60 → x = 40
    expect(patches).toEqual([{ id: 'b', x: 40, y: 30 }]);
  });

  it('水平居中对到选区包围盒中线', () => {
    const patches = alignNodes([n('a', 0, 0, 100), n('b', 200, 30, 100)], 'center-h');
    // 包围盒 0..300，中线 150；两张各归中
    expect(patches).toEqual([
      { id: 'a', x: 100, y: 0 },
      { id: 'b', x: 100, y: 30 },
    ]);
  });

  it('底对齐按各自高度补偿', () => {
    const patches = alignNodes([n('a', 0, 0, 100, 200), n('b', 10, 20, 100, 50)], 'bottom');
    expect(patches).toEqual([{ id: 'b', x: 10, y: 150 }]);
  });

  it('已对齐的节点不出补丁', () => {
    expect(alignNodes([n('a', 10, 0), n('b', 10, 40)], 'left')).toEqual([]);
  });
});

describe('distributeNodes', () => {
  it('少于三张不动', () => {
    expect(distributeNodes([n('a', 0, 0), n('b', 100, 0)], 'horizontal')).toEqual([]);
  });

  it('水平分布：首尾不动，中间的把间隙均分', () => {
    // a: 0..100，c: 400..500，总跨度 500，三张总宽 300 → 间隙各 100
    const patches = distributeNodes(
      [n('a', 0, 0), n('c', 400, 0), n('b', 130, 10)],
      'horizontal',
    );
    expect(patches).toEqual([{ id: 'b', x: 200, y: 10 }]);
  });

  it('垂直分布按高度算间隙', () => {
    // a: 0..50，c: 350..400，总跨度 400，三张总高 150 → 间隙各 125
    const patches = distributeNodes(
      [n('a', 0, 0), n('b', 10, 60), n('c', 0, 350)],
      'vertical',
    );
    expect(patches).toEqual([{ id: 'b', x: 10, y: 175 }]);
  });
});
