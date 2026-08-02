import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireKeyboardLayer,
  isTopKeyboardLayer,
  resetKeyboardLayersForTest,
} from '../../src/services/keyboardLayers';

describe('keyboardLayers', () => {
  beforeEach(() => {
    resetKeyboardLayersForTest();
  });

  it('无人占用时 canvas 是最高层', () => {
    expect(isTopKeyboardLayer('canvas')).toBe(true);
    expect(isTopKeyboardLayer('menu')).toBe(true);
    expect(isTopKeyboardLayer('modal')).toBe(true);
  });

  it('占用一层后压住所有更低的层', () => {
    const release = acquireKeyboardLayer('menu');
    expect(isTopKeyboardLayer('menu')).toBe(true);
    expect(isTopKeyboardLayer('canvas')).toBe(false);
    // 比 menu 高的层不受影响
    expect(isTopKeyboardLayer('linkdrag')).toBe(true);
    expect(isTopKeyboardLayer('modal')).toBe(true);
    release();
    expect(isTopKeyboardLayer('canvas')).toBe(true);
  });

  it('多层叠加时只有最高的占用层与其上方为 top', () => {
    const releaseMenu = acquireKeyboardLayer('menu');
    const releaseModal = acquireKeyboardLayer('modal');
    expect(isTopKeyboardLayer('modal')).toBe(true);
    expect(isTopKeyboardLayer('search')).toBe(false);
    expect(isTopKeyboardLayer('presentation')).toBe(false);
    expect(isTopKeyboardLayer('linkdrag')).toBe(false);
    expect(isTopKeyboardLayer('menu')).toBe(false);
    expect(isTopKeyboardLayer('canvas')).toBe(false);

    releaseModal();
    expect(isTopKeyboardLayer('menu')).toBe(true);
    expect(isTopKeyboardLayer('canvas')).toBe(false);

    releaseMenu();
    expect(isTopKeyboardLayer('canvas')).toBe(true);
  });

  it('拉线压住菜单与画布，但让位给演示/搜索/对话框', () => {
    const release = acquireKeyboardLayer('linkdrag');
    expect(isTopKeyboardLayer('linkdrag')).toBe(true);
    expect(isTopKeyboardLayer('menu')).toBe(false);
    expect(isTopKeyboardLayer('canvas')).toBe(false);
    expect(isTopKeyboardLayer('presentation')).toBe(true);
    expect(isTopKeyboardLayer('search')).toBe(true);
    expect(isTopKeyboardLayer('modal')).toBe(true);
    release();
  });

  it('同层可重入：计数归零才算真正释放', () => {
    const r1 = acquireKeyboardLayer('modal');
    const r2 = acquireKeyboardLayer('modal');
    expect(isTopKeyboardLayer('modal')).toBe(true);
    expect(isTopKeyboardLayer('canvas')).toBe(false);

    r1();
    // 还有一个 modal 占着
    expect(isTopKeyboardLayer('canvas')).toBe(false);
    r2();
    expect(isTopKeyboardLayer('canvas')).toBe(true);
  });

  it('释放顺序与占用顺序无关', () => {
    const releaseSearch = acquireKeyboardLayer('search');
    const releaseMenu = acquireKeyboardLayer('menu');

    // 先释放低层：高层仍压着
    releaseMenu();
    expect(isTopKeyboardLayer('search')).toBe(true);
    expect(isTopKeyboardLayer('menu')).toBe(false);
    expect(isTopKeyboardLayer('canvas')).toBe(false);

    releaseSearch();
    expect(isTopKeyboardLayer('canvas')).toBe(true);
  });

  it('释放函数重复调用只生效一次，不会把别人的占用扣掉', () => {
    const r1 = acquireKeyboardLayer('menu');
    const r2 = acquireKeyboardLayer('menu');
    r1();
    r1();
    r1();
    // r2 的占用还在
    expect(isTopKeyboardLayer('canvas')).toBe(false);
    r2();
    expect(isTopKeyboardLayer('canvas')).toBe(true);
  });
});
