import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  clearTags,
  getActiveTags,
  nodeMatchesTagFilter,
  removeActiveTag,
  renameActiveTag,
  resetTagFilterForTests,
  toggleTag,
  useTagFilter,
} from '../../src/services/tagFilter';

describe('tagFilter store', () => {
  beforeEach(() => {
    resetTagFilterForTests();
  });

  it('toggleTag 点亮再点熄灭', () => {
    toggleTag('重要');
    expect(getActiveTags().has('重要')).toBe(true);
    toggleTag('重要');
    expect(getActiveTags().size).toBe(0);
  });

  it('clearTags 一次清光全部点亮的标签', () => {
    toggleTag('a');
    toggleTag('b');
    clearTags();
    expect(getActiveTags().size).toBe(0);
  });

  it('renameActiveTag 只在旧名点亮时迁移；removeActiveTag 摘掉被删的标签', () => {
    toggleTag('旧');
    renameActiveTag('旧', '新');
    expect(getActiveTags().has('新')).toBe(true);
    expect(getActiveTags().has('旧')).toBe(false);

    renameActiveTag('不存在', '任意');
    expect(getActiveTags().size).toBe(1);

    removeActiveTag('新');
    expect(getActiveTags().size).toBe(0);
  });

  it('useTagFilter 订阅到变化，空集合保持同一引用', () => {
    const { result } = renderHook(() => useTagFilter());
    const empty = result.current;
    expect(empty.size).toBe(0);

    act(() => toggleTag('灵感'));
    expect(result.current.has('灵感')).toBe(true);

    act(() => clearTags());
    // 稳定引用：useSyncExternalStore 依赖同一状态返回同一对象
    expect(result.current).toBe(empty);
  });

  describe('nodeMatchesTagFilter（纯函数）', () => {
    it('没点亮任何标签时一律命中', () => {
      expect(nodeMatchesTagFilter({ tags: undefined }, new Set())).toBe(true);
      expect(nodeMatchesTagFilter({ tags: ['a'] }, new Set())).toBe(true);
    });

    it('多标签是并集：命中任一点亮标签即算命中', () => {
      const active = new Set(['重要', '待办']);
      expect(nodeMatchesTagFilter({ tags: ['重要'] }, active)).toBe(true);
      expect(nodeMatchesTagFilter({ tags: ['待办', '别的'] }, active)).toBe(true);
      expect(nodeMatchesTagFilter({ tags: ['别的'] }, active)).toBe(false);
      expect(nodeMatchesTagFilter({ tags: undefined }, active)).toBe(false);
      expect(nodeMatchesTagFilter({ tags: [] }, active)).toBe(false);
    });
  });
});
