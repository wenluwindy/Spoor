import { describe, it, expect } from 'vitest';
import {
  CANVAS_ALL_FILE_ACCEPT,
  CANVAS_CREATE_ITEMS,
  CANVAS_INSERT_ITEMS,
} from '../../src/constants/canvasMenuItems';
import enResources from '../../src/i18n';

describe('canvasMenuItems', () => {
  it('id 唯一', () => {
    const ids = [...CANVAS_CREATE_ITEMS, ...CANVAS_INSERT_ITEMS].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('便签建的是 text 节点（note 仅存在于早期种子数据）', () => {
    const note = CANVAS_CREATE_ITEMS.find((i) => i.id === 'note');
    expect(note?.nodeType).toBe('text');
  });

  it('主题卡建的是 theme 节点且用强调色图标', () => {
    const theme = CANVAS_CREATE_ITEMS.find((i) => i.id === 'theme');
    expect(theme?.nodeType).toBe('theme');
    expect(theme?.accent).toBe(true);
  });

  it('每一项都有 i18n key 与图标', () => {
    for (const item of [...CANVAS_CREATE_ITEMS, ...CANVAS_INSERT_ITEMS]) {
      expect(item.labelKey).toMatch(/^[a-z]+\./);
      expect(item.icon).toBeTruthy();
    }
  });

  it('插入项的 i18n key 在 en 与 zh 中都存在', () => {
    const i18n = enResources;
    for (const item of CANVAS_INSERT_ITEMS) {
      expect(i18n.getFixedT('en')(item.labelKey)).not.toBe(item.labelKey);
      expect(i18n.getFixedT('zh')(item.labelKey)).not.toBe(item.labelKey);
    }
  });

  it('插入项的 accept 合集等于统一上传 accept', () => {
    const union = CANVAS_INSERT_ITEMS.flatMap((i) => i.accept.split(','));
    expect(CANVAS_ALL_FILE_ACCEPT.split(',').sort()).toEqual(union.sort());
  });
});
